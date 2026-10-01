import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildLibraryProvider } from '../exercise-library/provider.mjs';
import { prescriptionForLibraryMetadata } from '../exercise-library/prescription-policy.mjs';
import { createSessionSlots, SESSION_KEYS } from './session-slots.mjs';
import {
  generatePreparedSession,
  getBuilderState,
  preparedViewModel,
  regenerateWarning,
  startPreparedSession,
  startWarning,
  getResumeState,
} from './session-builder.mjs';
import { logSet, completeExercise, goToExercise, finishSession } from './workout-session.mjs';
import { buildRuntimePhysicalContext, buildPhysicalContextMessages } from './physical-context.mjs';
import { defaultTodayUiState, buildPlanViewModel } from './today-view-model.mjs';

// A Map-backed Storage. A NEW createSessionSlots() over the SAME storage is
// exactly what a page refresh (or a new tab) sees.
function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

let providerPromise;
function provider() {
  providerPromise ??= (async () => {
    const dir = new URL('../exercise-library/generated/', import.meta.url);
    const [catalog, manifest] = await Promise.all(
      ['catalog.json', 'manifest.json'].map(async (f) => JSON.parse(await readFile(new URL(f, dir), 'utf8'))),
    );
    return buildLibraryProvider({ catalog, manifest });
  })();
  return providerPromise;
}

const NOW = new Date(2026, 8, 24, 10, 0, 0);
const calisthenics = () => ({ ...defaultTodayUiState(), modalities: ['calisthenics'], equipment: ['bodyweight'], environment: 'home' });

async function generate(slots, overrides = {}) {
  return generatePreparedSession({
    slots,
    origin: 'calistenia',
    uiState: calisthenics(),
    provider: await provider(),
    now: NOW,
    ...overrides,
  });
}

const planKey = (plan) => plan.exercises.map((i) => `${i.exerciseId}|${JSON.stringify(i.prescription)}`).join('\n');

test('1. a generated session survives remount/navigation exactly (ids, order, prescriptions)', async () => {
  const storage = fakeStorage();
  const slots = createSessionSlots(storage);
  const { result, prepared } = await generate(slots);
  assert.ok(result.ok);

  // "Navigate away and back" twice: only reads, never regenerates.
  for (let i = 0; i < 2; i += 1) {
    const state = getBuilderState(slots, 'calistenia');
    assert.equal(planKey(state.prepared.plan), planKey(result.plan));
    assert.deepEqual(state.prepared.seed, prepared.seed);
    assert.deepEqual(preparedViewModel(state.prepared).exercises, buildPlanViewModel(result.plan).exercises);
  }
  // Everything needed to restore/explain it is stored.
  const stored = getBuilderState(slots, 'calistenia').prepared;
  assert.equal(stored.state, 'generated');
  assert.deepEqual(stored.request.modalities, ['calisthenics']);
  assert.equal(stored.request.environment, 'home');
  assert.deepEqual(stored.context.libraryEquipment, ['bodyweight']);
  assert.equal(stored.library.repository, 'Ohtli-Admin/Gym-Exercise-Library');
  assert.match(stored.library.commit, /^[0-9a-f]{40}$/);
  assert.equal(stored.createdAt, NOW.toISOString());
  // Another origin does not see it as its own.
  assert.equal(getBuilderState(slots, 'especial').prepared, null);
  assert.equal(getBuilderState(slots, 'especial').otherPrepared.origin, 'calistenia');
});

test('2. an active session survives remount; the prepared slot is consumed', async () => {
  const slots = createSessionSlots(fakeStorage());
  const { result } = await generate(slots);
  const session = startPreparedSession(slots, { now: NOW.getTime() });

  const state = getBuilderState(slots, 'calistenia');
  assert.equal(state.prepared, null);
  assert.deepEqual(state.active, session);
  assert.deepEqual(state.active.exercises.map((e) => e.exerciseId), result.plan.exercises.map((e) => e.exerciseId));
  assert.equal(state.active.meta.origin, 'calistenia');
  assert.equal(state.active.meta.seed.value, '2026-09-24#0');
  assert.equal(state.active.startedAt, NOW.getTime());
  assert.deepEqual(getResumeState(slots), { active: true, activeOrigin: 'calistenia', preparedOrigin: null });
});

test('3. progress (sets, completion, current exercise) survives remount', async () => {
  const slots = createSessionSlots(fakeStorage());
  await generate(slots);
  let session = startPreparedSession(slots);
  session = logSet(session, 0, { reps: 10, weight: null });
  session = completeExercise(session, 0);
  session = goToExercise(session, 2);
  slots.saveActive(session); // what setActiveSession() does after every action

  const restored = getBuilderState(slots, 'calistenia').active;
  assert.equal(restored.currentIndex, 2);
  assert.equal(restored.exercises[0].sets.length, 1);
  assert.equal(restored.exercises[0].sets[0].reps, 10);
  assert.equal(restored.exercises[0].completed, true);
});

