import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPECIAL_TRAINING_MODES,
  productsUsingObjective,
  readAdaptObjective,
  saveAdaptObjective,
  clearAdaptObjective,
  objectiveTextForProduct,
} from './special-training.mjs';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    size: () => data.size,
  };
}

test('the two modes are distinct, explicit values', () => {
  assert.notEqual(SPECIAL_TRAINING_MODES.INDEPENDENT, SPECIAL_TRAINING_MODES.ADAPT_PLANS);
});

test('adapt objective persists (no daily expiry) until explicitly cleared', () => {
  const storage = memoryStorage();
  const saved = saveAdaptObjective('  En 30 días voy a un concierto  ', { storage, now: new Date('2026-09-01T10:00:00Z') });
  assert.equal(saved.text, 'En 30 días voy a un concierto');
  assert.equal(saved.mode, SPECIAL_TRAINING_MODES.ADAPT_PLANS);

  const leido = readAdaptObjective({ storage });
  assert.deepEqual(leido, saved);

  clearAdaptObjective({ storage });
  assert.equal(readAdaptObjective({ storage }), null);
});

test('saving empty text clears the objective', () => {
  const storage = memoryStorage();
  saveAdaptObjective('algo', { storage });
  assert.equal(saveAdaptObjective('   ', { storage }), null);
  assert.equal(storage.size(), 0);
});

test('objective is only forwarded to products whose generator accepts it', () => {
  const objective = { text: 'Preparar concierto', mode: SPECIAL_TRAINING_MODES.ADAPT_PLANS };
  assert.deepEqual(productsUsingObjective(), ['fuerza', 'abdomen']);
  assert.equal(objectiveTextForProduct('fuerza', objective), 'Preparar concierto');
  assert.equal(objectiveTextForProduct('abdomen', objective), 'Preparar concierto');
  assert.equal(objectiveTextForProduct('cardio', objective), '');
  assert.equal(objectiveTextForProduct('calistenia', objective), '');
  assert.equal(objectiveTextForProduct('fuerza', null), '');
});

test('corrupt, foreign-mode or unavailable storage degrades to null, never throws', () => {
  const corrupt = memoryStorage();
  corrupt.setItem('gymapp.specialObjective.v1', '{nope');
  assert.equal(readAdaptObjective({ storage: corrupt }), null);

  const otherMode = memoryStorage();
  otherMode.setItem('gymapp.specialObjective.v1', JSON.stringify({ text: 'x', mode: 'independent' }));
  assert.equal(readAdaptObjective({ storage: otherMode }), null);

  assert.equal(readAdaptObjective({ storage: null }), null);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(saveAdaptObjective('hola', { storage: broken }).text, 'hola');
  assert.doesNotThrow(() => clearAdaptObjective({ storage: broken }));
});
