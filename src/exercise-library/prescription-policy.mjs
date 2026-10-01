// GymApp prescription policy for Library-backed plan items (GA-006).
//
// Workout Planner's flat per-modality default (every Calistenia exercise
// 3 × 12) is replaced here, after planning, by a prescription derived ONLY
// from objective Library metadata that is actually populated in the
// current export:
//
//   classification.training_types   (strength / plyometrics / ...)
//   biomechanics.mechanic            (compound / isolation / null)
//
// Never from exercise names. Ranges instead of a single number: the data
// can distinguish "explosive" from "multi-joint" from "single-joint" work,
// but not a precise rep target. The Library has no field marking an
// exercise as isometric/timed, so this policy never outputs seconds; when
// the mechanic is unknown it states the sets only and leaves reps open
// rather than inventing a number. Durations/time budgeting stay exactly as
// Workout Planner computed them.

export const PRESCRIPTION_POLICY_VERSION = 'ga006-prescription-v1';

const SETS = 3;

// First matching rule wins. `basis` is kept on the prescription so the
// choice is traceable.
const RULES = Object.freeze([
  { basis: 'training_type:plyometrics', test: (m) => m.trainingTypes.includes('plyometrics'), repsMin: 6, repsMax: 8 },
  { basis: 'mechanic:isolation', test: (m) => m.mechanic === 'isolation', repsMin: 12, repsMax: 15 },
  { basis: 'mechanic:compound', test: (m) => m.mechanic === 'compound', repsMin: 8, repsMax: 12 },
]);

export function prescriptionForLibraryMetadata({ trainingTypes = [], mechanic = null } = {}) {
  const rule = RULES.find((candidate) => candidate.test({ trainingTypes, mechanic }));
  if (!rule) {
    return { type: 'sets_reps', sets: SETS, reps: null, repsMin: null, repsMax: null, basis: 'insufficient_metadata' };
  }
  return { type: 'sets_reps', sets: SETS, reps: null, repsMin: rule.repsMin, repsMax: rule.repsMax, basis: rule.basis };
}

// Returns a new plan whose items carry the Library-derived prescription.
// Items whose exercise is not a Library exercise, or whose planner
// prescription is not sets/reps (e.g. cardio duration), are untouched.
export function applyLibraryPrescriptions(plan, exercisesById) {
  return {
    ...plan,
    exercises: plan.exercises.map((item) => {
      const library = exercisesById.get(item.exerciseId)?.library;
      if (!library || item.prescription?.type !== 'sets_reps') return item;
      return {
        ...item,
        prescription: prescriptionForLibraryMetadata({ trainingTypes: library.trainingTypes, mechanic: library.mechanic }),
      };
    }),
  };
}
