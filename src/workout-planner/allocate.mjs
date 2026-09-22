import { normalizeTokenArray } from '../context-engine/normalize.mjs';
import { resolveModalityPlanningDefaults } from './prescription-policy.mjs';

// Compatibility Engine's result exposes the caller's original, unnormalized
// exercise object (see src/compatibility-engine/index.mjs — it never
// mutates the caller's data). This engine needs to know which specific
// requested modality a candidate satisfies for allocation purposes, so it
// re-normalizes the same field the same way (normalizeTokenArray), rather
// than inventing a second notion of "modality". This does not re-decide
// compatibility — Compatibility Engine has already excluded any exercise
// that satisfies no requested modality at all (rule B); this only chooses
// which of the (possibly several) satisfied modalities a candidate is
// slotted under.
function modalitiesOf(exercise) {
  return normalizeTokenArray(exercise?.trainingModalities ?? []);
}

// Deterministic round-robin allocation across context.modalities, tried in
// the exact order Context Engine normalized/deduped them. Within a single
// modality, candidates are tried compatible-first, then conditional (only
// when allowConditional is true) — rule B ("prefer compatible over
// conditional"). Within the same status, candidates keep the stable order
// they already have in compatibilityResult.compatible/.conditional, which
// itself preserves the original catalog input order (documented tie-break;
// no randomness, no exercise-name heuristics).
//
// Every candidate's cost is a flat per-modality estimate from
// MODALITY_PLANNING_DEFAULTS, not a per-exercise value (see
// planner-schema.mjs). One consequence, used deliberately below: once the
// next candidate for a modality doesn't fit the remaining budget, no later
// candidate for that same modality will fit either (their cost is
// identical), so that modality can be marked exhausted immediately instead
// of being revisited every round.
//
// A single exercise may satisfy more than one requested modality (e.g.
// `trainingModalities: ['gym', 'core']`); `usedIds` guarantees it is
// selected at most once across the whole plan (rule F), under whichever
// modality's turn reaches it first in round-robin order.
export function allocateExercises(context, compatibilityResult, allowConditional) {
  const modalities = context.modalities;

  const queues = new Map(
    modalities.map((modality) => {
      const compatible = compatibilityResult.compatible.filter((result) =>
        modalitiesOf(result.exercise).includes(modality),
      );
      const conditional = allowConditional
        ? compatibilityResult.conditional.filter((result) => modalitiesOf(result.exercise).includes(modality))
        : [];
      return [modality, [...compatible, ...conditional]];
    }),
  );

  const usedIds = new Set();
  const exhausted = new Set();
  const planned = [];
  let remainingMinutes = context.timeAvailableMinutes;
  let progressed = true;

  while (progressed && exhausted.size < modalities.length) {
    progressed = false;
    for (const modality of modalities) {
      if (exhausted.has(modality)) {
        continue;
      }

      const queue = queues.get(modality);
      while (queue.length > 0 && usedIds.has(queue[0].exerciseId)) {
        queue.shift();
      }
      if (queue.length === 0) {
        exhausted.add(modality);
        continue;
      }

      const { prescription, estimatedDurationMinutes } = resolveModalityPlanningDefaults(modality);
      if (estimatedDurationMinutes > remainingMinutes) {
        exhausted.add(modality);
        continue;
      }

      const candidate = queue.shift();
      usedIds.add(candidate.exerciseId);
      remainingMinutes -= estimatedDurationMinutes;
      planned.push({
        exerciseId: candidate.exerciseId,
        name: typeof candidate.exercise?.name === 'string' ? candidate.exercise.name.trim() : null,
        modality,
        status: candidate.status,
        reasons: candidate.reasons,
        prescription,
        estimatedDurationMinutes,
      });
      progressed = true;
    }
  }

  return planned;
}
