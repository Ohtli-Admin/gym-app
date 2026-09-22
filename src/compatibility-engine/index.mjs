import { validateExerciseStructure, normalizeExercise, extractExerciseId } from './exercise-adapter.mjs';
import { evaluateEquipmentRule, evaluateModalityRule, evaluateRestrictionsRule } from './rules.mjs';
import { CompatibilityInputError } from './errors.mjs';
import {
  REASON_CODES,
  INCOMPATIBLE_REASON_CODES,
  CONDITIONAL_REASON_CODES,
} from './compatibility-schema.mjs';

export { CompatibilityInputError } from './errors.mjs';
export * from './compatibility-schema.mjs';

// `context` is a trusted, single pipeline input (the direct output of
// buildTrainingContext()) — an invalid shape here is a caller/integration
// bug, so this throws rather than being reported per-record. Contrast with
// a single malformed exercise in a large catalog (exercise-adapter.mjs),
// which is reported, not thrown, so it doesn't abort the rest of the batch.
function assertValidContextShape(context) {
  if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    throw new CompatibilityInputError(
      'context must be a normalized TrainingContext object (see buildTrainingContext()).',
    );
  }
  if (!Array.isArray(context.equipment) || !Array.isArray(context.modalities)) {
    throw new CompatibilityInputError(
      'context.equipment and context.modalities must be arrays (did you pass the output of buildTrainingContext()?).',
    );
  }
  const restrictionsValid =
    Array.isArray(context.restrictions) &&
    context.restrictions.every(
      (restriction) =>
        typeof restriction === 'object' &&
        restriction !== null &&
        Array.isArray(restriction.avoidTags) &&
        typeof restriction.severity === 'string',
    );
  if (!restrictionsValid) {
    throw new CompatibilityInputError(
      'context.restrictions must be an array of normalized restrictions with avoidTags/severity (did you pass the output of buildTrainingContext()?).',
    );
  }
}

// Explicit deterministic precedence: any incompatible-class reason wins
// over any conditional-class reason, regardless of which rule produced
// which reason or in what order. All collected reasons are preserved on
// the result either way (see evaluateExerciseCompatibility) — only the
// final status collapses them to one of three values.
function resolveStatus(reasons) {
  if (reasons.some((reason) => INCOMPATIBLE_REASON_CODES.includes(reason.code))) {
    return 'incompatible';
  }
  if (reasons.some((reason) => CONDITIONAL_REASON_CODES.includes(reason.code))) {
    return 'conditional';
  }
  return 'compatible';
}

function freezeResult(result) {
  result.reasons.forEach(Object.freeze);
  Object.freeze(result.reasons);
  // `exercise` is the caller's own object reference and is deliberately
  // left untouched — freezing it would be a side effect on data this
  // engine does not own.
  return Object.freeze(result);
}

// Evaluates a single exercise against a normalized training context.
// Pure and deterministic: no LLM, network, Supabase, or UI calls, and no
// mutation of `context` or `exercise`. Never decides compatibility by
// inferring meaning from an exercise's name or from a restriction's
// `region` alone — only explicit, machine-readable attributes participate
// (see rules.mjs).
//
// Returns { exerciseId, exercise, status, reasons } — `status` is one of
// 'compatible' | 'conditional' | 'incompatible', 'reasons' is always an
// array (empty when status is 'compatible') of { code, message, detail }.
// A structurally invalid `exercise` is reported as
// REASON_CODES.EXERCISE_CONTRACT_INVALID (status 'incompatible'), never
// silently treated as compatible.
export function evaluateExerciseCompatibility(context, exercise) {
  assertValidContextShape(context);

  const structuralIssues = validateExerciseStructure(exercise);
  if (structuralIssues.length > 0) {
    return freezeResult({
      exerciseId: extractExerciseId(exercise),
      exercise,
      status: 'incompatible',
      reasons: [
        {
          code: REASON_CODES.EXERCISE_CONTRACT_INVALID,
          message: `Exercise input is structurally invalid: ${structuralIssues
            .map((issue) => `${issue.field}: ${issue.message}`)
            .join('; ')}`,
          detail: { issues: structuralIssues },
        },
      ],
    });
  }

  const normalized = normalizeExercise(exercise);
  const reasons = [
    ...evaluateEquipmentRule(context, normalized),
    ...evaluateModalityRule(context, normalized),
    ...evaluateRestrictionsRule(context, normalized),
  ];

  return freezeResult({
    exerciseId: normalized.exerciseId,
    exercise,
    status: resolveStatus(reasons),
    reasons,
  });
}

// Evaluates a full catalog and partitions it, so Workout Planner can take
// `.compatible` / `.conditional` / `.incompatible` directly without
// reimplementing any rule. `.results` preserves the input order 1:1.
export function evaluateCatalogCompatibility(context, exercises) {
  assertValidContextShape(context);
  if (!Array.isArray(exercises)) {
    throw new CompatibilityInputError('exercises must be an array.');
  }

  const results = exercises.map((exercise) => evaluateExerciseCompatibility(context, exercise));

  return {
    results,
    compatible: results.filter((result) => result.status === 'compatible'),
    conditional: results.filter((result) => result.status === 'conditional'),
    incompatible: results.filter((result) => result.status === 'incompatible'),
  };
}