test('4. refresh (new store over the same storage) restores prepared and active sessions', async () => {
  const storage = fakeStorage();
  const before = createSessionSlots(storage);
  const { result } = await generate(before);

  const afterRefresh = createSessionSlots(storage);
  assert.equal(planKey(afterRefresh.getPrepared().plan), planKey(result.plan));

  let session = startPreparedSession(afterRefresh);
  session = logSet(session, 1, { reps: 8, weight: null });
  afterRefresh.saveActive(session);
  const secondRefresh = createSessionSlots(storage);
  assert.deepEqual(secondRefresh.getActive(), session);

  // Finalizar: no longer resumable, summary kept until dismissed.
  secondRefresh.completeActive(finishSession(session));
  const thirdRefresh = createSessionSlots(storage);
  assert.equal(thirdRefresh.getActive(), null);
  assert.ok(thirdRefresh.getLastCompleted().finishedAt);
  thirdRefresh.dismissLastCompleted();
  assert.equal(createSessionSlots(storage).getLastCompleted(), null);

  // A GA-005-era finished session left in the active key is migrated.
  storage.setItem(SESSION_KEYS.ACTIVE, JSON.stringify({ ...session, finishedAt: 1 }));
  assert.equal(createSessionSlots(storage).getActive(), null);
  assert.equal(createSessionSlots(storage).getLastCompleted().finishedAt, 1);
});

test('5. navigation, remount and refresh never advance the seed', async () => {
  const storage = fakeStorage();
  const slots = createSessionSlots(storage);
  await generate(slots);
  const seedBefore = storage.getItem(SESSION_KEYS.SEED);

  for (let i = 0; i < 5; i += 1) {
    const s = createSessionSlots(storage);
    getBuilderState(s, 'calistenia');
    getResumeState(s);
    preparedViewModel(s.getPrepared());
    regenerateWarning(s);
  }
  assert.equal(storage.getItem(SESSION_KEYS.SEED), seedBefore);
  assert.equal(createSessionSlots(storage).getPrepared().seed.value, '2026-09-24#0');
});

test('6. explicit regenerate warns, advances the seed and persists the new exact workout', async () => {
  const storage = fakeStorage();
  const slots = createSessionSlots(storage);
  const first = await generate(slots);
  assert.match(regenerateWarning(slots), /reemplaza/);

  const second = await generate(slots);
  assert.equal(second.prepared.seed.value, '2026-09-24#1');
  assert.notEqual(planKey(second.result.plan), planKey(first.result.plan));
  assert.equal(planKey(createSessionSlots(storage).getPrepared().plan), planKey(second.result.plan));

  // Same date, same attempt -> the same workout (reproducible).
  const replay = await generate(createSessionSlots(fakeStorage()));
  assert.equal(planKey(replay.result.plan), planKey(first.result.plan));

  // A new day starts again at #0.
  const nextDay = await generate(slots, { now: new Date(2026, 8, 25, 9) });
  assert.equal(nextDay.prepared.seed.value, '2026-09-25#0');

  // Starting over an unfinished active session asks first.
  assert.equal(startWarning(slots), null);
  startPreparedSession(slots);
  await generate(slots);
  assert.match(startWarning(slots), /sesión en curso/);
});

test('7. persistent user-authored physical context reaches generation verbatim, without rules', async () => {
  const slots = createSessionSlots(fakeStorage());
  const profileText = 'Tendinitis en el hombro derecho; me molesta levantar el brazo.';
  const { result, prepared } = await generate(slots, { physicalInputs: { profileText } });

  const userRestriction = result.context.restrictions.find((r) => r.description === profileText);
  assert.ok(userRestriction, 'profile text is part of the Context Engine input');
  assert.deepEqual(userRestriction.avoidTags, [], 'no avoid-tags are derived from free text');
  assert.equal(prepared.physicalContext.profileText, profileText);
  // Free text alone excludes nothing: same candidates as without it.
  const plain = await generate(createSessionSlots(fakeStorage()));
  assert.equal(result.compatibilityResult.compatible.length, plain.result.compatibilityResult.compatible.length);
  assert.match(buildPhysicalContextMessages(prepared.physicalContext).join(' '), /no se puede evaluar automáticamente/);
});

test('8. temporary session context stays with its session and does not persist beyond it', async () => {
  const storage = fakeStorage();
  const slots = createSessionSlots(storage);
  const sessionText = 'Hoy me duele la rodilla y entreno en casa';
  const { result, prepared } = await generate(slots, { origin: 'especial', physicalInputs: { sessionText } });

  assert.equal(result.context.preferences.notes, sessionText);
  assert.equal(result.context.restrictions.length, 0, 'session text is not turned into a restriction');
  assert.equal(prepared.sessionContext.text, sessionText);

  const session = startPreparedSession(slots);
  slots.completeActive(finishSession(session));
  slots.dismissLastCompleted();
  const everything = [...storage.map.values()].join('\n');
  assert.ok(!everything.includes(sessionText), 'gone once its session is done');
  assert.ok(!storage.map.has('gymapp.specialObjective.v1'), 'never saved as an "adapt my plans" objective');
});

