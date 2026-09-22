// Thrown only for a caller/programmer contract violation — `context`,
// `compatibilityResult`, or `options` not shaped as buildWorkoutPlan()
// documents. Never thrown for an ordinary "no valid workout can be built"
// outcome; that is PLAN_STATUSES.unavailable (see index.mjs).
export class PlannerInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlannerInputError';
  }
}
