# Workout Planner v0.1

Deterministic, side-effect-free domain module that turns a normalized
`TrainingContext` (`src/context-engine`) and Compatibility Engine's catalog
evaluation (`src/compatibility-engine`) into an ordered, explainable
workout plan. Third stage of the pipeline in
`docs/REENGINEERING_DECISION_FRAME.md`:

```
Context Engine -> Compatibility Engine -> Workout Planner (this module) -> Today's Workout UI
```

This module does not decide exercise safety/compatibility — it only
consumes Compatibility Engine's `.compatible`/`.conditional` results. It
never sees `.incompatible` exercises at all, so it cannot select one.

## Public API

```js
import { buildTrainingContext } from './src/context-engine/index.mjs';
import { evaluateCatalogCompatibility } from './src/compatibility-engine/index.mjs';
import { buildWorkoutPlan } from './src/workout-planner/index.mjs';

const context = buildTrainingContext({ /* ... */ });
const compatibilityResult = evaluateCatalogCompatibility(context, exercises);

const plan = buildWorkoutPlan(context, compatibilityResult, { allowConditional: false });
```

`options` is optional; `allowConditional` defaults to `false`. Both
`context` and `compatibilityResult` must be the direct outputs of
`buildTrainingContext()` / `evaluateCatalogCompatibility()` — an invalid
shape throws `PlannerInputError` (a caller/integration bug, fail-fast).
An ordinary "no valid workout" outcome is **never** a throw — see "Plan
statuses" below.

## Plan output contract

```js
{
  planId: 'plan-02b44d1e86d6c9c7',   // deterministic hash of the inputs that shaped this plan — see "Plan id"
  status: 'ready' | 'partial' | 'unavailable',
  requestedDurationMinutes: 40,       // = context.timeAvailableMinutes
  estimatedDurationMinutes: 26,       // sum of the planned items' own estimates
  modalitiesRequested: ['gym', 'core'],
  modalitiesCovered: ['gym', 'core'], // requested modalities that got >= 1 exercise, in requested order
  exercises: [
    {
      order: 1,                       // 1-based, matches array position
      exerciseId: 'src-002-...',
      name: 'Dumbbell Goblet Squat',  // or null if the exercise adapter omitted it
      modality: 'gym',                // which requested modality this slot was allocated to
      status: 'compatible' | 'conditional',
      reasons: [ /* Compatibility Engine's own reason objects, verbatim */ ],
      prescription: { type: 'sets_reps', sets: 3, reps: 10 } | { type: 'duration', durationMinutes: 8 },
      estimatedDurationMinutes: 6,
    },
    // ...
  ],
  warnings: [ { code, message, detail } ],
  optionsUsed: { allowConditional: false },
}
```

The whole object (and every plan item, and the `warnings`/`modalitiesRequested`/
`modalitiesCovered`/`optionsUsed` arrays/objects) is frozen. The caller's
own `context`/`compatibilityResult`/exercise objects are never mutated or
frozen — a plan item only *copies* the fields it needs
(`exerciseId`/`name`/`status`/`reasons`) out of the compatibility result.

There is no separate "notes" concept — plan-level notes and warnings are
represented as a single `warnings` array (a deliberate v0.1 simplification).

## Time-budget policy

v0.1 does not claim to predict real workout duration. Each requested
modality has one flat, documented estimated-duration-per-exercise value in
`planner-schema.mjs`'s `MODALITY_PLANNING_DEFAULTS` (gym: 6 min,
calisthenics: 5 min, cardio: 8 min, core: 4 min) — not a per-exercise
value, because the exercise adapter contract (`src/compatibility-engine`)
carries no real duration/prescription data at all.

The allocator (`allocate.mjs`) is a greedy round-robin: it keeps a running
`remainingMinutes` counter starting at `context.timeAvailableMinutes`, and
before adding a candidate it checks whether that modality's flat cost still
fits. Once a modality's next candidate doesn't fit, that modality is marked
exhausted and never revisited — this is safe specifically *because* the
cost is a flat per-modality value: every remaining candidate for that
modality costs exactly the same, so none of them would fit either. This
policy is deliberately replaceable: swap `MODALITY_PLANNING_DEFAULTS` (or
give `resolveModalityPlanningDefaults` a per-exercise data source later)
without touching `allocate.mjs`'s control flow.

Demonstrated directly by test 7 (`workout-planner.test.mjs`): with the same
20-candidate gym-only catalog, a 20-minute context produces a 3-exercise
plan and a 90-minute context produces a 15-exercise plan (6 min/exercise).

## Candidate selection / ordering policy

- **No randomness, no LLM, no exercise-name heuristics.** Only
  `context.modalities`, each candidate's `status`
  (compatible/conditional), and its `trainingModalities` participate in
  selection.
- **Round-robin across `context.modalities`**, tried in the exact order
  Context Engine normalized/deduped them (`context-engine`'s
  `normalizeTokenArray` — first-declared order is preserved). One pick per
  eligible modality per round; a round that adds nothing (every modality
  exhausted — empty queue or budget) ends allocation.
- **Within one modality, compatible candidates are tried before
  conditional ones** (see "Conditional-exercise policy"). Within the same
  status, candidates keep the order they already have in
  `compatibilityResult.compatible`/`.conditional`, which itself preserves
  the original exercise-catalog input order passed to
  `evaluateCatalogCompatibility` — this is the documented stable
  tie-break.
