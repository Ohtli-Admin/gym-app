import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrainingContext } from '../context-engine/index.mjs';
import { evaluateCatalogCompatibility } from '../compatibility-engine/index.mjs';
import { buildWorkoutPlan, PlannerInputError, PLAN_WARNING_CODES } from './index.mjs';
import { runVerticalSliceExample } from './examples/vertical-slice-example.mjs';

const buildContext = (overrides = {}) =>
  buildTrainingContext({
    trainingGoal: 'strength',
    environment: 'gym',
    timeAvailableMinutes: 30,
    experienceLevel: 'intermediate',
    modalities: ['gym'],
    equipment: ['dumbbell', 'barbell'],
    ...overrides,
  });

const buildExercise = (overrides = {}) => ({
  exerciseId: 'ex-default',
  name: 'Exercise',
  equipmentRequired: ['dumbbell'],
  trainingModalities: ['gym'],
  bodyRegions: [],
  primaryMuscles: [],
  jointActions: [],
  movementPatterns: [],
  constraints: [],
  ...overrides,
});

const evaluate = (context, exercises) => evaluateCatalogCompatibility(context, exercises);

test('1. builds a plan from compatible candidates', () => {
  const context = buildContext({ timeAvailableMinutes: 30 });
  const exercises = [buildExercise({ exerciseId: 'ex-1' }), buildExercise({ exerciseId: 'ex-2' })];
  const compat = evaluate(context, exercises);

  const plan = buildWorkoutPlan(context, compat);

  assert.equal(plan.status, 'ready');
  assert.deepEqual(
    plan.exercises.map((item) => item.exerciseId),
    ['ex-1', 'ex-2'],
  );
});

test('2. incompatible exercise is never selected', () => {
  const context = buildContext();
  const exercises = [
    buildExercise({ exerciseId: 'ex-ok' }),
    buildExercise({ exerciseId: 'ex-bad-equipment', equipmentRequired: ['kettlebell'] }),
  ];
  const compat = evaluate(context, exercises);
  assert.equal(compat.incompatible.length, 1);

  const plan = buildWorkoutPlan(context, compat);

  assert.ok(!plan.exercises.some((item) => item.exerciseId === 'ex-bad-equipment'));
});

test('3. compatible preferred over conditional', () => {
  const context = buildContext({
    timeAvailableMinutes: 6, // exactly one gym slot (6 min/exercise)
    restrictions: [{ description: 'soft', avoidTags: ['overhead_press'], severity: 'soft' }],
  });
  const exercises = [
    buildExercise({ exerciseId: 'ex-conditional', movementPatterns: ['overhead_press'] }),
    buildExercise({ exerciseId: 'ex-compatible' }),
  ];
  const compat = evaluate(context, exercises);

  const plan = buildWorkoutPlan(context, compat, { allowConditional: true });

  assert.equal(plan.exercises.length, 1);
  assert.equal(plan.exercises[0].exerciseId, 'ex-compatible');
  assert.equal(plan.exercises[0].status, 'compatible');
  assert.equal(plan.status, 'ready');
});

test('4. conditional excluded by default', () => {
  const context = buildContext({
    restrictions: [{ description: 'soft', avoidTags: ['overhead_press'], severity: 'soft' }],
  });
  const exercises = [buildExercise({ exerciseId: 'ex-conditional', movementPatterns: ['overhead_press'] })];
  const compat = evaluate(context, exercises);
  assert.equal(compat.conditional.length, 1);

  const plan = buildWorkoutPlan(context, compat);

  assert.equal(plan.exercises.length, 0);
  assert.equal(plan.status, 'unavailable');
  assert.ok(!plan.warnings.some((w) => w.code === PLAN_WARNING_CODES.CONDITIONAL_EXERCISES_INCLUDED));
});

