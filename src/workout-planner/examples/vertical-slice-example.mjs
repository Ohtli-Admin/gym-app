// Small in-memory fixture demonstrating the full v0.1 pipeline:
//   raw input -> buildTrainingContext() -> evaluateCatalogCompatibility()
//   -> buildWorkoutPlan()
//
// This is the contract the next task (Today's Workout UI) will present.
// Not wired into app.js — run standalone with:
//   node src/workout-planner/examples/vertical-slice-example.mjs

import { pathToFileURL } from 'node:url';
import { buildTrainingContext } from '../../context-engine/index.mjs';
import { evaluateCatalogCompatibility } from '../../compatibility-engine/index.mjs';
import { buildWorkoutPlan } from '../index.mjs';

export const fixtureRawContext = {
  trainingGoal: 'general_fitness',
  environment: 'home',
  timeAvailableMinutes: 40,
  experienceLevel: 'intermediate',
  modalities: ['gym', 'core'],
  equipment: ['dumbbell', 'bodyweight'],
  restrictions: [
    {
      description: 'Ease into overhead pressing after a recent shoulder tweak',
      region: 'shoulder',
      avoidTags: ['overhead_press'],
      severity: 'soft',
    },
  ],
};

export const fixtureExercises = [
  {
    exerciseId: 'src-002-dumbbell-goblet-squat',
    name: 'Dumbbell Goblet Squat',
    equipmentRequired: ['dumbbell'],
    trainingModalities: ['gym'],
    bodyRegions: ['legs'],
    primaryMuscles: ['quadriceps'],
    jointActions: ['knee_flexion'],
    movementPatterns: ['squat'],
    constraints: [],
  },
  {
    exerciseId: 'src-002-dumbbell-bent-over-row',
    name: 'Dumbbell Bent-Over Row',
    equipmentRequired: ['dumbbell'],
    trainingModalities: ['gym'],
    bodyRegions: ['back'],
    primaryMuscles: ['latissimus_dorsi'],
    jointActions: ['shoulder_extension'],
    movementPatterns: ['horizontal_pull'],
    constraints: [],
  },
  {
    exerciseId: 'src-002-dumbbell-overhead-press',
    name: 'Dumbbell Overhead Press',
    equipmentRequired: ['dumbbell'],
    trainingModalities: ['gym'],
    bodyRegions: ['shoulders'],
    primaryMuscles: ['deltoid'],
    jointActions: ['shoulder_flexion'],
    movementPatterns: ['overhead_press'],
    constraints: [],
  },
  {
    exerciseId: 'src-002-barbell-bench-press',
    name: 'Barbell Bench Press',
    equipmentRequired: ['barbell', 'bench'],
    trainingModalities: ['gym'],
    bodyRegions: ['chest'],
    primaryMuscles: ['pectoralis_major'],
    jointActions: ['shoulder_horizontal_adduction'],
    movementPatterns: ['horizontal_push'],
    constraints: [],
  },
  {
    exerciseId: 'src-002-plank',
    name: 'Plank',
    equipmentRequired: ['bodyweight'],
    trainingModalities: ['core'],
    bodyRegions: ['core'],
    primaryMuscles: ['rectus_abdominis'],
    jointActions: [],
    movementPatterns: ['anti_extension'],
    constraints: [],
  },
  {
    exerciseId: 'src-002-bicycle-crunch',
    name: 'Bicycle Crunch',
    equipmentRequired: ['bodyweight'],
    trainingModalities: ['core'],
    bodyRegions: ['core'],
    primaryMuscles: ['obliques'],
    jointActions: [],
    movementPatterns: ['rotation'],
    constraints: [],
  },
];

// Runs the full pipeline once and returns every stage's output, so a test
// or a manual run can inspect the context, the compatibility evaluation,
// and the final plan together.
export function runVerticalSliceExample() {
  const context = buildTrainingContext(fixtureRawContext);
  const compatibilityResult = evaluateCatalogCompatibility(context, fixtureExercises);
  // allowConditional: true so this fixture also demonstrates the
  // conditional-inclusion path end to end (the overhead press exercise
  // above matches the fixture's soft restriction).
  const plan = buildWorkoutPlan(context, compatibilityResult, { allowConditional: true });
  return { context, compatibilityResult, plan };
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const { plan } = runVerticalSliceExample();
  console.log(JSON.stringify(plan, null, 2));
}
