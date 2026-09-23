// A deterministic reference for a plan: a fingerprint of exactly the
// values that influenced its content (no randomness, no timestamp, no
// machine state). Two calls with equivalent context/options/selected-
// exercise-identity always produce the same planId.
//
// Portability note: this previously used Node's `node:crypto`
// (createHash('sha256')), which is not a valid import in a browser — the
// GA-005 Today experience loads this exact module (unchanged) as a native
// ES module in the browser (see src/today-experience/README.md), so a
// Node-only dependency here would break it there. `planId` only needs to
// be stable and collision-resistant enough for a UI/debugging reference,
// not cryptographically secure, so it is replaced with a small pure-JS
// FNV-1a-based fingerprint (two 32-bit lanes) that runs identically in
// Node and in every browser, with no import at all. See
// plan-id.test.mjs for portability-focused coverage.
function fnv1a32(input, seed) {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// Two independent 32-bit lanes (different seeds) concatenated into one
// 16-hex-character fingerprint, to reduce collision likelihood beyond what
// a single 32-bit hash would give, while staying trivially simple.
function fingerprintHash(input) {
  const lane1 = fnv1a32(input, 0x811c9dc5).toString(16).padStart(8, '0');
  const lane2 = fnv1a32(input, 0x9e3779b9).toString(16).padStart(8, '0');
  return `${lane1}${lane2}`;
}

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
  return `plan-${fingerprintHash(fingerprint)}`;
}
