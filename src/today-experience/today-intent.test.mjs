import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TODAY_INTENT_MAX_LENGTH,
  normalizeIntentText,
  readTodayIntent,
  saveTodayIntent,
} from './today-intent.mjs';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    size: () => data.size,
  };
}

const day1 = new Date(2026, 8, 23, 9, 0);
const day1Late = new Date(2026, 8, 23, 23, 30);
const day2 = new Date(2026, 8, 24, 7, 0);

test('saves and reads back today\'s note (normalized)', () => {
  const storage = memoryStorage();
  const saved = saveTodayIntent('  Tengo solo\n 25 minutos  ', { storage, now: day1 });
  assert.equal(saved, 'Tengo solo 25 minutos');
  assert.equal(readTodayIntent({ storage, now: day1Late }), 'Tengo solo 25 minutos');
});

test('a note from a previous day is not returned', () => {
  const storage = memoryStorage();
  saveTodayIntent('Hoy quiero pierna y cardio', { storage, now: day1 });
  assert.equal(readTodayIntent({ storage, now: day2 }), '');
});

test('empty text clears the note', () => {
  const storage = memoryStorage();
  saveTodayIntent('algo', { storage, now: day1 });
  saveTodayIntent('   ', { storage, now: day1 });
  assert.equal(storage.size(), 0);
  assert.equal(readTodayIntent({ storage, now: day1 }), '');
});

test('text is length-bounded', () => {
  assert.equal(normalizeIntentText('x'.repeat(2000)).length, TODAY_INTENT_MAX_LENGTH);
  assert.equal(normalizeIntentText(null), '');
});

test('missing or throwing storage degrades to empty, never throws', () => {
  assert.equal(readTodayIntent({ storage: null, now: day1 }), '');
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  assert.equal(saveTodayIntent('hola', { storage: broken, now: day1 }), 'hola');
  assert.equal(readTodayIntent({ storage: broken, now: day1 }), '');
  const corrupt = memoryStorage();
  corrupt.setItem('gymapp.todayIntent.v1', '{not json');
  assert.equal(readTodayIntent({ storage: corrupt, now: day1 }), '');
});
