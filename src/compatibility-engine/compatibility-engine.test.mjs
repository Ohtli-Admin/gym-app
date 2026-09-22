import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrainingContext } from '../context-engine/index.mjs';
import {
  evaluateExerciseCompatibility,
  evaluateCatalogCompatibility,
  CompatibilityInputError,
  REASON_CODES,
} from './index.mjs';

const buildContext = (overrides = {}) =>
  buildTrainingContext({
    trainingGoal: 'strength',
    environment: 'gym',
    timeAvailableMinutes: 45,
    experienceLevel: 'intermediate',
    modalities: ['gym'],
    equipment: ['dumbbell', 'barbell'],
    ...overrides,
  });

const buildExercise = (overrides = {}) => ({
  exerciseId: 'src-002-dumbbell-bench-press',
  name: 'Dumbbell Bench Press',
  equipmentRequired: ['dumbbell'],
  trainingModalities: ['gym'],
  bodyRegions: ['chest'],
  primaryMuscles: ['pectoralis_major'],
  jointActions: ['shoulder_horizontal_adduction'],
  movementPatterns: ['horizontal_push'],
  constraints: [],
  ...overrides,
});

test('1. compatible exercise with available equipment', () => {
  const result = evaluateExerciseCompatibility(buildContext(), buildExercise());
  assert.equal(result.status, 'compatible');
  assert.deepEqual(result.reasons, []);
});

test('2. missing required equipment -> incompatible', () => {
  const result = evaluateExerciseCompatibility(
    buildContext(),
    buildExercise({ equipmentRequired: ['kettlebell'] }),
  );
  assert.equal(result.status, 'incompatible');
  assert.equal(result.reasons.length, 1);
  assert.equal(result.reasons[0].code, REASON_CODES.EQUIPMENT_UNAVAILABLE);
  assert.equal(result.reasons[0].detail.equipment, 'kettlebell');
});

test('3. bodyweight/no-equipment exercise is compatible regardless of context equipment', () => {
  const context = buildContext({ equipment: ['dumbbell'] });

  const explicitBodyweight = evaluateExerciseCompatibility(
    context,
    buildExercise({ equipmentRequired: ['bodyweight'] }),
  );
  const emptyEquipment = evaluateExerciseCompatibility(
    context,
    buildExercise({ equipmentRequired: [] }),
  );

  assert.equal(explicitBodyweight.status, 'compatible');
  assert.equal(emptyEquipment.status, 'compatible');
});

test('4. requested modality match', () => {
  const context = buildContext({ modalities: ['gym', 'core'] });
  const result = evaluateExerciseCompatibility(context, buildExercise({ trainingModalities: ['core'] }));
  assert.equal(result.status, 'compatible');
});

test('5. modality mismatch -> incompatible', () => {
  const result = evaluateExerciseCompatibility(
    buildContext({ modalities: ['gym'] }),
    buildExercise({ trainingModalities: ['cardio'] }),
  );
  assert.equal(result.status, 'incompatible');
  assert.equal(result.reasons.length, 1);
  assert.equal(result.reasons[0].code, REASON_CODES.MODALITY_UNSATISFIED);
});

test('6. explicit hard restriction match -> incompatible', () => {
  const context = buildContext({
    restrictions: [{ description: 'Avoid overhead pressing', avoidTags: ['overhead_press'], severity: 'hard' }],
  });
  const result = evaluateExerciseCompatibility(
    context,
    buildExercise({ movementPatterns: ['overhead_press'] }),
  );
  assert.equal(result.status, 'incompatible');
  assert.equal(result.reasons.length, 1);
  assert.equal(result.reasons[0].code, REASON_CODES.RESTRICTION_HARD_MATCH);
  assert.deepEqual(result.reasons[0].detail.matchedTags, ['overhead_press']);
});

test('7. explicit conditional (soft) restriction match -> conditional', () => {
  const context = buildContext({
    restrictions: [{ description: 'Ease into overhead pressing', avoidTags: ['overhead_press'], severity: 'soft' }],
  });
  const result = evaluateExerciseCompatibility(
    context,
    buildExercise({ movementPatterns: ['overhead_press'] }),
  );
  assert.equal(result.status, 'conditional');
  assert.equal(result.reasons.length, 1);
  assert.equal(result.reasons[0].code, REASON_CODES.RESTRICTION_SOFT_MATCH);
});

test('8. hard exclusion takes precedence over conditional', () => {
  const context = buildContext({
    restrictions: [
      { description: 'Hard: avoid overhead pressing', avoidTags: ['overhead_press'], severity: 'hard' },
      { description: 'Soft: ease into deep knee flexion', avoidTags: ['deep_knee_flexion'], severity: 'soft' },
    ],
  });
  const result = evaluateExerciseCompatibility(
    context,
    buildExercise({ movementPatterns: ['overhead_press', 'deep_knee_flexion'] }),
  );

  assert.equal(result.status, 'incompatible');
  const codes = result.reasons.map((reason) => reason.code).sort();
  assert.deepEqual(codes, [REASON_CODES.RESTRICTION_HARD_MATCH, REASON_CODES.RESTRICTION_SOFT_MATCH].sort());
});

