import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildTrainingContext } from '../context-engine/index.mjs';
import { evaluateCatalogCompatibility } from '../compatibility-engine/index.mjs';
import { buildWorkoutPlan } from '../workout-planner/index.mjs';
import { adaptLibraryRecord, LibraryRecordRejectedError } from './library-adapter.mjs';
import { evaluatePilotRecord, filterPilotCatalog, REJECTION_REASONS, PILOT_POLICY_VERSION } from './pilot-policy.mjs';
import { resolveModalities, MODALITY_SOURCES, isCalisthenicsPolicyCandidate } from './modality-policy.mjs';
import { mapGymAppEquipmentToLibrary, toLibraryEquipmentContext, GYMAPP_EQUIPMENT_UNMAPPED } from './equipment-mapping.mjs';
import { buildLibraryProvider, loadLibraryProvider, LibrarySnapshotError } from './provider.mjs';
import { runLibraryOrchestration } from '../today-experience/orchestrator.mjs';
import { defaultTodayUiState, buildTodayViewModel } from '../today-experience/today-view-model.mjs';
import { buildPhysicalContextMessages } from '../today-experience/physical-context.mjs';
import { applyVarietyPolicy, orderForVariety, varietyKey } from './session-variety-policy.mjs';
import { profileInjuriesToRestrictions } from './profile-restriction-mapping.mjs';
import { getDemoExerciseCatalog } from '../today-experience/demo-catalog-provider.mjs';

// Shaped exactly like a real Library schema 0.2 record (see
// ../Gym-Exercise-Library/schemas/exercise.schema.json).
function libraryRecord(overrides = {}) {
  const base = {
    schema_version: '0.2',
    exercise_id: 'src-002-abc123',
    status: 'draft',
    names: { es: null, en: 'Push-Up' },
    aliases: [],
    classification: {
      body_regions: ['shoulder_girdle'],
      primary_muscles: ['pectorals'],
      secondary_muscles: [],
      stabilizers: [],
      movement_patterns: [],
      joint_actions: [],
      training_types: ['strength'],
    },
    setup: { equipment_required: ['bodyweight'], equipment_optional: [], body_positions: [], grips: {} },
    difficulty: { overall: 'beginner' },
    biomechanics: { constraints: [] },
    canonicalization: {},
    media: { primary_image: null },
    provenance: [],
    review: { status: 'review_required' },
  };
  return {
    ...base,
    ...overrides,
    names: { ...base.names, ...overrides.names },
    classification: { ...base.classification, ...overrides.classification },
    setup: { ...base.setup, ...overrides.setup },
    biomechanics: { ...base.biomechanics, ...overrides.biomechanics },
  };
}

async function readSnapshot() {
  const dir = new URL('./generated/', import.meta.url);
  const [catalog, manifest] = await Promise.all(
    ['catalog.json', 'manifest.json'].map(async (file) => JSON.parse(await readFile(new URL(file, dir), 'utf8'))),
  );
  return { catalog, manifest };
}

function calisthenicsUiState(overrides = {}) {
  return { ...defaultTodayUiState(), modalities: ['calisthenics'], equipment: ['bodyweight'], ...overrides };
}

test('1. valid Library record -> correct GymApp exercise shape', () => {
  const exercise = adaptLibraryRecord(
    libraryRecord({
      setup: { equipment_required: ['bodyweight'], equipment_optional: ['weighted_vest'] },
      biomechanics: { constraints: ['wrist_extension_load'] },
      classification: { joint_actions: ['elbow_extension'], movement_patterns: ['horizontal_push'] },
    }),
  );
  assert.equal(exercise.exerciseId, 'src-002-abc123');
  assert.equal(exercise.name, 'Push-Up');
  assert.deepEqual(exercise.equipmentRequired, ['bodyweight']);
  assert.deepEqual(exercise.equipmentOptional, ['weighted_vest']);
  assert.deepEqual(exercise.bodyRegions, ['shoulder_girdle']);
  assert.deepEqual(exercise.primaryMuscles, ['pectorals']);
  assert.deepEqual(exercise.jointActions, ['elbow_extension']);
  assert.deepEqual(exercise.movementPatterns, ['horizontal_push']);
  assert.deepEqual(exercise.constraints, ['wrist_extension_load']);
  assert.deepEqual(exercise.trainingModalities, ['gym', 'calisthenics']);
  assert.equal(exercise.library.trust, 'pilot');
  assert.equal(exercise.library.status, 'draft');
  assert.equal(exercise.library.reviewStatus, 'review_required');
});

