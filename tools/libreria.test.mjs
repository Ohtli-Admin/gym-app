// Rediseño 003 (US2): clasificación y filtros de la sección Librería, sobre
// el snapshot real versionado en GymApp.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { gruposDeEjercicio, equiposDeEjercicio, filtrarLibreria, GRUPOS_LIBRERIA } = require('../libreria.js');
const catalogo = JSON.parse(await readFile(new URL('../src/exercise-library/generated/catalog.json', import.meta.url), 'utf8'));
const media = JSON.parse(await readFile(new URL('../src/exercise-library/generated/media/index.json', import.meta.url), 'utf8'));

test('todo ejercicio del snapshot tiene nombre en español', () => {
  assert.equal(catalogo.filter((r) => !r.names?.es).length, 0);
});

test('todo ejercicio cae en al menos un grupo de músculo', () => {
  const sinGrupo = catalogo.filter((r) => gruposDeEjercicio(r).length === 0).map((r) => r.names.es);
  // Solo los de cuello no tienen grupo en el filtro.
  assert.ok(sinGrupo.length <= 2, sinGrupo.join(', '));
  for (const g of GRUPOS_LIBRERIA) assert.ok(catalogo.some((r) => gruposDeEjercicio(r).includes(g.id)), `grupo vacío: ${g.id}`);
});

test('el músculo principal manda sobre la región', () => {
  const r = { classification: { primary_muscles: ['pectorals'], body_regions: ['shoulder_girdle'] }, setup: {} };
  assert.deepEqual(gruposDeEjercicio(r), ['pecho']);
  const sinMusculo = { classification: { primary_muscles: [], body_regions: ['shoulder_girdle'] }, setup: {} };
  assert.deepEqual(gruposDeEjercicio(sinMusculo), ['hombro']);
});

test('filtrar combina búsqueda sin acentos, músculo y equipo', () => {
  const conImagen = new Set(media.ids);
  const r = filtrarLibreria(catalogo, { texto: 'press de banca', grupo: 'pecho', equipo: 'mancuernas' }, conImagen);
  assert.ok(r.length > 0);
  for (const x of r) {
    assert.match(x.names.es.toLowerCase(), /press de banca/);
    assert.ok(equiposDeEjercicio(x).includes('mancuernas'));
  }
  assert.ok(filtrarLibreria(catalogo, { texto: 'extension de triceps' }).length > 0, 'búsqueda sin acento');
});

test('los ejercicios con lámina salen primero', () => {
  const conImagen = new Set(media.ids);
  const r = filtrarLibreria(catalogo, {}, conImagen);
  const primeroSin = r.findIndex((x) => !conImagen.has(x.exercise_id));
  assert.ok(r.slice(primeroSin).every((x) => !conImagen.has(x.exercise_id)));
});

test('cada lámina del índice existe en sus dos tamaños', async () => {
  for (const id of media.ids) {
    await readFile(new URL(`../src/exercise-library/generated/media/${id}.webp`, import.meta.url));
    await readFile(new URL(`../src/exercise-library/generated/media/${id}-mini.webp`, import.meta.url));
  }
});

test('la librería se puede reintentar tras un error de carga', async () => {
  const src = await readFile(new URL('../libreria.js', import.meta.url), 'utf8');
  assert.match(src, /id="lib-reintentar"/);
  assert.match(src, /libreria\.error = null; renderLibreria\(\)/);
});

test('una búsqueda pendiente no repinta una vista que ya se reemplazó', async () => {
  const src = await readFile(new URL('../libreria.js', import.meta.url), 'utf8');
  assert.match(src, /function renderLibreria\(\) \{\n[^\n]*\n  clearTimeout\(libreria\.espera\);/);
  assert.match(src, /if \(buscar\.isConnected\) pintarResultados\(\)/);
});
