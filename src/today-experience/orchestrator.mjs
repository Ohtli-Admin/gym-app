// Wires the three real domain engines together. This file contains no
// domain rules of its own — it only calls buildTrainingContext(),
// evaluateCatalogCompatibility(), and buildWorkoutPlan() in sequence and
// classifies whichever error each one throws (if any) into a user-facing
// category. No DOM code lives here either — see today-panel.mjs for that.
import { buildTrainingContext, ContextValidationError } from '../context-engine/index.mjs';
import { evaluateCatalogCompatibility, CompatibilityInputError } from '../compatibility-engine/index.mjs';
import { buildWorkoutPlan, PlannerInputError } from '../workout-planner/index.mjs';
import { buildContextInputFromUi } from './today-view-model.mjs';
import { getDemoExerciseCatalog } from './demo-catalog-provider.mjs';

// `catalogProvider` defaults to the demo catalog but is an explicit
// parameter precisely so a future real Gym-Exercise-Library-backed
// provider (or a test fixture) can be substituted without touching this
// function's logic — see demo-catalog-provider.mjs's "FUTURE REPLACEMENT
// SEAM" comment.
export function runTodayOrchestration(uiState, { catalogProvider = getDemoExerciseCatalog } = {}) {
  let context;
  try {
    context = buildTrainingContext(buildContextInputFromUi(uiState));
  } catch (error) {
    if (error instanceof ContextValidationError) {
      return { ok: false, errorKind: 'validation', error };
    }
    throw error; // a genuine programmer error, not a normal validation outcome
  }

  try {
    const exercises = catalogProvider();
    const compatibilityResult = evaluateCatalogCompatibility(context, exercises);
    const plan = buildWorkoutPlan(context, compatibilityResult, { allowConditional: Boolean(uiState.allowConditional) });
    return { ok: true, context, compatibilityResult, plan };
  } catch (error) {
    if (error instanceof CompatibilityInputError || error instanceof PlannerInputError) {
      return { ok: false, errorKind: 'integration', error };
    }
    throw error;
  }
}