test('2. Spanish name preferred, English fallback, blank Spanish ignored', () => {
  assert.equal(adaptLibraryRecord(libraryRecord({ names: { es: 'Flexión', en: 'Push-Up' } })).name, 'Flexión');
  assert.equal(adaptLibraryRecord(libraryRecord({ names: { es: 'Flexión', en: 'Push-Up' } })).library.nameLanguage, 'es');
  const fallback = adaptLibraryRecord(libraryRecord({ names: { es: null, en: 'Push-Up' } }));
  assert.equal(fallback.name, 'Push-Up');
  assert.equal(fallback.library.nameLanguage, 'en');
  assert.equal(adaptLibraryRecord(libraryRecord({ names: { es: '   ', en: 'Push-Up' } })).name, 'Push-Up');
});

test('3. canonical exercise_id is preserved exactly (no case/format rewrite)', () => {
  const id = 'src-002-903b8fd1f633976e';
  assert.equal(adaptLibraryRecord(libraryRecord({ exercise_id: id })).exerciseId, id);
});

test('4. malformed/incomplete records are rejected, never fabricated', () => {
  const cases = [
    [null, REJECTION_REASONS.RECORD_NOT_OBJECT],
    [libraryRecord({ exercise_id: 'Bad ID' }), REJECTION_REASONS.EXERCISE_ID_INVALID],
    [libraryRecord({ schema_version: '0.1' }), REJECTION_REASONS.SCHEMA_VERSION_UNSUPPORTED],
    [libraryRecord({ status: 'deprecated' }), REJECTION_REASONS.STATUS_NOT_ACCEPTED],
    [libraryRecord({ names: { es: null, en: '' } }), REJECTION_REASONS.NAME_MISSING],
    [libraryRecord({ setup: { equipment_required: [] } }), REJECTION_REASONS.EQUIPMENT_REQUIRED_EMPTY],
    [libraryRecord({ setup: { equipment_required: null } }), REJECTION_REASONS.EQUIPMENT_REQUIRED_INVALID],
    [libraryRecord({ classification: { training_types: [] } }), REJECTION_REASONS.TRAINING_TYPES_EMPTY],
    [libraryRecord({ classification: { primary_muscles: 'pectorals' } }), REJECTION_REASONS.OBJECTIVE_METADATA_INVALID],
  ];
  for (const [record, code] of cases) {
    const { accepted, reasons } = evaluatePilotRecord(record);
    assert.equal(accepted, false, code);
    assert.ok(reasons.some((r) => r.code === code), `${code} expected, got ${reasons.map((r) => r.code)}`);
  }
  assert.throws(() => adaptLibraryRecord(libraryRecord({ setup: { equipment_required: [] } })), LibraryRecordRejectedError);

  // Taxonomy-aware checks (as run by the sync tool) and duplicate ids.
  const unknown = evaluatePilotRecord(libraryRecord({ setup: { equipment_required: ['jetpack'] } }), {
    equipmentIds: ['bodyweight'],
    trainingTypeIds: ['strength'],
  });
  assert.ok(unknown.reasons.some((r) => r.code === REJECTION_REASONS.EQUIPMENT_ID_UNKNOWN));
  const { accepted, rejected } = filterPilotCatalog([libraryRecord(), libraryRecord()]);
  assert.equal(accepted.length, 1);
  assert.equal(rejected[0].reasons[0].code, REJECTION_REASONS.EXERCISE_ID_DUPLICATE);
});

test('5. training-type -> modality mapping, with provenance kept separate', () => {
  assert.deepEqual(resolveModalities(['cardio'], ['treadmill']).modalities, ['cardio']);
  assert.deepEqual(resolveModalities(['core_training'], ['ab_wheel']).modalities, ['core']);
  assert.deepEqual(resolveModalities(['calisthenics'], ['rings']).provenance, {
    calisthenics: [MODALITY_SOURCES.CANONICAL_TRAINING_TYPE],
  });
  assert.deepEqual(resolveModalities(['powerlifting'], ['barbell']).modalities, ['gym']);

  const stretch = resolveModalities(['stretching'], ['bodyweight']);
  assert.deepEqual(stretch.modalities, []);
  assert.deepEqual(stretch.unmappedTrainingTypes, ['stretching']);

  // GymApp Calisthenics policy: equipment family + training type only.
  const bodyweightStrength = resolveModalities(['strength'], ['bodyweight']);
  assert.deepEqual(bodyweightStrength.provenance.calisthenics, [MODALITY_SOURCES.GYMAPP_CALISTHENICS_POLICY]);
  assert.equal(isCalisthenicsPolicyCandidate(['pullup_bar', 'bodyweight'], ['strength']), true);
  assert.equal(isCalisthenicsPolicyCandidate(['bodyweight', 'dumbbell'], ['strength']), false);
  assert.equal(isCalisthenicsPolicyCandidate([], ['strength']), false);
  // Names never matter: a record literally named "Calisthenics Pull-Up"
  // with barbell equipment is NOT a candidate.
  const byName = adaptLibraryRecord(
    libraryRecord({ names: { en: 'Calisthenics Pull-Up' }, setup: { equipment_required: ['barbell'] } }),
  );
  assert.ok(!byName.trainingModalities.includes('calisthenics'));
});

