// Run: node --test supabase/functions/generate-routine/diagnostico.test.mjs
// (Node >= 22.18 / 23.6 strips the erasable TypeScript in diagnostico.ts.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_VALIDACION,
  RESULTADO,
  validarRutina,
  clasificarFormaRespuesta,
  describirIntento,
} from './diagnostico.ts';

const catalogo = [
  { exercise_id: 'a', nombre: 'Remo', equipo: 'mancuernas', contraindicaciones: [] },
  { exercise_id: 'b', nombre: 'Press militar', equipo: 'barra', contraindicaciones: ['Hombro'] },
  { exercise_id: 'c', nombre: 'Prensa', equipo: 'maquina', contraindicaciones: [] },
];
const perfil = { lesiones: ['Hombro'], equipo_disponible: ['mancuernas', 'barra'], dias_disponibles: 2 };
const codigos = (errores) => errores.map((e) => e.codigo).sort();

test('valid routine has no errors', () => {
  const rutina = { dias: [{ dia: 1, ejercicios: [{ exercise_id: 'a', series: 3 }] }] };
  assert.deepEqual(validarRutina(rutina, catalogo, perfil), []);
});

test('each deterministic rule reports its own category', () => {
  const rutina = {
    dias: [
      { dia: 1, ejercicios: [{ exercise_id: 'zzz', series: 3 }, { exercise_id: 'b', series: 3 }] },
      { dia: 2, ejercicios: [{ exercise_id: 'c', series: 3 }, { exercise_id: 'a', series: 9 }] },
      { dia: 3, ejercicios: [] },
    ],
  };
  assert.deepEqual(codigos(validarRutina(rutina, catalogo, perfil)), [
    ERROR_VALIDACION.CONTRAINDICADO,
    ERROR_VALIDACION.DIAS_EXCEDIDOS,
    ERROR_VALIDACION.EJERCICIO_ID_INVALIDO,
    ERROR_VALIDACION.EQUIPO_NO_DISPONIBLE,
    ERROR_VALIDACION.SERIES_FUERA_DE_RANGO,
  ]);
});

test('empty routine reports no-days and no-exercises', () => {
  assert.deepEqual(codigos(validarRutina({ dias: [] }, catalogo, perfil)), [
    ERROR_VALIDACION.RUTINA_SIN_DIAS,
    ERROR_VALIDACION.RUTINA_SIN_EJERCICIOS,
  ]);
});

test('fewer days than requested is not a validation error (caller marks it partial)', () => {
  const rutina = { dias: [{ dia: 1, ejercicios: [{ exercise_id: 'a', series: 3 }] }] };
  assert.deepEqual(validarRutina(rutina, catalogo, { ...perfil, dias_disponibles: 4 }), []);
});

test('response-shape classification', () => {
  assert.equal(clasificarFormaRespuesta({ dias: [] }, 'tool_use'), null);
  assert.equal(clasificarFormaRespuesta({ dias: [{}] }, 'max_tokens'), null); // truncated in resumen only: still usable
  assert.equal(clasificarFormaRespuesta({}, 'max_tokens'), RESULTADO.TRUNCADO_MAX_TOKENS);
  assert.equal(clasificarFormaRespuesta(null, 'max_tokens'), RESULTADO.TRUNCADO_MAX_TOKENS);
  assert.equal(clasificarFormaRespuesta(null, 'end_turn'), RESULTADO.SIN_TOOL_INPUT);
  assert.equal(clasificarFormaRespuesta({ resumen: 'x' }, 'tool_use'), RESULTADO.DIAS_AUSENTES);
  assert.equal(clasificarFormaRespuesta({ dias: new Array(11).fill({}) }, 'tool_use'), RESULTADO.DIAS_DEGENERADOS);
});

test('attempt diagnostic is bounded: key names and counts only, never values', () => {
  const secreto = 'texto médico privado del usuario';
  const d = describirIntento({
    intento: 2,
    resultado: RESULTADO.VALIDACION_FALLIDA,
    input: { dias: [{ nombre: secreto }], resumen: secreto },
    stopReason: 'tool_use',
    errores: [
      { codigo: ERROR_VALIDACION.EJERCICIO_ID_INVALIDO, texto: 'x' },
      { codigo: ERROR_VALIDACION.EJERCICIO_ID_INVALIDO, texto: 'y' },
    ],
    usage: { input_tokens: 100, output_tokens: 50 },
    ms: 1234,
  });
  assert.deepEqual(d.errores_por_categoria, { EJERCICIO_ID_INVALIDO: 2 });
  assert.equal(d.total_errores, 2);
  assert.equal(d.dias_generados, 1);
  assert.equal(d.tiene_tool_input, true);
  assert.equal(d.truncado, false);
  assert.deepEqual(d.claves_tool_input, ['dias', 'resumen']);
  assert.equal(JSON.stringify(d).includes(secreto), false);
});
