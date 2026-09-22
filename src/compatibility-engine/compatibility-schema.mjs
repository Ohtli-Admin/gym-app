// Statuses and reason-code vocabulary for Compatibility Engine v0.1.
// See README.md for the rules that produce each code.

export const COMPATIBILITY_STATUSES = Object.freeze(['compatible', 'conditional', 'incompatible']);

export const REASON_CODES = Object.freeze({
  EXERCISE_CONTRACT_INVALID: 'EXERCISE_CONTRACT_INVALID',
  EQUIPMENT_UNAVAILABLE: 'EQUIPMENT_UNAVAILABLE',
  MODALITY_UNSATISFIED: 'MODALITY_UNSATISFIED',
  RESTRICTION_HARD_MATCH: 'RESTRICTION_HARD_MATCH',
  RESTRICTION_SOFT_MATCH: 'RESTRICTION_SOFT_MATCH',
});

// A reason of one of these codes forces the exercise to 'incompatible',
// regardless of any conditional match also present (see index.mjs's
// resolveStatus — explicit precedence, not first-reason-wins).
export const INCOMPATIBLE_REASON_CODES = Object.freeze([
  REASON_CODES.EXERCISE_CONTRACT_INVALID,
  REASON_CODES.EQUIPMENT_UNAVAILABLE,
  REASON_CODES.MODALITY_UNSATISFIED,
  REASON_CODES.RESTRICTION_HARD_MATCH,
]);

// A reason of one of these codes produces 'conditional' only when no
// incompatible reason is also present.
export const CONDITIONAL_REASON_CODES = Object.freeze([REASON_CODES.RESTRICTION_SOFT_MATCH]);

// Exercise-adapter fields that are arrays of controlled-vocabulary-style
// tokens (Gym-Exercise-Library taxonomy IDs). Structurally validated and
// token-normalized the same way for all of them; see exercise-adapter.mjs.
export const EXERCISE_ARRAY_FIELDS = Object.freeze([
  'equipmentRequired',
  'equipmentOptional',
  'trainingModalities',
  'bodyRegions',
  'primaryMuscles',
  'jointActions',
  'movementPatterns',
  'constraints',
]);

// The exercise-adapter fields whose tokens are pooled together and matched
// against a restriction's avoidTags (rule C). Chosen directly from the
// fields docs/EXERCISE_INTEGRATION_CONTRACT.md's "Ownership boundary"
// section names as the objective Library attributes GymApp's compatibility
// layer interprets against a user's declared constraints
// (biomechanics.constraints, classification.joint_actions,
// classification.movement_patterns, classification.primary_muscles), plus
// classification.body_regions (Field tiers, tier 2) for the same kind of
// objective, tag-like classification. Equipment/modality are excluded here
// because they are handled by their own dedicated rules (A, B).
export const RESTRICTION_MATCH_FIELDS = Object.freeze([
  'constraints',
  'jointActions',
  'movementPatterns',
  'primaryMuscles',
  'bodyRegions',
]);
