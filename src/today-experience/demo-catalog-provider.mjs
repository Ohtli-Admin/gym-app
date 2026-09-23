// Demo/in-memory exercise catalog for the GA-005 Today experience.
//
// This is a *provider*, not the pipeline: it only produces objects shaped
// to Compatibility Engine's exercise-adapter contract
// (src/compatibility-engine/exercise-adapter.mjs) — the same shape
// src/workout-planner/examples/vertical-slice-example.mjs uses for its own
// (separate, Node-only) fixture. Today's orchestrator
// (src/today-experience/orchestrator.mjs) calls this function and passes
// its result straight into evaluateCatalogCompatibility(); it never reads
// or interprets these records itself.
//
// FUTURE REPLACEMENT SEAM: a real Gym-Exercise-Library-backed provider
// (per docs/EXERCISE_INTEGRATION_CONTRACT.md) will replace this file by
// exporting a function with the same signature — () -> exercise[] (or a
// Promise of one, once real data is fetched) — built from the Library's
// canonical export instead of these hand-authored records. Nothing else
// in src/today-experience or src/compatibility-engine needs to change: the
// orchestrator only depends on "a function that returns
// canonical-compatible exercise records," never on this file's specific
// contents.
export function getDemoExerciseCatalog() {
  return [
    {
      exerciseId: 'demo-dumbbell-goblet-squat',
      name: 'Sentadilla goblet con mancuerna',
      equipmentRequired: ['dumbbell'],
      trainingModalities: ['gym'],
      bodyRegions: ['legs'],
      primaryMuscles: ['quadriceps'],
      jointActions: ['knee_flexion'],
      movementPatterns: ['squat'],
      constraints: [],
    },
    {
      exerciseId: 'demo-dumbbell-bent-over-row',
      name: 'Remo inclinado con mancuerna',
      equipmentRequired: ['dumbbell'],
      trainingModalities: ['gym'],
      bodyRegions: ['back'],
      primaryMuscles: ['latissimus_dorsi'],
      jointActions: ['shoulder_extension'],
      movementPatterns: ['horizontal_pull'],
      constraints: [],
    },
    {
      exerciseId: 'demo-dumbbell-overhead-press',
      name: 'Press militar con mancuerna',
      equipmentRequired: ['dumbbell'],
      trainingModalities: ['gym'],
      bodyRegions: ['shoulders'],
      primaryMuscles: ['deltoid'],
      jointActions: ['shoulder_flexion'],
      movementPatterns: ['overhead_press'],
      constraints: [],
    },
    {
      exerciseId: 'demo-barbell-bench-press',
      name: 'Press de banca con barra',
      equipmentRequired: ['barbell', 'bench'],
      trainingModalities: ['gym'],
      bodyRegions: ['chest'],
      primaryMuscles: ['pectoralis_major'],
      jointActions: ['shoulder_horizontal_adduction'],
      movementPatterns: ['horizontal_push'],
      constraints: [],
    },
    {
      exerciseId: 'demo-kettlebell-swing',
      name: 'Swing con kettlebell',
      equipmentRequired: ['kettlebell'],
      trainingModalities: ['gym', 'cardio'],
      bodyRegions: ['back', 'legs'],
      primaryMuscles: ['gluteus_maximus'],
      jointActions: ['hip_extension'],
      movementPatterns: ['hip_hinge'],
      constraints: [],
    },
    {
      exerciseId: 'demo-pull-up',
      name: 'Dominada',
      equipmentRequired: ['pull_up_bar'],
      trainingModalities: ['calisthenics'],
      bodyRegions: ['back'],
      primaryMuscles: ['latissimus_dorsi'],
      jointActions: ['shoulder_extension'],
      movementPatterns: ['vertical_pull'],
      constraints: [],
    },
    {
      exerciseId: 'demo-bodyweight-push-up',
      name: 'Flexión de pecho',
      equipmentRequired: ['bodyweight'],
      trainingModalities: ['calisthenics'],
      bodyRegions: ['chest'],
      primaryMuscles: ['pectoralis_major'],
      jointActions: ['shoulder_horizontal_adduction'],
      movementPatterns: ['horizontal_push'],
      constraints: [],
    },
    {
      exerciseId: 'demo-stationary-bike',
      name: 'Bicicleta estática',
      equipmentRequired: ['bike'],
      trainingModalities: ['cardio'],
      bodyRegions: ['legs'],
      primaryMuscles: ['quadriceps'],
      jointActions: [],
      movementPatterns: ['cyclical'],
      constraints: [],
    },
    {
      exerciseId: 'demo-cardio-machine-intervals',
      name: 'Intervalos en máquina de cardio',
      equipmentRequired: ['cardio_machine'],
      trainingModalities: ['cardio'],
      bodyRegions: ['legs'],
      primaryMuscles: [],
      jointActions: [],
      movementPatterns: ['cyclical'],
      constraints: [],
    },
    {
      exerciseId: 'demo-bodyweight-jumping-jacks',
      name: 'Jumping jacks',
      equipmentRequired: ['bodyweight'],
      trainingModalities: ['cardio'],
      bodyRegions: ['full_body'],
      primaryMuscles: [],
      jointActions: [],
      movementPatterns: ['cyclical'],
      constraints: [],
    },
    {
      exerciseId: 'demo-plank',
      name: 'Plancha',
      equipmentRequired: ['bodyweight'],
      trainingModalities: ['core'],
      bodyRegions: ['core'],
      primaryMuscles: ['rectus_abdominis'],
      jointActions: [],
      movementPatterns: ['anti_extension'],
      constraints: [],
    },
    {
      exerciseId: 'demo-bicycle-crunch',
      name: 'Abdominales bicicleta',
      equipmentRequired: ['bodyweight'],
      trainingModalities: ['core'],
      bodyRegions: ['core'],
      primaryMuscles: ['obliques'],
      jointActions: [],
      movementPatterns: ['rotation'],
      constraints: [],
    },
  ];
}
