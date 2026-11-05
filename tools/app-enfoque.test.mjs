// Rediseño 003 · US3: modo entrenando (un ejercicio a la vez) y descanso a
// pantalla completa. app.js es un script clásico: se revisa su texto y se
// evalúa solo la lógica pura.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appJs = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function extraerFuncion(nombre) {
  const inicio = appJs.indexOf(`function ${nombre}(`);
  assert.ok(inicio >= 0, `No se encontró ${nombre}`);
  let i = appJs.indexOf(') {', inicio) + 2; // salta llaves de los parámetros
  let nivel = 0;
  for (; i < appJs.length; i++) {
    if (appJs[i] === '{') nivel++;
    else if (appJs[i] === '}' && --nivel === 0) break;
  }
  return appJs.slice(inicio, i + 1);
}

test('en registro se oculta la barra de abajo (modo enfoque)', () => {
  const render = extraerFuncion('render');
  assert.match(render, /classList\.toggle\('modo-enfoque', estado\.pantalla === 'registro'\)/);
});

test('ejerciciosDelDiaRegistro usa el plan de origen y el día del ejercicio', () => {
  const estado = {
    pantallaOrigenRegistro: 'rutina',
    ejercicioActivo: { id: 'b', dia: 2 },
    dias: [{ dia: 1, ejercicios: [{ id: 'x' }] }, { dia: 2, ejercicios: [{ id: 'a' }, { id: 'b' }] }],
    abdomen: { dias: [{ dia: 2, ejercicios: [{ id: 'core' }] }] },
  };
  const fn = new Function('estado', `${extraerFuncion('ejerciciosDelDiaRegistro')}; return ejerciciosDelDiaRegistro();`);
  assert.deepEqual(fn(estado).map((e) => e.id), ['a', 'b']);
  assert.deepEqual(fn({ ...estado, pantallaOrigenRegistro: 'abdomen' }).map((e) => e.id), ['core']);
  assert.deepEqual(fn({ ...estado, ejercicioActivo: null }), []);
});

test('registro tiene anterior, siguiente, terminar y cambiar ejercicio', () => {
  const reg = extraerFuncion('renderRegistro');
  for (const id of ['reg-anterior', 'reg-siguiente', 'reg-volver', 'reg-cambiar', 'reg-alternativas']) {
    assert.match(reg, new RegExp(`id="${id}"`), id);
  }
  assert.match(reg, /Ejercicio \$\{pos \+ 1\} de \$\{delDia\.length\}/);
});

test('el descanso es a pantalla completa con ±15 s, saltar y alternativas', () => {
  const desc = extraerFuncion('iniciarDescanso');
  assert.match(desc, /class="g3-descanso"/);
  assert.match(desc, /data-ajuste="-15"/);
  assert.match(desc, /data-ajuste="15"/);
  assert.match(desc, /id="descanso-saltar"/);
  assert.match(desc, /data-alt-idx/);
  assert.match(desc, /usarAlternativa\(alt\)/);
  assert.match(desc, /Math\.max\(5,/);
});

test('cambiar por alternativa se queda entrenando con el ejercicio nuevo', () => {
  const usar = extraerFuncion('usarAlternativa');
  assert.match(usar, /estado\.pantalla = 'registro'/);
});

test('un renderRegistro viejo no pinta sobre el ejercicio nuevo', () => {
  const reg = extraerFuncion('renderRegistro');
  assert.match(reg, /const token = \+\+registroVigente;/);
  // Después de cada espera a Supabase se revisa que el render siga vigente.
  const esperas = (reg.match(/= await /g) || []).length;
  const revisiones = (reg.match(/if \(!vigente\(\)\) return;/g) || []).length;
  assert.ok(esperas >= 4 && revisiones >= esperas, `${esperas} esperas, ${revisiones} revisiones`);
});
