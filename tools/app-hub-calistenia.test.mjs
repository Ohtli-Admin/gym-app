// Regresión GA-007: en el hub de Entrenamiento, el botón de Calistenia
// dice "Ver rutina" cuando ya hay una rutina de Calistenia preparada
// (antes decía "Crear sesión" aunque sólo la reanudaba).
//
// app.js es un script clásico de navegador (no se puede importar en Node),
// así que se verifica sobre su texto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appJs = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const boton = appJs.match(/<button[^>]*id="btn-calistenia"[^>]*>([^<]*)<\/button>/);

test('app.js tiene el botón de Calistenia en el hub', () => {
  assert.ok(boton, 'No se encontró <button id="btn-calistenia">');
});

test('la etiqueta del botón de Calistenia depende de la rutina preparada', () => {
  const etiqueta = boton[1];
  assert.match(etiqueta, /reanudar\.preparedOrigin === 'calistenia'/);
  assert.match(etiqueta, /'Ver rutina'/);
  assert.match(etiqueta, /'Crear sesión'/);
});
