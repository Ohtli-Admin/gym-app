// Regresión GA-007 (actualizada en el rediseño 003): en Hoy, la fila de
// Calistenia avisa cuando ya hay una rutina de Calistenia preparada (antes
// decía "Crear sesión" aunque sólo la reanudaba).
//
// app.js es un script clásico de navegador (no se puede importar en Node),
// así que se verifica sobre su texto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appJs = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const fila = appJs.match(/<button[^>]*id="btn-calistenia"[^>]*>([\s\S]*?)<\/button>/);

test('Hoy tiene la fila de Calistenia', () => {
  assert.ok(fila, 'No se encontró <button id="btn-calistenia">');
});

test('la fila de Calistenia dice si hay una rutina preparada', () => {
  const contenido = fila[1];
  assert.match(contenido, /reanudar\.preparedOrigin === 'calistenia'/);
  assert.match(contenido, /'Rutina preparada'/);
});
