// Run: node --test supabase/functions/generate-routine/reintentos.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESULTADO, ERROR_VALIDACION, clasificarFormaRespuesta } from './diagnostico.ts';
import { ejecutarIntentos } from './reintentos.ts';

const rutinaValida = { dias: [{ dia: 1, nombre: 'Día 1', ejercicios: [{ exercise_id: '1', series: 3, reps_objetivo: '10', orden: 1 }] }], resumen: 'ok' };

// Scripted model: returns queued responses and snapshots the conversation
// it was called with (the loop appends to the same array).
function modeloGuionado(respuestas) {
  const llamadas = [];
  return {
    llamadas,
    llamarModelo: async (mensajes) => {
      llamadas.push(structuredClone(mensajes));
      const r = respuestas.shift();
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

// Mirrors index.ts's evaluar contract: works on a COPY, never mutates.
function evaluarPorDefecto(candidato) {
  const copia = structuredClone(candidato);
  for (const d of copia.dias) for (const e of d.ejercicios) e.exercise_id = `real-${e.exercise_id}`;
  return { errores: [], resultado: copia, parcial: false };
}

async function correr(respuestas, evaluar = evaluarPorDefecto) {
  const modelo = modeloGuionado(respuestas);
  const registros = [];
  const mensajes = [{ role: 'user', content: 'Genera la rutina' }];
  const r = await ejecutarIntentos({
    mensajes,
    llamarModelo: modelo.llamarModelo,
    evaluar,
    statusErrorApi: (err) => (err?.status ?? null),
    registrar: (d) => registros.push(d),
  });
  return { r, modelo, registros, mensajes };
}

test('1. tool_use with input missing `dias` -> DIAS_AUSENTES', () => {
  assert.equal(clasificarFormaRespuesta({ resumen: 'x' }, 'tool_use'), RESULTADO.DIAS_AUSENTES);
  assert.equal(clasificarFormaRespuesta({}, 'tool_use'), RESULTADO.DIAS_AUSENTES);
});

test('2. DIAS_AUSENTES produces corrective tool_result context, replaying the original input untouched', async () => {
  const malformado = { resumen: 'solo resumen' };
  const original = structuredClone(malformado);
  const { modelo, registros } = await correr([
    { input: malformado, stopReason: 'tool_use', toolUseId: 'toolu_1' },
    { input: rutinaValida, stopReason: 'tool_use', toolUseId: 'toolu_2' },
  ]);

  const segunda = modelo.llamadas[1];
  assert.equal(segunda.length, 3);
  assert.deepEqual(segunda[1], {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'generar_rutina', input: original }],
  });
  const [bloque] = segunda[2].content;
  assert.equal(segunda[2].role, 'user');
  assert.equal(bloque.type, 'tool_result');
  assert.equal(bloque.tool_use_id, 'toolu_1');
  assert.equal(bloque.is_error, true);
  assert.match(bloque.content, /omitió el campo obligatorio `dias`/);
  assert.match(bloque.content, /AMBOS campos `dias`/);
  assert.match(bloque.content, /No respondas con texto fuera de la llamada/);
  assert.deepEqual(malformado, original, 'malformed input must not be mutated');
  assert.equal(registros[0].resultado, RESULTADO.DIAS_AUSENTES);
});

test('3. corrected second tool call with `dias` succeeds', async () => {
  const { r, registros } = await correr([
    { input: { resumen: 'x' }, stopReason: 'tool_use', toolUseId: 'toolu_1' },
    { input: rutinaValida, stopReason: 'tool_use', toolUseId: 'toolu_2' },
  ]);
  assert.equal(r.motivoFallo, null);
  assert.equal(r.resultado.dias[0].ejercicios[0].exercise_id, 'real-1');
  assert.deepEqual(registros.map((d) => d.resultado), [RESULTADO.DIAS_AUSENTES, RESULTADO.OK]);
});

test('DIAS_AUSENTES twice keeps its own code (not a truncation)', async () => {
  const { r } = await correr([
    { input: { resumen: 'x' }, stopReason: 'tool_use', toolUseId: 'toolu_1' },
    { input: { resumen: 'y' }, stopReason: 'tool_use', toolUseId: 'toolu_2' },
  ]);
  assert.equal(r.resultado, null);
  assert.equal(r.motivoFallo, RESULTADO.DIAS_AUSENTES);
});

test('4. real max_tokens stays TRUNCADO_MAX_TOKENS and retries without replaying the cut-off call', async () => {
  const { r, modelo, registros } = await correr([
    { input: { resumen: 'cortado' }, stopReason: 'max_tokens', toolUseId: 'toolu_1' },
    { input: {}, stopReason: 'max_tokens', toolUseId: 'toolu_2' },
  ]);
  assert.equal(r.motivoFallo, RESULTADO.TRUNCADO_MAX_TOKENS);
  assert.equal(modelo.llamadas[1].length, 1, 'no corrective turns for a real truncation');
  assert.deepEqual(registros.map((d) => d.truncado), [true, true]);
});

test('4b. no tool_use at all -> SIN_TOOL_INPUT, retried without corrective turns', async () => {
  const { r, modelo } = await correr([
    { input: null, stopReason: 'end_turn', toolUseId: null },
    { input: null, stopReason: 'end_turn', toolUseId: null },
  ]);
  assert.equal(r.motivoFallo, RESULTADO.SIN_TOOL_INPUT);
  assert.equal(modelo.llamadas[1].length, 1);
});

test('5. validation-error retry is unchanged: feedback lists the errors, no is_error flag', async () => {
  let llamada = 0;
  const evaluar = (candidato) => {
    llamada++;
    if (llamada === 1) {
      return { errores: [{ codigo: ERROR_VALIDACION.EJERCICIO_ID_INVALIDO, texto: "Día 1: '999' no existe en el catálogo." }] };
    }
    return evaluarPorDefecto(candidato);
  };
  const primera = structuredClone(rutinaValida);
  const { r, modelo, registros } = await correr([
    { input: primera, stopReason: 'tool_use', toolUseId: 'toolu_1' },
    { input: rutinaValida, stopReason: 'tool_use', toolUseId: 'toolu_2' },
  ], evaluar);

  const [bloque] = modelo.llamadas[1][2].content;
  assert.equal(bloque.type, 'tool_result');
  assert.equal(bloque.tool_use_id, 'toolu_1');
  assert.equal('is_error' in bloque, false);
  assert.match(bloque.content, /Tu rutina anterior no es válida por lo siguiente:\n- Día 1: '999' no existe en el catálogo\./);
  assert.deepEqual(modelo.llamadas[1][1].content[0].input, rutinaValida);
  assert.equal(r.motivoFallo, null);
  assert.deepEqual(registros.map((d) => d.resultado), [RESULTADO.VALIDACION_FALLIDA, RESULTADO.OK]);
});

test('model API error stops immediately with ERROR_API_MODELO; other errors propagate', async () => {
  const errApi = Object.assign(new Error('Error de la API de Claude (529): overloaded'), { status: 529 });
  const { r, registros } = await correr([errApi]);
  assert.equal(r.motivoFallo, RESULTADO.ERROR_API_MODELO);
  assert.equal(registros[0].http_status_modelo, 529);

  await assert.rejects(correr([new Error('bug')]), /bug/);
});