test('5. conditional can be included through an explicit option', () => {
  const context = buildContext({
    restrictions: [{ description: 'soft', avoidTags: ['overhead_press'], severity: 'soft' }],
  });
  const exercises = [buildExercise({ exerciseId: 'ex-conditional', movementPatterns: ['overhead_press'] })];
  const compat = evaluate(context, exercises);

  const plan = buildWorkoutPlan(context, compat, { allowConditional: true });

  assert.equal(plan.exercises.length, 1);
  assert.equal(plan.exercises[0].exerciseId, 'ex-conditional');
  assert.equal(plan.status, 'partial');
});

test('6. conditional inclusion preserves reasons and produces a warning', () => {
  const context = buildContext({
    restrictions: [{ description: 'soft', avoidTags: ['overhead_press'], severity: 'soft' }],
  });
  const exercises = [buildExercise({ exerciseId: 'ex-conditional', movementPatterns: ['overhead_press'] })];
  const compat = evaluate(context, exercises);

  const plan = buildWorkoutPlan(context, compat, { allowConditional: true });

  assert.equal(plan.exercises[0].reasons.length, 1);
  assert.equal(plan.exercises[0].reasons[0].code, 'RESTRICTION_SOFT_MATCH');

  const warning = plan.warnings.find((w) => w.code === PLAN_WARNING_CODES.CONDITIONAL_EXERCISES_INCLUDED);
  assert.ok(warning);
  assert.deepEqual(warning.detail.exerciseIds, ['ex-conditional']);
});

test('7. a 20-minute context produces a smaller plan than a 90-minute context', () => {
  const exercises = Array.from({ length: 20 }, (_, index) => buildExercise({ exerciseId: `ex-${index}` }));

  const context20 = buildContext({ timeAvailableMinutes: 20 });
  const context90 = buildContext({ timeAvailableMinutes: 90 });

  const plan20 = buildWorkoutPlan(context20, evaluate(context20, exercises));
  const plan90 = buildWorkoutPlan(context90, evaluate(context90, exercises));

  assert.ok(plan20.exercises.length < plan90.exercises.length);
  // gym's flat estimate is 6 min/exercise (see planner-schema.mjs):
  // 20 min -> 3 exercises (18 min used), 90 min -> 15 exercises (90 min used).
  assert.equal(plan20.exercises.length, 3);
  assert.equal(plan90.exercises.length, 15);
});

test('8. requested modality is respected', () => {
  const context = buildContext({ modalities: ['cardio'], equipment: ['bodyweight'] });
  const exercises = [
    buildExercise({ exerciseId: 'ex-gym-only', trainingModalities: ['gym'], equipmentRequired: ['bodyweight'] }),
    buildExercise({ exerciseId: 'ex-cardio-only', trainingModalities: ['cardio'], equipmentRequired: ['bodyweight'] }),
  ];
  const compat = evaluate(context, exercises);

  const plan = buildWorkoutPlan(context, compat);

  assert.deepEqual(
    plan.exercises.map((item) => item.exerciseId),
    ['ex-cardio-only'],
  );
  assert.equal(plan.exercises[0].modality, 'cardio');
});

test('9. multiple modalities receive deterministic round-robin treatment', () => {
  const context = buildContext({ modalities: ['gym', 'cardio'], timeAvailableMinutes: 42 });
  const exercises = [
    buildExercise({ exerciseId: 'gym-1', trainingModalities: ['gym'] }),
    buildExercise({ exerciseId: 'cardio-1', trainingModalities: ['cardio'] }),
    buildExercise({ exerciseId: 'gym-2', trainingModalities: ['gym'] }),
    buildExercise({ exerciseId: 'cardio-2', trainingModalities: ['cardio'] }),
    buildExercise({ exerciseId: 'gym-3', trainingModalities: ['gym'] }),
    buildExercise({ exerciseId: 'cardio-3', trainingModalities: ['cardio'] }),
  ];
  const compat = evaluate(context, exercises);

  const plan = buildWorkoutPlan(context, compat);

  assert.deepEqual(
    plan.exercises.map((item) => item.modality),
    ['gym', 'cardio', 'gym', 'cardio', 'gym', 'cardio'],
  );
  assert.equal(plan.estimatedDurationMinutes, 42); // 3*6 (gym) + 3*8 (cardio)
});

