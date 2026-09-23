import test from 'node:test';
import assert from 'node:assert/strict';
import { computePlanId } from './plan-id.mjs';

const baseContext = () => ({
  trainingGoal: 'strength',
  environment: 'gym',
  timeAvailableMinutes: 45,
  experienceLevel: 'intermediate',
  modalities: ['gym'],
  equipment: ['dumbbell'],
  restrictions: [],
});

test('computePlanId does not import any Node-only module (browser portability)', async () => {
  // A static import of a Node built-in (e.g. 'node:crypto') would make this
  // module unusable as a native ES module in a browser — the exact failure
  // mode GA-005's Today experience would hit. Reading the source and
  // asserting no 'node:' specifier is present is a cheap, direct guard
  // against that regression, independent of whatever hides behind a
  // require()/dynamic-import trick.
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./plan-id.mjs', import.meta.url), 'utf8');
  assert.ok(!/from\s+['"]node:/.test(source), 'plan-id.mjs must not import a Node-only module');
});

test('computePlanId is deterministic for equivalent input', () => {
  const idA = computePlanId({ context: baseContext(), allowConditional: false, exerciseIds: ['ex-1', 'ex-2'] });
  const idB = computePlanId({ context: baseContext(), allowConditional: false, exerciseIds: ['ex-1', 'ex-2'] });
  assert.equal(idA, idB);
});

test('computePlanId changes when the selected exercises change', () => {
  const idA = computePlanId({ context: baseContext(), allowConditional: false, exerciseIds: ['ex-1'] });
  const idB = computePlanId({ context: baseContext(), allowConditional: false, exerciseIds: ['ex-2'] });
  assert.notEqual(idA, idB);
});

test('computePlanId has the documented plan-<16 hex chars> shape', () => {
  const id = computePlanId({ context: baseContext(), allowConditional: false, exerciseIds: [] });
  assert.match(id, /^plan-[0-9a-f]{16}$/);
});
