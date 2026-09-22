// Thrown for a programmer-error-class input: the context/exercises
// arguments themselves don't have the shape this engine's contract
// requires (e.g. `context` isn't the output of buildTrainingContext()).
// This is distinct from a single malformed exercise record inside a large
// catalog — see exercise-adapter.mjs / REASON_CODES.EXERCISE_CONTRACT_INVALID
// for that case, which is reported per-record instead of thrown, so one bad
// catalog row doesn't abort evaluation of the rest.
export class CompatibilityInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CompatibilityInputError';
  }
}
