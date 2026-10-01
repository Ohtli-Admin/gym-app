// GymApp product policy: deterministic candidate ORDERING for
// Library-backed sessions (Calistenia and Entrenamiento especial →
// independiente). GA-006 hardening.
//
// Problem it solves: Workout Planner takes compatible candidates in input
// order, and the Library export is alphabetical, so every session was the
// same first N records (mostly core work).
//
// What it does, and nothing more:
// - Runs AFTER Compatibility Engine and BEFORE Workout Planner. It only
//   reorders `compatible` and `conditional`; it never adds, removes or
//   re-classifies a candidate, so every compatibility decision is
//   preserved (`results`/`incompatible` are returned untouched).
// - Groups candidates by ONE objective key taken from Library metadata:
//   the first `primaryMuscles` id, else the first `bodyRegions` id, else
//   `unclassified`. No names, no inferred anatomy. (Movement patterns and
//   joint actions would be better keys but are empty on every record of
//   the current export — see src/exercise-library/README.md.)
// - Puts candidates whose Library `difficulty.overall` is at or below the
//   user's experience level first; harder (or unknown-difficulty)
//   candidates are only reached once those run out. Nothing is excluded.
// - Interleaves the groups round-robin, so consecutive picks come from
//   different muscles/regions, and orders groups and members by a seeded
//   hash, so a different seed gives a different session while the same
//   seed always gives the same one.

export const VARIETY_POLICY_VERSION = 'ga006-variety-v1';

// FNV-1a 32-bit: tiny, deterministic, good enough to shuffle a few hundred
// ids. Not cryptographic and not meant to be.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Ranks from the Library's taxonomy/difficulty.json (beginner 1 …
// expert 4). Context Engine's levels (beginner/intermediate/advanced) share
// the first three ids, so `expert` exercises are above every GymApp level.
const LEVEL_RANK = Object.freeze({ beginner: 1, intermediate: 2, advanced: 3, expert: 4 });

function withinLevel(exercise, experienceLevel) {
  const userRank = LEVEL_RANK[experienceLevel];
  const exerciseRank = LEVEL_RANK[exercise?.library?.difficulty];
  if (userRank === undefined) return true; // no level to compare against
  return exerciseRank !== undefined && exerciseRank <= userRank;
}

export function varietyKey(exercise) {
  const muscle = exercise?.primaryMuscles?.[0];
  if (muscle) return `muscle:${muscle}`;
  const region = exercise?.bodyRegions?.[0];
  if (region) return `region:${region}`;
  return 'unclassified';
}

const byHash = (a, b) => a.h - b.h || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function interleave(results, seed) {
  const groups = new Map();
  for (const result of results) {
    const key = varietyKey(result.exercise);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ result, id: result.exerciseId, h: hash(`${seed}|${result.exerciseId}`) });
  }

  const queues = [...groups.entries()]
    .map(([key, members]) => ({ id: key, h: hash(`${seed}|group|${key}`), members: members.sort(byHash) }))
    .sort(byHash)
    .map((group) => group.members);

  const ordered = [];
  for (let round = 0; ordered.length < results.length; round += 1) {
    for (const queue of queues) {
      if (round < queue.length) ordered.push(queue[round].result);
    }
  }
  return ordered;
}

// Orders one list of compatibility results (entries carry `.exercise` and
// `.exerciseId`): level-appropriate tier first, each tier interleaved.
export function orderForVariety(results, seed, experienceLevel = null) {
  const fits = results.filter((result) => withinLevel(result.exercise, experienceLevel));
  const above = results.filter((result) => !withinLevel(result.exercise, experienceLevel));
  return [...interleave(fits, seed), ...interleave(above, seed)];
}

// Returns a new compatibility result with only candidate ORDER changed.
export function applyVarietyPolicy(compatibilityResult, { seed = 'default', experienceLevel = null } = {}) {
  return {
    ...compatibilityResult,
    compatible: orderForVariety(compatibilityResult.compatible, seed, experienceLevel),
    conditional: orderForVariety(compatibilityResult.conditional, seed, experienceLevel),
  };
}

// Session seed used by the UI: the local calendar date plus how many times
// the user pressed "Generar" in this screen. The first session of a day is
// reproducible; pressing again gives the next variant.
export function sessionSeed(date = new Date(), attempt = 0) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}#${attempt}`;
}
