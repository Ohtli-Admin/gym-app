// Library canonical record -> GymApp canonical-compatible exercise shape
// (the input contract of src/compatibility-engine/exercise-adapter.mjs).
//
// Maps objective data only. No user data, restrictions, or GymApp
// personalization enters here, and nothing is inferred from names: an
// empty upstream array stays empty.
//
//   exerciseId          <- exercise_id (kept byte-for-byte)
//   name                <- names.es, else names.en
//   equipmentRequired   <- setup.equipment_required (Library ids)
//   equipmentOptional   <- setup.equipment_optional
//   bodyRegions         <- classification.body_regions
//   primaryMuscles      <- classification.primary_muscles
//   jointActions        <- classification.joint_actions
//   movementPatterns    <- classification.movement_patterns
//   constraints         <- biomechanics.constraints
//   trainingModalities  <- modality-policy.mjs (training_types + GymApp
//                          Calisthenics policy)
//
// Extra, non-contract metadata lives under `library` so it never collides
// with Compatibility Engine fields.
import { evaluatePilotRecord, resolveDisplayName, PILOT_POLICY_VERSION } from './pilot-policy.mjs';
import { resolveModalities } from './modality-policy.mjs';

export class LibraryRecordRejectedError extends Error {
  constructor(exerciseId, reasons) {
    super(`Library record ${exerciseId ?? '<unknown>'} rejected by pilot policy: ${reasons.map((r) => r.code).join(', ')}`);
    this.name = 'LibraryRecordRejectedError';
    this.exerciseId = exerciseId;
    this.reasons = reasons;
  }
}

// Throws LibraryRecordRejectedError if the record fails the pilot policy.
export function adaptLibraryRecord(record) {
  const { accepted, reasons } = evaluatePilotRecord(record);
  if (!accepted) {
    throw new LibraryRecordRejectedError(typeof record?.exercise_id === 'string' ? record.exercise_id : null, reasons);
  }

  const { name, language } = resolveDisplayName(record);
  const equipmentRequired = [...record.setup.equipment_required];
  const trainingTypes = [...record.classification.training_types];
  const { modalities, provenance, unmappedTrainingTypes } = resolveModalities(trainingTypes, equipmentRequired);

  return {
    exerciseId: record.exercise_id,
    name,
    equipmentRequired,
    equipmentOptional: [...record.setup.equipment_optional],
    trainingModalities: modalities,
    bodyRegions: [...record.classification.body_regions],
    primaryMuscles: [...record.classification.primary_muscles],
    jointActions: [...record.classification.joint_actions],
    movementPatterns: [...record.classification.movement_patterns],
    constraints: [...record.biomechanics.constraints],
    library: {
      source: 'Gym-Exercise-Library',
      trust: 'pilot',
      pilotPolicyVersion: PILOT_POLICY_VERSION,
      schemaVersion: record.schema_version,
      status: record.status,
      reviewStatus: typeof record.review?.status === 'string' ? record.review.status : null,
      nameLanguage: language,
      // Library's objective difficulty of the exercise (not of the user).
      difficulty: typeof record.difficulty?.overall === 'string' ? record.difficulty.overall : null,
      mechanic: typeof record.biomechanics?.mechanic === 'string' ? record.biomechanics.mechanic : null,
      trainingTypes,
      unmappedTrainingTypes,
      modalityProvenance: provenance,
      // Library-owned relative media reference, preserved as-is. GymApp
      // does not resolve or load it yet (no published media base URL).
      primaryImage: typeof record.media?.primary_image === 'string' ? record.media.primary_image : null,
    },
  };
}
