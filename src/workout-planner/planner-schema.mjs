export const PLAN_STATUSES = Object.freeze(['ready', 'partial', 'unavailable']);

export const PLAN_WARNING_CODES = Object.freeze({
  CONDITIONAL_EXERCISES_INCLUDED: 'CONDITIONAL_EXERCISES_INCLUDED',
  MODALITY_NOT_COVERED: 'MODALITY_NOT_COVERED',
});

// GymApp's own v0.1 planning-policy defaults. NOT scientifically derived,
// and NOT sourced from the canonical exercise contract — the exercise
// adapter (src/compatibility-engine/exercise-adapter.mjs) carries no
// prescription or duration field at all. This is a small, explicit,
// documented GymApp policy: one flat prescription + one flat estimated
// duration per requested modality (never per-exercise), used only to
// (a) fill the plan item's `prescription` field and (b) drive the
// time-budget policy in allocate.mjs. Deliberately easy to replace with a
// real, exercise-aware policy later — every consumer reads it through
// resolveModalityPlanningDefaults() in prescription-policy.mjs, never
// inline.
export const MODALITY_PLANNING_DEFAULTS = Object.freeze({
  gym: Object.freeze({
    prescription: Object.freeze({ type: 'sets_reps', sets: 3, reps: 10 }),
    estimatedDurationMinutes: 6,
  }),
  calisthenics: Object.freeze({
    prescription: Object.freeze({ type: 'sets_reps', sets: 3, reps: 12 }),
    estimatedDurationMinutes: 5,
  }),
  cardio: Object.freeze({
    prescription: Object.freeze({ type: 'duration', durationMinutes: 8 }),
    estimatedDurationMinutes: 8,
  }),
  core: Object.freeze({
    prescription: Object.freeze({ type: 'sets_reps', sets: 3, reps: 15 }),
    estimatedDurationMinutes: 4,
  }),
});