test('6. equipment mapping boundary: GymApp vocabulary -> Library ids, unmapped reported', () => {
  const { equipment, unmapped } = mapGymAppEquipmentToLibrary(['bodyweight', 'pull_up_bar', 'bench', 'machine', 'dumbbell']);
  assert.deepEqual(equipment, ['bodyweight', 'pullup_bar', 'dumbbell']);
  assert.deepEqual(unmapped, ['bench', 'machine']);
  assert.deepEqual(GYMAPP_EQUIPMENT_UNMAPPED, ['bench', 'machine', 'cardio_machine', 'bike']);

  const context = buildTrainingContext({
    trainingGoal: 'general_fitness',
    environment: 'home',
    timeAvailableMinutes: 30,
    experienceLevel: 'beginner',
    modalities: ['calisthenics'],
    equipment: ['pull_up_bar'],
  });
  const adapted = toLibraryEquipmentContext(context);
  assert.deepEqual(adapted.context.equipment, ['pullup_bar']);
  assert.deepEqual(context.equipment, ['pull_up_bar'], 'original context untouched');

  // A Library pull-up-bar exercise is available only through the mapped id.
  const pullUp = adaptLibraryRecord(libraryRecord({ setup: { equipment_required: ['pullup_bar'] } }));
  assert.equal(evaluateCatalogCompatibility(context, [pullUp]).compatible.length, 0);
  assert.equal(evaluateCatalogCompatibility(adapted.context, [pullUp]).compatible.length, 1);
});

test('7. Calisthenics provider returns real synced Library records', async () => {
  const snapshot = await readSnapshot();
  const provider = buildLibraryProvider(snapshot);
  assert.equal(snapshot.manifest.filteringPolicy.version, PILOT_POLICY_VERSION);
  assert.equal(snapshot.manifest.source.repository, 'Ohtli-Admin/Gym-Exercise-Library');
  assert.equal(provider.exercises.length, snapshot.manifest.importedRecordCount);
  assert.equal(provider.runtimeRejected.length, 0);

  const snapshotIds = new Set(snapshot.catalog.map((r) => r.exercise_id));
  const calisthenics = provider.exercises.filter((e) => e.trainingModalities.includes('calisthenics'));
  assert.ok(calisthenics.length > 0);
  assert.equal(calisthenics.length, snapshot.manifest.diagnostics.calisthenicsPolicyCandidates.accepted);
  for (const exercise of calisthenics) {
    assert.ok(snapshotIds.has(exercise.exerciseId));
    assert.equal(exercise.library.source, 'Gym-Exercise-Library');
  }
});

test('8. Compatibility Engine accepts provider output (no contract errors)', async () => {
  const provider = buildLibraryProvider(await readSnapshot());
  const { context } = toLibraryEquipmentContext(
    buildTrainingContext({
      trainingGoal: 'general_fitness',
      environment: 'gym',
      timeAvailableMinutes: 45,
      experienceLevel: 'intermediate',
      modalities: ['gym', 'calisthenics', 'cardio', 'core'],
      equipment: ['bodyweight', 'dumbbell', 'barbell', 'kettlebell', 'resistance_band', 'pull_up_bar'],
    }),
  );
  const result = evaluateCatalogCompatibility(context, provider.exercises);
  assert.equal(result.results.length, provider.exercises.length);
  const contractInvalid = result.incompatible.filter((r) => r.reasons.some((reason) => reason.code === 'EXERCISE_CONTRACT_INVALID'));
  assert.equal(contractInvalid.length, 0);
  assert.ok(result.compatible.length > 0);
});

