import { validateStructure, validateSemantics } from './validate.mjs';
import {
  normalizeToken,
  normalizeTokenArray,
  normalizeRestriction,
  dedupeRestrictions,
  normalizePreferences,
  deepFreeze,
} from './normalize.mjs';
import { applyDefaults } from './defaults.mjs';
import { ContextValidationError } from './errors.mjs';

export { ContextValidationError } from './errors.mjs';
export * from './context-schema.mjs';

// Builds a normalized, validated training context for a session.
//
// Deterministic and side-effect-free: same input -> same output. Does not
// call an LLM, the network, or Supabase, and does not decide exercise
// compatibility — that is the Compatibility Engine's job (see
// docs/REENGINEERING_DECISION_FRAME.md). Throws ContextValidationError
// (with an `issues` array) on structurally or semantically invalid input;
// never silently coerces an unknown value into a known one, and never
// invents a restriction the caller didn't declare.
export function buildTrainingContext(input) {
  const structuralIssues = validateStructure(input);
  if (structuralIssues.length > 0) {
    throw new ContextValidationError(structuralIssues);
  }

  const normalized = {
    trainingGoal: normalizeToken(input.trainingGoal),
    environment: normalizeToken(input.environment),
    timeAvailableMinutes: input.timeAvailableMinutes,
    experienceLevel: normalizeToken(input.experienceLevel),
    modalities: normalizeTokenArray(input.modalities),
    equipment: input.equipment !== undefined ? normalizeTokenArray(input.equipment) : undefined,
    restrictions:
      input.restrictions !== undefined
        ? dedupeRestrictions(input.restrictions.map(normalizeRestriction))
        : undefined,
    preferences:
      input.preferences !== undefined ? normalizePreferences(input.preferences) : undefined,
  };

  const withDefaults = applyDefaults(normalized);

  const semanticIssues = validateSemantics(withDefaults);
  if (semanticIssues.length > 0) {
    throw new ContextValidationError(semanticIssues);
  }

  return deepFreeze({
    trainingGoal: withDefaults.trainingGoal,
    environment: withDefaults.environment,
    timeAvailableMinutes: withDefaults.timeAvailableMinutes,
    experienceLevel: withDefaults.experienceLevel,
    modalities: withDefaults.modalities,
    equipment: withDefaults.equipment,
    restrictions: withDefaults.restrictions,
    preferences: withDefaults.preferences,
  });
}
