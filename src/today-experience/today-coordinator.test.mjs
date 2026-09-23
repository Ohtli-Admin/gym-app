import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTodayOverview } from './today-coordinator.mjs';

const item = (overrides = {}) => ({
  exerciseId: 'ex-1',
  name: 'Ejercicio',
  modality: 'gym',
  status: 'compatible',
  reasons: [],
  prescription: { type: 'sets_reps', sets: 3, reps: 10 },
  estimatedDurationMinutes: 6,
  ...overrides,
});

test('buildTodayOverview skips products with no plan/no items', () => {
  const overview = buildTodayOverview({ fuerza: null, cardio: { label: 'Cardio', items: [] }, core: null });
  assert.deepEqual(overview.components, []);
  assert.deepEqual(overview.combinedItems, []);
  assert.equal(overview.hasAnything, false);
  assert.equal(overview.totalEstimatedDurationMinutes, 0);
});

test('buildTodayOverview aggregates every product that has items', () => {
  const overview = buildTodayOverview({
    fuerza: { label: 'Fuerza', items: [item({ exerciseId: 'a' }), item({ exerciseId: 'b' })] },
    cardio: { label: 'Cardio', items: [item({ exerciseId: 'c', estimatedDurationMinutes: 20 })] },
    core: null,
  });

  assert.equal(overview.components.length, 2);
  assert.deepEqual(
    overview.components.map((c) => c.product),
    ['fuerza', 'cardio'],
  );
  assert.equal(overview.components[0].itemCount, 2);
  assert.equal(overview.components[0].estimatedDurationMinutes, 12);
  assert.equal(overview.combinedItems.length, 3);
  assert.equal(overview.totalEstimatedDurationMinutes, 32);
  assert.equal(overview.hasAnything, true);
});