test('9. multiple reason codes are preserved, not short-circuited', () => {
  const context = buildContext({ modalities: ['gym'] });
  const result = evaluateExerciseCompatibility(
    context,
    buildExercise({ equipmentRequired: ['kettlebell'], trainingModalities: ['cardio'] }),
  );

  assert.equal(result.status, 'incompatible');
  const codes = result.reasons.map((reason) => reason.code).sort();
  assert.deepEqual(codes, [REASON_CODES.EQUIPMENT_UNAVAILABLE, REASON_CODES.MODALITY_UNSATISFIED].sort());
});

test('10. malformed exercise cannot silently become compatible', () => {
  const context = buildContext();

  const missingId = evaluateExerciseCompatibility(context, buildExercise({ exerciseId: undefined }));
  assert.equal(missingId.status, 'incompatible');
  assert.equal(missingId.reasons[0].code, REASON_CODES.EXERCISE_CONTRACT_INVALID);
  assert.equal(missingId.exerciseId, null);

  const wrongType = evaluateExerciseCompatibility(context, buildExercise({ equipmentRequired: 'dumbbell' }));
  assert.equal(wrongType.status, 'incompatible');
  assert.equal(wrongType.reasons[0].code, REASON_CODES.EXERCISE_CONTRACT_INVALID);
  // exerciseId is still a valid string here, so identity is preserved even
  // though the record as a whole is rejected.
  assert.equal(wrongType.exerciseId, 'src-002-dumbbell-bench-press');

  assert.equal(evaluateExerciseCompatibility(context, null).status, 'incompatible');
  assert.equal(evaluateExerciseCompatibility(context, 'not-an-object').status, 'incompatible');
});

test('11. catalog partitioning', () => {
  const context = buildContext({ modalities: ['gym'] });
  const compatibleExercise = buildExercise({ exerciseId: 'ex-compatible' });
  const incompatibleExercise = buildExercise({ exerciseId: 'ex-incompatible', equipmentRequired: ['kettlebell'] });
  const conditionalContext = buildContext({
    modalities: ['gym'],
    restrictions: [{ description: 'soft', avoidTags: ['overhead_press'], severity: 'soft' }],
  });

  // Evaluate the conditional case through the same catalog call by giving
  // it a restriction-bearing context and a matching exercise.
  const catalog = evaluateCatalogCompatibility(conditionalContext, [
    compatibleExercise,
    incompatibleExercise,
    buildExercise({ exerciseId: 'ex-conditional', movementPatterns: ['overhead_press'] }),
  ]);

  assert.equal(catalog.results.length, 3);
  assert.deepEqual(catalog.compatible.map((r) => r.exerciseId), ['ex-compatible']);
  assert.deepEqual(catalog.incompatible.map((r) => r.exerciseId), ['ex-incompatible']);
  assert.deepEqual(catalog.conditional.map((r) => r.exerciseId), ['ex-conditional']);
});

test('12. deterministic output for equivalent input', () => {
  const context = buildContext();

  const first = evaluateExerciseCompatibility(
    context,
    buildExercise({ equipmentRequired: ['Dumbbell', 'DUMBBELL'], trainingModalities: ['Gym'] }),
  );
  const second = evaluateExerciseCompatibility(
    context,
    buildExercise({ equipmentRequired: ['dumbbell'], trainingModalities: ['gym'] }),
  );

  assert.equal(first.status, second.status);
  assert.deepEqual(first.reasons, second.reasons);
  assert.equal(first.exerciseId, second.exerciseId);
});

test('13. no restriction is invented when context contains none', () => {
  const context = buildContext({ restrictions: [] });
  const result = evaluateExerciseCompatibility(
    context,
    buildExercise({ movementPatterns: ['overhead_press'], constraints: ['high_shoulder_load'] }),
  );

  assert.ok(!result.reasons.some((reason) => reason.code.startsWith('RESTRICTION_')));
  assert.equal(result.status, 'compatible');
});

test('14. exercise identity is preserved in the result', () => {
  const context = buildContext();
  const exercise = buildExercise({ exerciseId: 'src-002-identity-check' });

  const result = evaluateExerciseCompatibility(context, exercise);

  assert.equal(result.exerciseId, 'src-002-identity-check');
  assert.equal(result.exercise, exercise);
});

test('rejects a context that is not a normalized TrainingContext', () => {
  assert.throws(() => evaluateExerciseCompatibility({}, buildExercise()), CompatibilityInputError);
  assert.throws(() => evaluateExerciseCompatibility(null, buildExercise()), CompatibilityInputError);
});

test('evaluateCatalogCompatibility rejects a non-array exercises argument', () => {
  assert.throws(() => evaluateCatalogCompatibility(buildContext(), 'not-an-array'), CompatibilityInputError);
});

test('the result is frozen but the caller-owned exercise object is not', () => {
  const context = buildContext();
  const exercise = buildExercise();
  const result = evaluateExerciseCompatibility(context, exercise);

  assert.throws(() => {
    result.status = 'tampered';
  });
  // No side effect on caller-owned data: mutating the original exercise
  // object must still work after evaluation.
  exercise.name = 'still mutable';
  assert.equal(exercise.name, 'still mutable');
});