test('9. Workout Planner builds a Calisthenics session from provider output', async () => {
  const provider = buildLibraryProvider(await readSnapshot());
  const { context } = toLibraryEquipmentContext(
    buildTrainingContext({
      trainingGoal: 'general_fitness',
      environment: 'home',
      timeAvailableMinutes: 45,
      experienceLevel: 'intermediate',
      modalities: ['calisthenics'],
      equipment: ['bodyweight'],
    }),
  );
  const plan = buildWorkoutPlan(context, evaluateCatalogCompatibility(context, provider.exercises), { allowConditional: false });
  assert.equal(plan.status, 'ready');
  assert.ok(plan.exercises.length > 0);
  const byId = new Map(provider.exercises.map((e) => [e.exerciseId, e]));
  for (const item of plan.exercises) {
    assert.equal(item.modality, 'calisthenics');
    assert.equal(item.name, byId.get(item.exerciseId).name);
    assert.deepEqual(byId.get(item.exerciseId).equipmentRequired, ['bodyweight']);
  }
});

test('10. Calisthenics path uses the Library provider, never the demo catalog', async () => {
  const provider = buildLibraryProvider(await readSnapshot());
  const result = runLibraryOrchestration(calisthenicsUiState(), provider);
  assert.ok(result.ok);
  assert.equal(result.catalogSource, 'exercise_library');

  const demoIds = new Set(getDemoExerciseCatalog().map((e) => e.exerciseId));
  const libraryIds = new Set(provider.exercises.map((e) => e.exerciseId));
  assert.equal(result.compatibilityResult.results.length, provider.exercises.length);
  for (const item of result.plan.exercises) {
    assert.ok(!demoIds.has(item.exerciseId));
    assert.ok(libraryIds.has(item.exerciseId));
  }
  assert.ok(buildTodayViewModel(result).sourceNote);

  // No provider -> explicit catalog_missing, no silent demo fallback.
  const missing = runLibraryOrchestration(calisthenicsUiState(), null);
  assert.equal(missing.ok, false);
  assert.equal(missing.errorKind, 'catalog_missing');
  assert.match(buildTodayViewModel(missing).message, /sync-exercise-library/);
});

test('snapshot loader: missing files and stale policy become LibrarySnapshotError', async () => {
  const notFound = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(loadLibraryProvider({ fetchImpl: notFound, baseUrl: 'http://x/generated/' }), LibrarySnapshotError);

  const snapshot = await readSnapshot();
  assert.throws(
    () => buildLibraryProvider({ ...snapshot, manifest: { ...snapshot.manifest, filteringPolicy: { version: 'old' } } }),
    LibrarySnapshotError,
  );
});

// --- GA-006 hardening ----------------------------------------------------

test('11. variety policy: seeded, reproducible, diverse; compatibility decisions preserved', async () => {
  const provider = buildLibraryProvider(await readSnapshot());
  const byId = new Map(provider.exercises.map((e) => [e.exerciseId, e]));
  const run = (seed) => runLibraryOrchestration(calisthenicsUiState({ sessionSeed: seed }), provider);
  const idsOf = (result) => result.plan.exercises.map((item) => item.exerciseId).join();

  const first = run('2026-09-24#0');
  assert.equal(idsOf(first), idsOf(run('2026-09-24#0')), 'same seed -> same session');

  const sessions = new Set();
  for (let day = 1; day <= 7; day += 1) sessions.add(idsOf(run(`2026-09-0${day}#0`)));
  assert.ok(sessions.size >= 6, `expected different sessions across days, got ${sessions.size}`);

  // Consecutive picks come from different muscle/region groups.
  const keys = first.plan.exercises.map((item) => varietyKey(byId.get(item.exerciseId)));
  assert.equal(new Set(keys).size, keys.length);

  // Only order changes: every planned item is still a compatible candidate,
  // and the compatibility result itself is identical to a direct call.
  const compatibleIds = new Set(first.compatibilityResult.compatible.map((r) => r.exerciseId));
  assert.ok(first.plan.exercises.every((item) => compatibleIds.has(item.exerciseId)));
  const reordered = applyVarietyPolicy(first.compatibilityResult, { seed: 's' });
  assert.deepEqual(new Set(reordered.compatible), new Set(first.compatibilityResult.compatible));
  assert.equal(reordered.incompatible, first.compatibilityResult.incompatible);
});

