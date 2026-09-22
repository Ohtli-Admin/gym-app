import { normalizeToken, normalizeTokenArray } from '../context-engine/normalize.mjs';
import { EXERCISE_ARRAY_FIELDS } from './compatibility-schema.mjs';

// The minimal canonical-compatible exercise representation this engine
// consumes. Deliberately small: only objective, structural attributes that
// docs/EXERCISE_INTEGRATION_CONTRACT.md documents as available from
// Gym-Exercise-Library (see "Field tiers" and "Ownership boundary"). This
// engine never reads Supabase or the legacy `ejercicios` shape directly —
// any caller (a future Library-backed adapter, a test, or a temporary
// legacy-row mapper) must translate into this shape first.
//
//   exerciseId          <- exercise_id (tier 1, required identity)
//   name                <- names.en / names.es (tier 1; optional here since
//                          it is not used by any compatibility rule, only
//                          for display/traceability)
//   equipmentRequired    <- setup.equipment_required (tier 2)
//   equipmentOptional    <- setup.equipment_optional (tier 2; not used by
//                          any v0.1 rule — see README "Deferred")
//   trainingModalities   <- GymApp's own adapter-level name for whatever
//                          objective training-domain classification the
//                          Library exposes (the Library confirms a
//                          `taxonomy/training-types.json` controlled
//                          vocabulary exists; the integration contract does
//                          not pin an exact `classification.*` field name
//                          for it yet, so this name is GymApp's own,
//                          pending upstream confirmation — see the
//                          contract's "Confirmed" vs "Proposed" convention)
//   bodyRegions          <- classification.body_regions (tier 2)
//   primaryMuscles       <- classification.primary_muscles (tier 2 / used
//                          in "Ownership boundary" as a restriction input)
//   jointActions         <- classification.joint_actions ("Ownership
//                          boundary")
//   movementPatterns     <- classification.movement_patterns ("Ownership
//                          boundary")
//   constraints          <- biomechanics.constraints (tier 3, the field the
//                          contract explicitly earmarks for "once the
//                          compatibility engine exists")
//
// Fields the contract documents but this engine does not consume: `status`
// (draft/review_required/approved/deprecated — no trust-tier rule is
// implemented in v0.1, see README "Deferred") and every `media.*` field
// (irrelevant to compatibility).

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// Structural validation only: is this shape well-formed enough to
// normalize and reason about? Never returns "unknown value" issues — the
// exercise's own taxonomy tokens are Gym-Exercise-Library's vocabulary, not
// GymApp's, so this engine does not police them against a GymApp enum (see
// compatibility-schema.mjs's RESTRICTION_MATCH_FIELDS comment).
export function validateExerciseStructure(exercise) {
  const issues = [];

  if (!isPlainObject(exercise)) {
    issues.push({ field: 'exercise', message: 'must be a plain object', code: 'invalid_type' });
    return issues;
  }

  if (exercise.exerciseId === undefined) {
    issues.push({ field: 'exerciseId', message: 'is required', code: 'required_missing' });
  } else if (!isNonEmptyString(exercise.exerciseId)) {
    issues.push({ field: 'exerciseId', message: 'must be a non-empty string', code: 'invalid_type' });
  }

  if (exercise.name !== undefined && !isNonEmptyString(exercise.name)) {
    issues.push({ field: 'name', message: 'must be a non-empty string', code: 'invalid_type' });
  }

  for (const field of EXERCISE_ARRAY_FIELDS) {
    if (exercise[field] !== undefined && !isStringArray(exercise[field])) {
      issues.push({ field, message: 'must be an array of strings', code: 'invalid_type' });
    }
  }

  return issues;
}

// Best-effort identity extraction for a record that failed structural
// validation, so a caller can still trace which catalog row was rejected.
export function extractExerciseId(exercise) {
  if (isPlainObject(exercise) && typeof exercise.exerciseId === 'string' && exercise.exerciseId.trim() !== '') {
    return exercise.exerciseId.trim();
  }
  return null;
}

// Normalizes a structurally-valid exercise: trims identity/name, and
// token-normalizes every taxonomy array the same way Context Engine
// normalizes context.equipment/modalities, so values like 'Dumbbell' and
// 'dumbbell' compare equal across the two engines. Missing array fields
// default to [] — for equipmentRequired this is the same explicit
// "no equipment" semantics Context Engine applies (see rules.mjs); for
// trainingModalities an empty set simply cannot satisfy any requested
// modality, which rule B already handles without a special case.
export function normalizeExercise(exercise) {
  const normalized = {
    exerciseId: exercise.exerciseId.trim(),
    name: exercise.name !== undefined ? exercise.name.trim() : null,
  };
  for (const field of EXERCISE_ARRAY_FIELDS) {
    normalized[field] = normalizeTokenArray(exercise[field] ?? []);
  }
  return normalized;
}

// Exported for callers that need single-token normalization consistent
// with the rest of the engine (e.g. building test fixtures).
export { normalizeToken };
