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
import { toLibraryEquipmentContext } from '../exercise-library/equipment-mapping.mjs';
import { applyVarietyPolicy } from '../exercise-library/session-variety-policy.mjs';
import { applyLibraryPrescriptions } from '../exercise-library/prescription-policy.mjs';

// `catalogProvider` defaults to the demo catalog but is an explicit
// parameter precisely so a real Gym-Exercise-Library-backed provider (or a
// test fixture) can be substituted without touching this function's logic.
// `contextAdapter` (identity by default) lets a provider whose exercises
// use a different equipment vocabulary translate the context ONCE, at the
// single mapping boundary (see runLibraryOrchestration).
// `candidateOrdering` (identity by default) may reorder — never filter —
// the compatible/conditional candidates before Workout Planner sees them.
export function runTodayOrchestration(
  uiState,
  {
    catalogProvider = getDemoExerciseCatalog,
    contextAdapter = (context) => ({ context }),
    candidateOrdering = (compatibilityResult) => compatibilityResult,
  } = {},
) {
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
    const { context: engineContext, ...adapterInfo } = contextAdapter(context);
    const exercises = catalogProvider();
    const compatibilityResult = evaluateCatalogCompatibility(engineContext, exercises);
    const plan = buildWorkoutPlan(engineContext, candidateOrdering(compatibilityResult, engineContext), { allowConditional: Boolean(uiState.allowConditional) });
    return { ok: true, context: engineContext, compatibilityResult, plan, ...adapterInfo };
  } catch (error) {
    if (error instanceof CompatibilityInputError || error instanceof PlannerInputError) {
      return { ok: false, errorKind: 'integration', error };
    }
    throw error;
  }
}

// GA-006: the Gym-Exercise-Library-backed path (used by Calistenia).
// `libraryProvider` is the result of src/exercise-library/provider.mjs's
// buildLibraryProvider()/loadLibraryProvider(). There is deliberately NO
// demo fallback: without a provider this reports `catalog_missing`.
// Candidates are ordered by the session variety policy, seeded by
// `uiState.sessionSeed` (see session-variety-policy.mjs).
export function runLibraryOrchestration(uiState, libraryProvider) {
  if (!libraryProvider || typeof libraryProvider.getExercises !== 'function') {
    return { ok: false, errorKind: 'catalog_missing', error: new Error('Gym-Exercise-Library provider not loaded.') };
  }
  const exercises = libraryProvider.getExercises();
  const result = runTodayOrchestration(uiState, {
    catalogProvider: () => exercises,
    contextAdapter: toLibraryEquipmentContext,
    candidateOrdering: (compatibilityResult, context) =>
      applyVarietyPolicy(compatibilityResult, { seed: uiState.sessionSeed, experienceLevel: context.experienceLevel }),
  });
  if (!result.ok) return { ...result, catalogSource: 'exercise_library' };
  // Library prescription policy replaces the planner's flat per-modality
  // default using objective Library metadata (see prescription-policy.mjs).
  const byId = new Map(exercises.map((exercise) => [exercise.exerciseId, exercise]));
  return { ...result, plan: applyLibraryPrescriptions(result.plan, byId), catalogSource: 'exercise_library' };
}