test('12. variety policy prefers exercises at or below the user level (never excludes)', () => {
  const candidate = (id, difficulty, muscle) => ({
    exerciseId: id,
    status: 'compatible',
    reasons: [],
    exercise: { exerciseId: id, primaryMuscles: [muscle], bodyRegions: [], library: { difficulty } },
  });
  const results = [candidate('a', 'expert', 'm1'), candidate('b', 'beginner', 'm2'), candidate('c', 'intermediate', 'm3')];
  const ordered = orderForVariety(results, 'seed', 'beginner').map((r) => r.exerciseId);
  assert.equal(ordered[0], 'b');
  assert.deepEqual(new Set(ordered), new Set(['a', 'b', 'c']));
  assert.equal(orderForVariety(results, 'seed', 'advanced').at(-1).exerciseId, 'a', 'expert is above advanced');
});

test('13. profile restrictions: only structured lesiones, mapped to Library regions', () => {
  const { restrictions, applied, unverifiable } = profileInjuriesToRestrictions(['Hombro', 'Rodilla', 'Hombro', '', 42]);
  assert.deepEqual(applied, ['Hombro']);
  assert.deepEqual(unverifiable, ['Rodilla']);
  assert.equal(restrictions.length, 1);
  assert.deepEqual(restrictions[0].avoidTags, ['shoulder_girdle']);
  assert.equal(restrictions[0].severity, undefined, 'severity left to Context Engine default (hard)');
  assert.deepEqual(profileInjuriesToRestrictions(undefined).restrictions, []);

  // Free text is never a key: an arbitrary diagnosis string maps to nothing.
  assert.deepEqual(profileInjuriesToRestrictions(['tendinitis del manguito rotador']).restrictions, []);

  const messages = buildPhysicalContextMessages({ verifiedChips: applied, unverifiableChips: unverifiable, profileText: null, sessionText: null });
  assert.match(messages.join(' '), /Hombro.*Rodilla/s);
  assert.deepEqual(buildPhysicalContextMessages({ verifiedChips: [], unverifiableChips: [], profileText: null, sessionText: null }), []);
});

test('14. profile restrictions reach Context Engine and exclude matching Calisthenics exercises', async () => {
  const provider = buildLibraryProvider(await readSnapshot());
  const byId = new Map(provider.exercises.map((e) => [e.exerciseId, e]));
  const { restrictions } = profileInjuriesToRestrictions(['Hombro']);
  const result = runLibraryOrchestration(calisthenicsUiState({ sessionSeed: 'x', profileRestrictions: restrictions }), provider);
  assert.ok(result.ok);
  assert.equal(result.context.restrictions.length, 1);
  assert.equal(result.context.restrictions[0].severity, 'hard');
  const hardMatched = result.compatibilityResult.incompatible.filter((r) =>
    r.reasons.some((reason) => reason.code === 'RESTRICTION_HARD_MATCH'),
  );
  assert.ok(hardMatched.length > 0);
  for (const item of result.plan.exercises) {
    assert.ok(!byId.get(item.exerciseId).bodyRegions.includes('shoulder_girdle'));
  }
});

test('15. Entrenamiento especial (independiente) uses the Library provider, not the demo catalog', async () => {
  // app.js is a classic script (not importable here): assert its single
  // session-builder mount always requests the Library catalog.
  const appJs = await readFile(new URL('../../app.js', import.meta.url), 'utf8');
  const builder = appJs.slice(appJs.indexOf('function montarArmadorSesion'), appJs.indexOf('// Auth', appJs.indexOf('function montarArmadorSesion')));
  assert.match(builder, /catalogSource: 'exercise_library'/);
  assert.match(builder, /getPhysicalContextInputs/);
  assert.equal((appJs.match(/catalogSource/g) ?? []).length, 1, 'no other mount can select the demo catalog');
  assert.match(appJs, /montarArmadorSesion\(document\.getElementById\('today-root'\), \{ origen: 'especial' \}\)/);

  // The multi-modality independent session runs on Library records only.
  const provider = buildLibraryProvider(await readSnapshot());
  const demoIds = new Set(getDemoExerciseCatalog().map((e) => e.exerciseId));
  const result = runLibraryOrchestration(
    { ...defaultTodayUiState(), modalities: ['gym', 'calisthenics'], equipment: ['bodyweight', 'dumbbell'], sessionSeed: 'x' },
    provider,
  );
  assert.ok(result.ok);
  assert.ok(result.plan.exercises.length > 0);
  assert.ok(result.plan.exercises.every((item) => !demoIds.has(item.exerciseId)));
});
