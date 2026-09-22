import { createHash } from 'node:crypto';

// A deterministic reference for a plan: a hash of exactly the values that
// influenced its content (no randomness, no timestamp, no machine state).
// Two calls with equivalent context/options/selected-exercise-identity
// always produce the same planId, and only those values are hashed — not
// the raw caller-supplied `options` object reference.
export function computePlanId({ context, allowConditional, exerciseIds }) {
  const fingerprint = JSON.stringify({
    trainingGoal: context.trainingGoal,
    environment: context.environment,
    timeAvailableMinutes: context.timeAvailableMinutes,
    experienceLevel: context.experienceLevel,
    modalities: context.modalities,
    equipment: context.equipment,
    restrictionIds: context.restrictions.map((restriction) => `${restriction.id}:${restriction.severity}`),
    allowConditional,
    exerciseIds,
  });
  const hash = createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);
  return `plan-${hash}`;
}
