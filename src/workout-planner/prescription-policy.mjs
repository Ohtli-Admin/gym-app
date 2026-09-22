import { MODALITY_PLANNING_DEFAULTS } from './planner-schema.mjs';
import { PlannerInputError } from './errors.mjs';

// Looks up the flat prescription + estimated duration for one requested
// modality. Throwing here would only ever indicate that
// MODALITY_PLANNING_DEFAULTS has drifted out of sync with Context Engine's
// MODALITIES enum (a programmer error, not a normal planning outcome) —
// every modality Context Engine can produce has an entry today.
export function resolveModalityPlanningDefaults(modality) {
  const defaults = MODALITY_PLANNING_DEFAULTS[modality];
  if (!defaults) {
    throw new PlannerInputError(
      `No planning policy default is defined for modality '${modality}'.`,
    );
  }
  return defaults;
}
