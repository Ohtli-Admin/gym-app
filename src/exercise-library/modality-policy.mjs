// GymApp adapter policy: Library `classification.training_types` ->
// GymApp training modalities (Context Engine's MODALITIES:
// gym / calisthenics / cardio / core). This is GymApp's interpretation for
// its own products; it is never written back to Gym-Exercise-Library and is
// not canonical Library metadata.
//
// Two separate layers, kept distinguishable on every adapted exercise
// (see `modalityProvenance` in library-adapter.mjs):
//
// 1. CANONICAL-DERIVED: a direct mapping of the record's explicit
//    training_types (TRAINING_TYPE_TO_MODALITY below).
// 2. GYMAPP PRODUCT POLICY (Calisthenics candidates): measured against the
//    real Library snapshot at GA-006 time, zero records carry
//    `training_types: ['calisthenics']`, so without this layer the
//    Calisthenics product would have no Library exercises at all. The
//    policy uses ONLY objective fields (equipment ids + training types) —
//    never exercise names.

export const MODALITY_POLICY_VERSION = 'ga006-modality-v1';

// Library training type id -> GymApp modality. Training types not listed
// here map to no modality (they can still be in the snapshot, they just
// can't satisfy any GymApp modality request). Deliberately conservative:
// only mappings with an unambiguous GymApp product equivalent.
export const TRAINING_TYPE_TO_MODALITY = Object.freeze({
  strength: 'gym',
  hypertrophy: 'gym',
  muscular_endurance: 'gym',
  power: 'gym',
  bodybuilding: 'gym',
  powerlifting: 'gym',
  olympic_weightlifting: 'gym',
  strongman: 'gym',
  kettlebell_training: 'gym',
  calisthenics: 'calisthenics',
  cardio: 'cardio',
  core_training: 'core',
});

// Library equipment ids whose taxonomy family is `bodyweight` or
// `calisthenics` (taxonomy/equipment.json). tools/sync-exercise-library.mjs
// verifies this list against the Library taxonomy on every sync and fails
// loudly if the two drift apart.
export const CALISTHENICS_POLICY_EQUIPMENT_FAMILIES = Object.freeze(['bodyweight', 'calisthenics']);
export const CALISTHENICS_POLICY_EQUIPMENT = Object.freeze([
  'bodyweight',
  'pullup_bar',
  'parallel_bars',
  'dip_station',
  'rings',
  'suspension_trainer',
  'parallettes',
]);

// A bodyweight-family record only becomes a Calisthenics candidate when
// its explicit training types describe resistance/skill work. Excludes, for
// example, `stretching`, `mobility` and `cardio` records that happen to
// need no equipment.
export const CALISTHENICS_POLICY_TRAINING_TYPES = Object.freeze([
  'strength',
  'hypertrophy',
  'muscular_endurance',
  'power',
  'plyometrics',
  'gymnastics_strength',
  'isometric_training',
  'core_training',
]);

export const MODALITY_SOURCES = Object.freeze({
  CANONICAL_TRAINING_TYPE: 'canonical_training_type',
  GYMAPP_CALISTHENICS_POLICY: 'gymapp_calisthenics_equipment_policy',
});

// Is this record a Calisthenics candidate under the GymApp product policy?
// Requires: non-empty equipment_required, EVERY required item in the
// bodyweight/calisthenics families, and at least one qualifying training
// type. Records explicitly typed `calisthenics` don't need this policy.
export function isCalisthenicsPolicyCandidate(equipmentRequired, trainingTypes) {
  if (!Array.isArray(equipmentRequired) || equipmentRequired.length === 0) return false;
  if (!equipmentRequired.every((id) => CALISTHENICS_POLICY_EQUIPMENT.includes(id))) return false;
  return Array.isArray(trainingTypes) && trainingTypes.some((id) => CALISTHENICS_POLICY_TRAINING_TYPES.includes(id));
}

// Returns { modalities, provenance, unmappedTrainingTypes } where
// `provenance` maps each modality to the list of sources that produced it.
export function resolveModalities(trainingTypes, equipmentRequired) {
  const provenance = {};
  const add = (modality, source) => {
    provenance[modality] = provenance[modality] ?? [];
    if (!provenance[modality].includes(source)) provenance[modality].push(source);
  };

  const unmappedTrainingTypes = [];
  for (const type of trainingTypes) {
    const modality = TRAINING_TYPE_TO_MODALITY[type];
    if (modality) add(modality, MODALITY_SOURCES.CANONICAL_TRAINING_TYPE);
    else unmappedTrainingTypes.push(type);
  }

  if (isCalisthenicsPolicyCandidate(equipmentRequired, trainingTypes)) {
    add('calisthenics', MODALITY_SOURCES.GYMAPP_CALISTHENICS_POLICY);
  }

  return { modalities: Object.keys(provenance), provenance, unmappedTrainingTypes };
}
