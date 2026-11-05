// Rediseño 003 · US4: cambiar un ejercicio de la rutina por uno de la
// librería, guardando el id canónico en una columna nueva y aditiva.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appJs = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const libJs = await readFile(new URL('../libreria.js', import.meta.url), 'utf8');
const sql = await readFile(new URL('../supabase/migrations/20261105120000_libreria_ejercicio_id.sql', import.meta.url), 'utf8');
const catalogo = JSON.parse(await readFile(new URL('../src/exercise-library/generated/catalog.json', import.meta.url), 'utf8'));

function extraerFuncion(fuente, nombre) {
  const inicio = fuente.indexOf(`function ${nombre}(`);
  assert.ok(inicio >= 0, `No se encontró ${nombre}`);
  let i = fuente.indexOf(') {', inicio) + 2;
  let nivel = 0;
  for (; i < fuente.length; i++) {
    if (fuente[i] === '{') nivel++;
    else if (fuente[i] === '}' && --nivel === 0) break;
  }
  return fuente.slice(inicio, i + 1);
}

test('la migración es aditiva y está marcada como no aplicada', () => {
  const codigo = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase();
  assert.match(sql, /PROPUESTA — NO APLICADA/);
  assert.equal((codigo.match(/add column if not exists libreria_ejercicio_id text/g) || []).length, 2);
  for (const peligro of ['drop ', 'delete ', 'update ', 'truncate', 'set not null', 'alter column']) {
    assert.ok(!codigo.includes(peligro), `la migración no debe contener "${peligro}"`);
  }
});

test('el formato que exige la migración acepta todos los ids de la librería', () => {
  const patron = sql.match(/libreria_ejercicio_id ~ '([^']+)'/)[1];
  const re = new RegExp(patron);
  assert.ok(catalogo.length > 0);
  for (const r of catalogo) assert.match(r.exercise_id, re);
  assert.doesNotMatch('42', re); // un id legacy no pasa
});

const nombreEjercicio = new Function('libreria', 'nombreEjercicioLibreria', `
  ${extraerFuncion(appJs, 'registroLibreriaDe')}
  ${extraerFuncion(appJs, 'nombreEjercicio')}
  return nombreEjercicio;`)(
  { registros: [{ exercise_id: 'src-002-0123456789abcdef', names: { es: 'Remo con mancuerna' } }] },
  (r) => r.names.es,
);

test('nombreEjercicio usa la librería si la fila la trae y el legacy si no', () => {
  assert.equal(nombreEjercicio({ ejercicio_id: 'x', ejercicios: { nombre: 'Remo con barra' } }), 'Remo con barra');
  assert.equal(nombreEjercicio({ ejercicio_id: 'x', libreria_ejercicio_id: 'src-002-0123456789abcdef', ejercicios: { nombre: 'Remo con barra' } }), 'Remo con mancuerna');
  assert.equal(nombreEjercicio({ ejercicio_id: 'x', libreria_ejercicio_id: 'src-002-ffffffffffffffff' }), 'Ejercicio de la librería');
});

function consultaFalsa() {
  const llamadas = [];
  const q = { eq: (c, v) => (llamadas.push(['eq', c, v]), q), is: (c, v) => (llamadas.push(['is', c, v]), q), llamadas };
  return q;
}
const filtrar = (estado) => new Function('estado', `${extraerFuncion(appJs, 'filtrarSeriesDe')}; return filtrarSeriesDe;`)(estado);

test('el historial de un ejercicio de la librería no se mezcla con el legacy', () => {
  const conLib = filtrar({ columnaLibreria: true })(consultaFalsa(), { ejercicio_id: 'x', libreria_ejercicio_id: 'src-002-0123456789abcdef' });
  assert.deepEqual(conLib.llamadas, [['eq', 'libreria_ejercicio_id', 'src-002-0123456789abcdef']]);
  const legacy = filtrar({ columnaLibreria: true })(consultaFalsa(), { ejercicio_id: 'x' });
  assert.deepEqual(legacy.llamadas, [['eq', 'ejercicio_id', 'x'], ['is', 'libreria_ejercicio_id', null]]);
  // Sin la columna en la base (migración sin aplicar) la consulta es la de siempre.
  const antes = filtrar({ columnaLibreria: false })(consultaFalsa(), { ejercicio_id: 'x' });
  assert.deepEqual(antes.llamadas, [['eq', 'ejercicio_id', 'x']]);
});

test('una serie nueva guarda el id de la librería solo cuando aplica', () => {
  const tabla = extraerFuncion(appJs, 'pintarTablaSeries');
  assert.match(tabla, /ejercicio_id: ejercicioId,/);
  assert.match(tabla, /\.\.\.\(libreriaId \? \{ libreria_ejercicio_id: libreriaId \} : \{\}\)/);
});

test('"Elegir de la librería" solo aparece si la base ya tiene la columna', () => {
  assert.match(extraerFuncion(appJs, 'renderRegistro'), /\$\{estado\.columnaLibreria \? `<button type="button" class="g3-fila" id="alt-libreria">/);
  assert.match(extraerFuncion(libJs, 'renderFicha'), /libreria\.eligiendoPara \?[\s\S]*id="ficha-usar"/);
});

test('las series de hoy se separan por fila aunque dos filas usen el mismo ejercicio de la librería', () => {
  const ej = { ejercicio_id: 'x', libreria_ejercicio_id: 'src-002-0123456789abcdef' };
  const hoy = filtrar({ columnaLibreria: true })(consultaFalsa(), ej, { porFila: true });
  assert.deepEqual(hoy.llamadas, [['eq', 'libreria_ejercicio_id', 'src-002-0123456789abcdef'], ['eq', 'ejercicio_id', 'x']]);
  assert.match(extraerFuncion(appJs, 'renderRegistro'), /\.eq\('sesion_id', sesionId\), ej, \{ porFila: true \}\)/);
});

test('Progreso averigua si existe la columna antes de leer las series', () => {
  assert.match(extraerFuncion(appJs, 'asegurarColumnaLibreria'), /select\('libreria_ejercicio_id'\)\.limit\(1\)/);
  assert.match(extraerFuncion(appJs, 'renderHistorial'), /const conLibreria = await asegurarColumnaLibreria\(\);/);
});
