import { DEFAULT_EQUIPMENT } from './context-schema.mjs';

// Fills in optional fields the caller omitted. Never defaults a required
// field (trainingGoal, environment, experienceLevel, timeAvailableMinutes,
// modalities) — those must come from the caller or the input is rejected.
export function applyDefaults(normalized) {
  return {
    ...normalized,
    equipment: normalized.equipment !== undefined ? normalized.equipment : [...DEFAULT_EQUIPMENT],
    restrictions: normalized.restrictions !== undefined ? normalized.restrictions : [],
    preferences:
      normalized.preferences !== undefined
        ? normalized.preferences
        : { dislikedEquipment: [], notes: null },
  };
}