- **Deduplication (rule F):** a single exercise satisfying more than one
  requested modality (e.g. `trainingModalities: ['gym', 'core']`) is
  selected at most once, under whichever modality's turn reaches it first
  in round-robin order; every other modality's queue skips it once used.

## Conditional-exercise policy

Conditional is not incompatible, and the plan makes the distinction
visible rather than reinterpreting the underlying restriction:

1. Every modality's candidate queue is built compatible-first.
2. Conditional candidates are appended to the same queue **only** when the
   caller passes `options.allowConditional: true` — off by default.
3. Because compatible candidates are always tried first, a conditional
   candidate is only ever actually selected when compatible supply for
   that modality/budget slot has run out — i.e. "only when required to
   complete the requested plan," not preferred over an available
   compatible alternative.
4. A selected conditional item keeps Compatibility Engine's own `reasons`
   verbatim (e.g. `RESTRICTION_SOFT_MATCH` with the matched tags), and the
   plan gets a `CONDITIONAL_EXERCISES_INCLUDED` warning listing every
   conditional `exerciseId` used.
5. Using any conditional item forces `status: 'partial'` (see "Plan
   statuses") — using conditional is itself evidence the plan wasn't fully
   satisfiable by compatible candidates alone.

`restriction.region` is never used to decide anything here (or anywhere in
this pipeline) — only Compatibility Engine's own `avoidTags` match matters.

## Modality allocation policy

For a single requested modality, all eligible candidates simply queue up
in order. For **multiple** requested modalities, the round-robin described
above is the allocation policy: one exercise per eligible modality per
round, cycling in `context.modalities` order, until every modality is
exhausted (no more candidates, or the modality's flat cost no longer fits
the remaining budget). This is intentionally simple — no per-modality
target counts, no periodization, no weighting — and is easy to replace
with a more deliberate split later without changing the rest of the
planner.

## Plan statuses

- **`ready`** — every requested modality got at least one exercise, using
  only compatible candidates.
- **`partial`** — a non-empty plan was produced, but at least one
  requested modality has zero exercises, or a conditional candidate had to
  be used to fill a slot.
- **`unavailable`** — no exercise could be scheduled at all (no candidates,
  all excluded by the time budget, or conditional support disabled with no
  compatible supply). Never a thrown exception — see `PlannerInputError`
  below for what *is* thrown.

`PlannerInputError` is reserved for a caller/integration bug: `context`
isn't `buildTrainingContext()`'s output, `compatibilityResult` isn't
`evaluateCatalogCompatibility()`'s output, or `options.allowConditional`
isn't a boolean.

## Plan id

`planId` is a deterministic fingerprint (`plan-id.mjs`) of exactly the
values that shaped the plan (goal/environment/time/level/modalities/
equipment/restriction ids+severities, `allowConditional`, and the final
selected exercise ids) — no randomness, no timestamp. Equivalent inputs
always produce the same `planId`.

**Browser portability:** this module is loaded unmodified as a native ES
module in the browser by `src/today-experience` (GA-005) — no bundler, no
transpilation. It intentionally does not import `node:crypto` (or any
other Node built-in): the fingerprint is a small pure-JS FNV-1a-based hash
(two 32-bit lanes) instead of SHA-256, since `planId` only needs to be
stable and collision-resistant enough for a UI/debugging reference, not
cryptographically secure. Same module, same output, in Node and in the
browser. See `plan-id.test.mjs`.

## Module layout

- `planner-schema.mjs` — `PLAN_STATUSES`, `PLAN_WARNING_CODES`,
  `MODALITY_PLANNING_DEFAULTS` (the planning-policy defaults).
- `prescription-policy.mjs` — `resolveModalityPlanningDefaults(modality)`.
- `allocate.mjs` — `allocateExercises` (the round-robin allocator).
- `plan-id.mjs` — `computePlanId` (pure-JS, browser-portable — see "Plan id").
- `plan-id.test.mjs` — determinism + browser-portability coverage for `computePlanId`.
- `errors.mjs` — `PlannerInputError`.
- `index.mjs` — `buildWorkoutPlan` (the only intended entry point),
  status/warning resolution, freezing.
- `workout-planner.test.mjs` — `node --test` coverage.
- `examples/vertical-slice-example.mjs` — in-memory fixture running the
  full Context Engine -> Compatibility Engine -> Workout Planner pipeline;
  runnable standalone (`node src/workout-planner/examples/vertical-slice-example.mjs`)
  and reused by the integration test.

## Intentionally deferred (not in v0.1)

- Any per-exercise (rather than per-modality) duration/prescription data —
  blocked on the canonical exercise contract not supplying it yet.
- A true periodization/programming engine, exercise ordering by muscle
  group sequencing, warm-up/cool-down structuring, or rest-interval
  planning.
- Substitution logic (swapping one exercise for another within a plan).
- Any UI presentation of `reasons`/`warnings` — that is the next task
  ("Today's Workout UI").
- Wiring `buildWorkoutPlan` into `app.js` or any Edge Function.

## Running the tests

```
node --test src/context-engine/context-engine.test.mjs
node --test src/compatibility-engine/compatibility-engine.test.mjs
node --test src/workout-planner/workout-planner.test.mjs
node --test src/workout-planner/plan-id.test.mjs
```
