import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptFuerzaDay, adaptAbdomenDay, adaptCardioDay } from './legacy-adapter.mjs';

test('adaptFuerzaDay maps legacy exercise rows to session items', () => {
  const dia = {
    ejercicios: [
      { ejercicio_id: 'e1', ejercicios: { nombre: 'Sentadilla' }, series: 4, reps_objetivo: 8 },
      { ejercicio_id: 'e2', ejercicios: null, series: 3, reps_objetivo: 10 },
    ],
  };
  const items = adaptFuerzaDay(dia);

  assert.equal(items.length, 2);
  assert.equal(items[0].exerciseId, 'legacy-fuerza-e1');
  assert.equal(items[0].name, 'Sentadilla');
  assert.equal(items[0].modality, 'gym');
  assert.deepEqual(items[0].prescription, { type: 'sets_reps', sets: 4, reps: 8 });
  assert.equal(items[0].reasons.length, 0);
  // falls back to the raw id when the joined name is missing
  assert.equal(items[1].name, 'e2');
});

test('adaptAbdomenDay uses the core modality', () => {
  const dia = { ejercicios: [{ ejercicio_id: 'e3', ejercicios: { nombre: 'Plancha' }, series: 3, reps_objetivo: 30 }] };
  const items = adaptAbdomenDay(dia);
  assert.equal(items[0].modality, 'core');
  assert.equal(items[0].exerciseId, 'legacy-abdomen-e3');
});

test('adaptCardioDay maps phases using their own real planned duration', () => {
  const dia = {
    fases: [
      { id: 1, fase: 'calentamiento', actividad: 'Caminata', duracion_min: 5 },
      { id: 2, fase: 'principal', actividad: 'Intervalos', duracion_min: 20 },
    ],
  };
  const items = adaptCardioDay(dia);

  assert.equal(items.length, 2);
  assert.equal(items[1].modality, 'cardio');
  assert.deepEqual(items[1].prescription, { type: 'duration', durationMinutes: 20 });
  assert.equal(items[1].estimatedDurationMinutes, 20);
});

test('every adapter returns [] for a missing/empty day', () => {
  assert.deepEqual(adaptFuerzaDay(null), []);
  assert.deepEqual(adaptAbdomenDay(undefined), []);
  assert.deepEqual(adaptCardioDay({ fases: [] }), []);
});
