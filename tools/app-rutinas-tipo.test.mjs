// Regresión: cada consulta del frontend que busca la rutina ACTIVA en
// `rutinas` debe filtrar por `tipo`. Fuerza, Core y Cardio tienen cada uno
// su propia rutina activa; sin el filtro, Fuerza cargaba el plan activo más
// reciente de CUALQUIER tipo y, al recargar la app, el plan de Fuerza ya
// guardado parecía perdido (la app pedía "Crear plan" otra vez y gastaba
// otra generación).
//
// app.js es un script clásico de navegador (no se puede importar en Node),
// así que se verifica sobre su texto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appJs = await readFile(new URL('../app.js', import.meta.url), 'utf8');

// Cada cadena encadenada `.from('rutinas')… ;` que pide `activa = true`.
const consultasActivas = [...appJs.matchAll(/\.from\('rutinas'\)[\s\S]*?;/g)]
  .map((m) => m[0])
  .filter((q) => /\.eq\('activa',\s*true\)/.test(q));

test('app.js tiene consultas de rutina activa para fuerza, abdominales y cardio', () => {
  const tipos = consultasActivas
    .map((q) => q.match(/\.eq\('tipo',\s*'(\w+)'\)/)?.[1])
    .filter(Boolean)
    .sort();
  assert.deepEqual(tipos, ['abdominales', 'cardio', 'fuerza']);
});

test('toda consulta de rutina activa en app.js filtra por tipo', () => {
  assert.ok(consultasActivas.length > 0);
  for (const q of consultasActivas) {
    assert.match(q, /\.eq\('tipo',\s*'\w+'\)/, `Consulta de rutina activa sin filtro de tipo:\n${q}`);
  }
});
