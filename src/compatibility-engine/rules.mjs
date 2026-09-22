import { REASON_CODES, RESTRICTION_MATCH_FIELDS } from './compatibility-schema.mjs';

// Rule A — equipment. 'bodyweight' in equipmentRequired is an explicit
// statement of "no equipment", the same convention Context Engine uses
// (see context-engine/context-schema.mjs's DEFAULT_EQUIPMENT), so it never
// counts as a requirement to satisfy. One reason per missing item, so a
// caller can see exactly what's absent rather than a single bundled
// message.
export function evaluateEquipmentRule(context, exercise) {
  const required = exercise.equipmentRequired.filter((item) => item !== 'bodyweight');
  const available = new Set(context.equipment);
  return required
    .filter((item) => !available.has(item))
    .map((item) => ({
      code: REASON_CODES.EQUIPMENT_UNAVAILABLE,
      message: `Exercise requires equipment '${item}', which is not available in the current context.`,
      detail: { equipment: item },
    }));
}

// Rule B — requested modality. No canonical modality tag at all is not a
// special case: an empty trainingModalities set trivially cannot satisfy
// any requested modality, so it falls out of the same intersection check.
// Never infers a modality from the exercise's name.
export function evaluateModalityRule(context, exercise) {
  const requested = new Set(context.modalities);
  const satisfiesAny = exercise.trainingModalities.some((modality) => requested.has(modality));
  if (satisfiesAny) {
    return [];
  }
  return [
    {
      code: REASON_CODES.MODALITY_UNSATISFIED,
      message: 'Exercise training modality does not match any requested modality.',
      detail: {
        requestedModalities: [...context.modalities],
        exerciseModalities: [...exercise.trainingModalities],
      },
    },
  ];
}

// Rule C — explicit active restrictions. Matches ONLY a restriction's own
// declared avoidTags against the exercise's objective tag pool
// (RESTRICTION_MATCH_FIELDS). Deliberately does not use `restriction.region`
// for matching: a region name alone ('shoulder') does not say which
// movements to avoid, and turning it into an avoidance rule would be
// exactly the kind of inference this engine must not perform (e.g. "a
// shoulder restriction means overhead press is unsafe"). `region` remains
// descriptive-only in v0.1.
export function evaluateRestrictionsRule(context, exercise) {
  const exerciseTags = new Set(RESTRICTION_MATCH_FIELDS.flatMap((field) => exercise[field]));
  const reasons = [];

  for (const restriction of context.restrictions) {
    const matchedTags = restriction.avoidTags.filter((tag) => exerciseTags.has(tag));
    if (matchedTags.length === 0) {
      continue;
    }
    reasons.push({
      code: restriction.severity === 'hard' ? REASON_CODES.RESTRICTION_HARD_MATCH : REASON_CODES.RESTRICTION_SOFT_MATCH,
      message: `Exercise matches restriction '${restriction.id}' on: ${matchedTags.join(', ')}.`,
      detail: { restrictionId: restriction.id, severity: restriction.severity, matchedTags },
    });
  }

  return reasons;
}