test('10. duplicate exercise identity is not selected twice', () => {
  const context = buildContext({ modalities: ['gym', 'cardio'] });
  const multiModalExercise = buildExercise({ exerciseId: 'ex-multi', trainingModalities: ['gym', 'cardio'] });
  const compat = evaluate(context, [multiModalExercise]);

  const plan = buildWorkoutPlan(context, compat);

  assert.equal(plan.exercises.length, 1);
  assert.equal(plan.exercises[0].modality, 'gym'); // first requested modality wins the tie
});

test('11. no valid candidates -> unavailable, not an exception', () => {
  const context = buildContext();
  const compat = evaluate(context, []);

  const plan = buildWorkoutPlan(context, compat);

  assert.equal(plan.status, 'unavailable');
  assert.equal(plan.exercises.length, 0);
  assert.ok(plan.warnings.some((w) => w.code === PLAN_WARNING_CODES.MODALITY_NOT_COVERED));
});

test('12. insufficient candidates -> partial', () => {
  const context = buildContext({ modalities: ['gym', 'cardio'] });
  const exercises = [buildExercise({ exerciseId: 'gym-only', trainingModalities: ['gym'] })];
  const compat = evaluate(context, exercises);

  const plan = buildWorkoutPlan(context, compat);

  assert.equal(plan.status, 'partial');
  assert.equal(plan.exercises.length, 1);
  const warning = plan.warnings.find((w) => w.code === PLAN_WARNING_CODES.MODALITY_NOT_COVERED);
  assert.deepEqual(warning.detail.modalities, ['cardio']);
});

test('13. deterministic output for equivalent input', () => {
  const contextA = buildContext({ modalities: ['Gym'], equipment: ['Dumbbell'] });
  const contextB = buildContext({ modalities: ['gym'], equipment: ['dumbbell'] });

  const exerciseA = buildExercise({ equipmentRequired: ['DUMBBELL'], trainingModalities: ['Gym'] });
  const exerciseB = buildExercise({ equipmentRequired: ['dumbbell'], trainingModalities: ['gym'] });

  const planA = buildWorkoutPlan(contextA, evaluate(contextA, [exerciseA]));
  const planB = buildWorkoutPlan(contextB, evaluate(contextB, [exerciseB]));

  assert.deepEqual(planA, planB);
});

test('14. malformed caller input is rejected', () => {
  const context = buildContext();
  const compat = evaluate(context, [buildExercise()]);

  assert.throws(() => buildWorkoutPlan({}, compat), PlannerInputError);
  assert.throws(() => buildWorkoutPlan(context, {}), PlannerInputError);
  assert.throws(() => buildWorkoutPlan(context, compat, { allowConditional: 'yes' }), PlannerInputError);
});

test('15. integration: Context Engine + Compatibility Engine + Planner via in-memory fixtures', () => {
  const { context, compatibilityResult, plan } = runVerticalSliceExample();

  assert.equal(context.modalities.length, 2);
  assert.ok(compatibilityResult.compatible.length > 0);
  assert.ok(['ready', 'partial', 'unavailable'].includes(plan.status));
  assert.ok(plan.exercises.length > 0);
  assert.ok(plan.planId.startsWith('plan-'));
  // The fixture's soft restriction matches the overhead-press exercise;
  // with allowConditional:true it may be scheduled, which is why the
  // fixture is expected to demonstrate the 'partial' + warning path.
  assert.equal(plan.status, 'partial');
  assert.ok(plan.warnings.some((w) => w.code === PLAN_WARNING_CODES.CONDITIONAL_EXERCISES_INCLUDED));
});
