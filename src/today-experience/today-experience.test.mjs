import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildTrainingContext } from '../context-engine/index.mjs';
import { evaluateCatalogCompatibility } from '../compatibility-engine/index.mjs';
import { runTodayOrchestration } from './orchestrator.mjs';
import { buildTodayViewModel, buildContextInputFromUi, defaultTodayUiState } from './today-view-model.mjs';
import { getDemoExerciseCatalog } from './demo-catalog-provider.mjs';

test('1. UI input can build a valid TrainingContext', () => {
  const uiState = defaultTodayUiState();
  const context = buildTrainingContext(buildContextInputFromUi(uiState));

  assert.equal(context.environment, 'gym');
  assert.deepEqual(context.modalities, ['gym']);
  assert.equal(context.timeAvailableMinutes, 45);
  assert.deepEqual(context.restrictions, []);
});

test('2. orchestration calls the real Context/Compatibility/Planner pipeline (no duplicated logic)', () => {
  const uiState = { ...defaultTodayUiState(), equipment: ['dumbbell'] };
  const catalog = getDemoExerciseCatalog();

  const result = runTodayOrchestration(uiState, { catalogProvider: () => catalog });
  assert.ok(result.ok);

  // Calling Compatibility Engine directly, with the exact same normalized
  // context and catalog, must produce an IDENTICAL result. If Today ever
  // grew its own copy of equipment/modality/restriction matching instead
  // of calling evaluateCatalogCompatibility(), this would diverge.
  const directContext = buildTrainingContext(buildContextInputFromUi(uiState));
  const directCompat = evaluateCatalogCompatibility(directContext, catalog);
  assert.deepEqual(result.compatibilityResult, directCompat);
});

test('3. a READY plan is represented in the view model', () => {
  const uiState = { ...defaultTodayUiState(), modalities: ['gym'], equipment: ['dumbbell', 'barbell', 'bench'] };
  const result = runTodayOrchestration(uiState);
  assert.ok(result.ok);
  assert.equal(result.plan.status, 'ready');

  const viewModel = buildTodayViewModel(result);
  assert.equal(viewModel.kind, 'plan');
  assert.equal(viewModel.status, 'ready');
  assert.equal(viewModel.tone, 'success');
  assert.ok(viewModel.exercises.length > 0);
});

test('4. a PARTIAL plan is represented in the view model', () => {
  const uiState = { ...defaultTodayUiState(), modalities: ['gym', 'cardio'], equipment: ['dumbbell', 'barbell', 'bench'] };
  // Explicitly exclude every cardio-tagged exercise so 'cardio' has zero
  // candidates (a bodyweight cardio exercise would otherwise still be
  // equipment-compatible regardless of declared equipment — see rule A in
  // src/compatibility-engine/rules.mjs), leaving 'gym' fully satisfiable.
  const gymOnlyCatalog = getDemoExerciseCatalog().filter((exercise) => !exercise.trainingModalities.includes('cardio'));

  const result = runTodayOrchestration(uiState, { catalogProvider: () => gymOnlyCatalog });
  assert.ok(result.ok);
  assert.equal(result.plan.status, 'partial');

  const viewModel = buildTodayViewModel(result);
  assert.equal(viewModel.status, 'partial');
  assert.equal(viewModel.tone, 'warning');
});

test('5. an UNAVAILABLE plan is represented in the view model', () => {
  const uiState = { ...defaultTodayUiState(), modalities: ['cardio'], equipment: [] };
  const result = runTodayOrchestration(uiState, { catalogProvider: () => [] });
  assert.ok(result.ok);
  assert.equal(result.plan.status, 'unavailable');

  const viewModel = buildTodayViewModel(result);
  assert.equal(viewModel.status, 'unavailable');
  assert.equal(viewModel.tone, 'danger');
  assert.equal(viewModel.exercises.length, 0);
});

