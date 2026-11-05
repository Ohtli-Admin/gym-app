// Rediseño 003: navegación de cuatro destinos (Hoy, Plan, Progreso,
// Perfil). app.js es un script clásico, así que se verifica sobre su texto
// y, para la lógica pura, evaluando solo esas funciones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appJs = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function extraerFuncion(nombre) {
  const inicio = appJs.indexOf(`function ${nombre}(`);
  assert.ok(inicio >= 0, `No se encontró ${nombre}`);
  let i = appJs.indexOf('{', inicio);
  let nivel = 0;
  for (; i < appJs.length; i++) {
    if (appJs[i] === '{') nivel++;
    else if (appJs[i] === '}' && --nivel === 0) break;
  }
  return appJs.slice(inicio, i + 1);
}

test('al entrar se abre Hoy (pantalla interna "entrenamiento")', () => {
  assert.match(appJs, /pantalla: 'entrenamiento',/);
});

test('la barra de abajo tiene exactamente Hoy, Plan, Progreso y Perfil', () => {
  const nav = extraerFuncion('renderNav');
  const etiquetas = [...nav.matchAll(/etiqueta: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(etiquetas, ['Hoy', 'Plan', 'Progreso', 'Perfil']);
});

test('toda pantalla que render() sabe pintar pertenece a una sección de la barra', () => {
  const render = extraerFuncion('render');
  const pantallas = [...render.matchAll(/estado\.pantalla === '(\w+)'/g)].map((m) => m[1]);
  const mapa = appJs.match(/const SECCION_POR_PANTALLA = \{([\s\S]*?)\};/)[1];
  for (const p of pantallas) assert.match(mapa, new RegExp(`\\b${p}: '`), `${p} sin sección`);
});

test('Plan tiene una pestaña por producto', () => {
  const bloque = appJs.match(/const PESTANAS_PLAN = \[([\s\S]*?)\];/)[1];
  const etiquetas = [...bloque.matchAll(/etiqueta: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(etiquetas, ['Fuerza', 'Core', 'Cardio', 'Calistenia', 'Especial']);
});

test('el peso corporal se movió de Perfil a Progreso', () => {
  assert.doesNotMatch(extraerFuncion('renderPerfil'), /peso-form/);
  assert.match(extraerFuncion('renderPeso'), /peso-form/);
});

const resumenConstancia = new Function(
  `${extraerFuncion('inicioDeSemana')}\n${extraerFuncion('formatoFecha')}\n${extraerFuncion('resumenConstancia')}\nreturn resumenConstancia;`,
)();

test('resumenConstancia cuenta días del mes, racha y últimas 6 semanas', () => {
  // Miércoles 5 nov 2026. Semanas (lunes) desde el 28 sep: 1, 0, 0, 1, 1, 2.
  const fechas = ['2026-11-03', '2026-11-03', '2026-11-04', '2026-10-27', '2026-10-20', '2026-10-01'];
  const r = resumenConstancia(fechas, '2026-11-05');
  assert.equal(r.delMes, 2); // 3 y 4 de noviembre (el 3 repetido cuenta una vez)
  assert.equal(r.racha, 3); // semana actual + 26 oct + 19 oct
  assert.equal(r.semanas.length, 6);
  assert.deepEqual(r.semanas.map((s) => s.sesiones), [1, 0, 0, 1, 1, 2]);
});

test('resumenConstancia: la semana actual vacía no rompe la racha', () => {
  const r = resumenConstancia(['2026-10-27', '2026-10-20'], '2026-11-05');
  assert.equal(r.racha, 2);
});

test('resumenConstancia: la racha pasa de las 6 semanas de la gráfica', () => {
  // Una sesión cada lunes durante 8 semanas seguidas, hasta esta semana.
  const fechas = ['2026-11-02', '2026-10-26', '2026-10-19', '2026-10-12', '2026-10-05', '2026-09-28', '2026-09-21', '2026-09-14'];
  const r = resumenConstancia(fechas, '2026-11-05');
  assert.equal(r.racha, 8);
  assert.equal(r.semanas.length, 6);
});

test('Progreso calcula la constancia con todas las fechas, no solo las 30 recientes', () => {
  const h = extraerFuncion('renderHistorial');
  assert.match(h, /select\('fecha'\)/);
  assert.match(h, /resumenConstancia\(\(todasFechas \|\| sesiones\)/);
});
