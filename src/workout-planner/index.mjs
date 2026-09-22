import { allocateExercises } from './allocate.mjs';
import { computePlanId } from './plan-id.mjs';
import { PlannerInputError } from './errors.mjs';
import { PLAN_WARNING_CODES } from './planner-schema.mjs';

export { PlannerInputError } from './errors.mjs';
export * from './planner-schema.mjs';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// `context` and `compatibilityResult` are trusted, single pipeline inputs —
// the direct outputs of buildTrainingContext() and
// evaluateCatalogCompatibility(). An invalid shape here is a caller/
// integration bug, so this throws rather than being folded into a plan
// status. Contrast with an ordinary "no valid workout" outcome, which is
// PLAN_STATUSES.unavailable, never a throw.
function assertValidContextShape(context) {
  if (!isPlainObject(context) || !Array.isArray(context.modalities) || context.modalities.length === 0) {
    throw new PlannerInputError(
      'context must be a normalized TrainingContext with a non-empty modalities array (see buildTrainingContext()).',
    );
  }
  if (typeof context.timeAvailableMinutes !== 'number' || !Number.isFinite(context.timeAvailableMinutes)) {
    throw new PlannerInputError('context.timeAvailableMinutes must be a finite number.');
  }
  if (!Array.isArray(context.equipment) || !Array.isArray(context.restrictions)) {
    throw new PlannerInputError(
      'context.equipment and context.restrictions must be arrays (did you pass the output of buildTrainingContext()?).',
    );
  }
}

function isResultBucketValid(bucket) {
  return (
    Array.isArray(bucket) &&
    bucket.every(
      (item) =>
        isPlainObject(item) &&
        typeof item.exerciseId === 'string' &&
        typeof item.status === 'string' &&
        Array.isArray(item.reasons) &&
        'exercise' in item,
    )
  );
}

function assertValidCompatibilityResultShape(compatibilityResult) {
  if (
    !isPlainObject(compatibilityResult) ||
    !isResultBucketValid(compatibilityResult.compatible) ||
    !isResultBucketValid(compatibilityResult.conditional) ||
    !Array.isArray(compatibilityResult.incompatible)
  ) {
    throw new PlannerInputError(
      'compatibilityResult must be the object returned by evaluateCatalogCompatibility() (see src/compatibility-engine).',
    );
  }
}

function resolveOptions(options) {
  if (options === undefined) {
    return { allowConditional: false };
  }
  if (!isPlainObject(options)) {
    throw new PlannerInputError('options must be an object when provided.');
  }
  if (options.allowConditional !== undefined && typeof options.allowConditional !== 'boolean') {
    throw new PlannerInputError('options.allowConditional must be a boolean when provided.');
  }
  return { allowConditional: options.allowConditional === true };
}

// READY: every requested modality got at least one exercise, using only
// compatible candidates.
// PARTIAL: a non-empty plan was produced, but at least one requested
// modality has no exercise, or a conditional candidate had to be used to
// fill a slot (rule C — using conditional is itself "not fully satisfied
// by ideal/compatible-only means").
// UNAVAILABLE: no exercise could be scheduled at all.
function resolvePlanStatus(plannedItems, requestedModalities) {
  if (plannedItems.length === 0) {
    return 'unavailable';
  }
  const coveredModalities = new Set(plannedItems.map((item) => item.modality));
  const allModalitiesCovered = requestedModalities.every((modality) => coveredModalities.has(modality));
  const usedConditional = plannedItems.some((item) => item.status === 'conditional');
  return allModalitiesCovered && !usedConditional ? 'ready' : 'partial';
}

function buildWarnings(plannedItems, requestedModalities) {
  const warnings = [];

  const conditionalIds = plannedItems
    .filter((item) => item.status === 'conditional')
    .map((item) => item.exerciseId);
  if (conditionalIds.length > 0) {
    warnings.push({
      code: PLAN_WARNING_CODES.CONDITIONAL_EXERCISES_INCLUDED,
      message: 'One or more conditional exercises were included to complete this plan.',
      detail: { exerciseIds: conditionalIds },
    });
  }

  const coveredModalities = new Set(plannedItems.map((item) => item.modality));
  const uncovered = requestedModalities.filter((modality) => !coveredModalities.has(modality));
  if (uncovered.length > 0) {
    warnings.push({
      code: PLAN_WARNING_CODES.MODALITY_NOT_COVERED,
      message: `No exercise could be scheduled for: ${uncovered.join(', ')}.`,
      detail: { modalities: uncovered },
    });
  }

  return warnings;
}

function freezePlan(plan) {
  plan.exercises.forEach((item) => {
    Object.freeze(item.reasons);
    Object.freeze(item);
  });
  Object.freeze(plan.exercises);
  plan.warnings.forEach(Object.freeze);
  Object.freeze(plan.warnings);
  Object.freeze(plan.modalitiesRequested);
  Object.freeze(plan.modalitiesCovered);
  Object.freeze(plan.optionsUsed);
  return Object.freeze(plan);
}

// Builds a deterministic workout plan from a normalized TrainingContext
// (src/context-engine) and Compatibility Engine's catalog evaluation
// (src/compatibility-engine). Pure: no LLM, network, Supabase, or UI calls;
// never mutates `context` or `compatibilityResult`, and never mutates the
// exercise objects they reference. Only ever reads
// `compatibilityResult.compatible`/`.conditional` — an incompatible
// exercise is structurally never visible to this function, so it can never
// be selected. Never throws for an ordinary "no valid workout" outcome
// (see PLAN_STATUSES); throws PlannerInputError only when `context`,
// `compatibilityResult`, or `options` don't match the documented contract.
export function buildWorkoutPlan(context, compatibilityResult, options) {
  assertValidContextShape(context);
  assertValidCompatibilityResultShape(compatibilityResult);
  const resolvedOptions = resolveOptions(options);

  const plannedItems = allocateExercises(context, compatibilityResult, resolvedOptions.allowConditional).map(
    (item, index) => ({ ...item, order: index + 1 }),
  );

  const status = resolvePlanStatus(plannedItems, context.modalities);
  const warnings = buildWarnings(plannedItems, context.modalities);
  const estimatedDurationMinutes = plannedItems.reduce((sum, item) => sum + item.estimatedDurationMinutes, 0);
  const planId = computePlanId({
    context,
    allowConditional: resolvedOptions.allowConditional,
    exerciseIds: plannedItems.map((item) => item.exerciseId),
  });

  return freezePlan({
    planId,
    status,
    requestedDurationMinutes: context.timeAvailableMinutes,
    estimatedDurationMinutes,
    modalitiesRequested: [...context.modalities],
    modalitiesCovered: context.modalities.filter((modality) =>
      plannedItems.some((item) => item.modality === modality),
    ),
    exercises: plannedItems,
    warnings,
    optionsUsed: { ...resolvedOptions },
  });
}