test('6. a conditional warning/reason is translated into understandable UI text', () => {
  const uiState = {
    ...defaultTodayUiState(),
    modalities: ['gym'],
    equipment: ['dumbbell'],
    demoShoulderRestriction: true,
    allowConditional: true,
  };
  // Restrict the catalog to only the overhead-press exercise so it MUST be
  // the one selected (proving the conditional path, not just "some plan").
  const catalog = getDemoExerciseCatalog().filter((ex) => ex.exerciseId === 'demo-dumbbell-overhead-press');

  const result = runTodayOrchestration(uiState, { catalogProvider: () => catalog });
  assert.ok(result.ok);
  const viewModel = buildTodayViewModel(result);

  assert.equal(viewModel.status, 'partial');
  const conditionalItem = viewModel.exercises.find((item) => item.isConditional);
  assert.ok(conditionalItem, 'expected a conditional exercise in the plan');
  assert.ok(conditionalItem.cautionMessages.length > 0);
  assert.ok(!/RESTRICTION_SOFT_MATCH/.test(conditionalItem.cautionMessages[0]), 'must not surface the raw reason code');
  assert.ok(conditionalItem.cautionMessages[0].toLowerCase().includes('precaución'));

  assert.ok(viewModel.warnings.length > 0);
  assert.ok(viewModel.warnings.some((w) => w.includes('con precaución')));
});

test('7. invalid Today input produces a user-facing validation state, not a thrown exception', () => {
  const invalidUiState = { ...defaultTodayUiState(), timeAvailableMinutes: 5000 }; // outside Context Engine's valid range

  const result = runTodayOrchestration(invalidUiState);
  assert.equal(result.ok, false);
  assert.equal(result.errorKind, 'validation');

  const viewModel = buildTodayViewModel(result);
  assert.equal(viewModel.kind, 'error');
  assert.equal(viewModel.headline, 'Revisa los datos de hoy');
  assert.ok(!/timeAvailableMinutes/.test(viewModel.message), 'user-facing message must not be the raw validation error');
});

test('8. Today never duplicates domain rules — equivalent to calling the engines directly', () => {
  const uiState = { ...defaultTodayUiState(), equipment: ['bodyweight'], modalities: ['calisthenics'] };
  const catalog = getDemoExerciseCatalog();

  const viaOrchestrator = runTodayOrchestration(uiState, { catalogProvider: () => catalog });
  const context = buildTrainingContext(buildContextInputFromUi(uiState));
  const compat = evaluateCatalogCompatibility(context, catalog);

  assert.deepEqual(viaOrchestrator.context, context);
  assert.deepEqual(viaOrchestrator.compatibilityResult, compat);
});

// The exact set of files reachable from browser-entry.mjs (the only file
// index.html loads as a module). If this graph changes, update this list —
// it is intentionally explicit rather than walked dynamically, so a
// reviewer can see exactly what is claimed to be browser-safe.
const BROWSER_REACHABLE_FILES = [
  'today-experience/browser-entry.mjs',
  'today-experience/today-panel.mjs',
  'today-experience/orchestrator.mjs',
  'today-experience/today-view-model.mjs',
  'today-experience/demo-catalog-provider.mjs',
  'today-experience/workout-session.mjs',
  'today-experience/legacy-adapter.mjs',
  'today-experience/today-coordinator.mjs',
  'context-engine/index.mjs',
  'context-engine/context-schema.mjs',
  'context-engine/errors.mjs',
  'context-engine/normalize.mjs',
  'context-engine/validate.mjs',
  'context-engine/defaults.mjs',
  'compatibility-engine/index.mjs',
  'compatibility-engine/compatibility-schema.mjs',
  'compatibility-engine/exercise-adapter.mjs',
  'compatibility-engine/rules.mjs',
  'compatibility-engine/errors.mjs',
  'workout-planner/index.mjs',
  'workout-planner/planner-schema.mjs',
  'workout-planner/prescription-policy.mjs',
  'workout-planner/allocate.mjs',
  'workout-planner/plan-id.mjs',
  'workout-planner/errors.mjs',
];

test('9. every browser-reachable module avoids Node-only imports', async () => {
  for (const relativePath of BROWSER_REACHABLE_FILES) {
    const source = await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
    assert.ok(
      !/from\s+['"]node:/.test(source) && !/require\(/.test(source),
      `${relativePath} must not import a Node-only module (found one)`,
    );
  }
});