test('9. legacy lesion chips still work (Hombro excludes shoulder_girdle exercises)', async () => {
  const p = await provider();
  const byId = new Map(p.exercises.map((e) => [e.exerciseId, e]));
  const { result, prepared } = await generate(createSessionSlots(fakeStorage()), {
    physicalInputs: { legacyChips: ['Hombro', 'Rodilla'] },
  });
  assert.ok(result.plan.exercises.every((i) => !byId.get(i.exerciseId).bodyRegions.includes('shoulder_girdle')));
  assert.deepEqual(prepared.physicalContext.verifiedChips, ['Hombro']);
  assert.deepEqual(prepared.physicalContext.unverifiableChips, ['Rodilla']);
  const text = buildPhysicalContextMessages(prepared.physicalContext).join(' ');
  assert.match(text, /aplicó las restricciones que pudo verificar/);
  assert.match(text, /podrían no detectarse/);
  assert.doesNotMatch(text, /segur/i, 'never calls anything safe');
});

test('10. no generated interpretation is written back as a permanent profile fact', async () => {
  const storage = fakeStorage();
  const slots = createSessionSlots(storage);
  const inputs = Object.freeze({ legacyChips: Object.freeze(['Hombro']), profileText: 'Lumbalgia crónica', sessionText: 'hoy sin saltos' });
  await generate(slots, { physicalInputs: inputs }); // frozen: any write-back would throw

  assert.deepEqual(inputs.legacyChips, ['Hombro']);
  assert.equal(inputs.profileText, 'Lumbalgia crónica');
  const writtenKeys = [...storage.map.keys()];
  assert.ok(writtenKeys.every((key) => Object.values(SESSION_KEYS).includes(key)), `unexpected keys: ${writtenKeys}`);

  // The runtime context is rebuilt from the same explicit inputs every
  // time; nothing derived is cached or accumulates.
  const a = buildRuntimePhysicalContext(inputs);
  const b = buildRuntimePhysicalContext(inputs);
  assert.deepEqual(a, b);
  assert.equal(buildRuntimePhysicalContext({}).restrictions.length, 0);
});

test('prescription policy: ranges from objective metadata only, no invented precision', async () => {
  assert.deepEqual(
    [
      prescriptionForLibraryMetadata({ trainingTypes: ['plyometrics'], mechanic: 'compound' }),
      prescriptionForLibraryMetadata({ trainingTypes: ['strength'], mechanic: 'isolation' }),
      prescriptionForLibraryMetadata({ trainingTypes: ['strength'], mechanic: 'compound' }),
    ].map((p) => [p.repsMin, p.repsMax, p.basis]),
    [
      [6, 8, 'training_type:plyometrics'],
      [12, 15, 'mechanic:isolation'],
      [8, 12, 'mechanic:compound'],
    ],
  );
  const unknown = prescriptionForLibraryMetadata({ trainingTypes: ['strength'], mechanic: null });
  assert.equal(unknown.reps, null);
  assert.equal(unknown.repsMin, null);
  assert.equal(buildPlanViewModel({ ...emptyPlan(), exercises: [item(unknown)] }).exercises[0].prescriptionText, '3 series (repeticiones a tu criterio)');
  assert.equal(
    buildPlanViewModel({ ...emptyPlan(), exercises: [item(prescriptionForLibraryMetadata({ trainingTypes: ['plyometrics'] }))] }).exercises[0].prescriptionText,
    '3 series x 6–8 repeticiones',
  );

  // Real generated plan: each prescription matches that exercise's metadata.
  const p = await provider();
  const byId = new Map(p.exercises.map((e) => [e.exerciseId, e]));
  const { result } = await generate(createSessionSlots(fakeStorage()));
  for (const planned of result.plan.exercises) {
    const { trainingTypes, mechanic } = byId.get(planned.exerciseId).library;
    assert.deepEqual(planned.prescription, prescriptionForLibraryMetadata({ trainingTypes, mechanic }));
  }
  assert.ok(new Set(result.plan.exercises.map((i) => i.prescription.basis)).size > 1, 'not every exercise is 3x12');
});

function emptyPlan() {
  return {
    status: 'ready',
    requestedDurationMinutes: 45,
    estimatedDurationMinutes: 5,
    modalitiesCovered: ['calisthenics'],
    warnings: [],
    planId: 'p',
  };
}

function item(prescription) {
  return { order: 1, exerciseId: 'x', name: 'x', modality: 'calisthenics', status: 'compatible', reasons: [], prescription, estimatedDurationMinutes: 5 };
}
