# [GA-004] Workout Planner v0.1

- **Status:** DONE
- **Agent/Owner:** Claude Sonnet 5

## Objective

Implement a deterministic Workout Planner that turns a normalized
`TrainingContext` and Compatibility Engine's catalog evaluation into an
ordered, explainable workout plan — the third stage of Context Engine ->
Compatibility Engine -> Workout Planner -> Today's Workout UI.

## Context

`docs/REENGINEERING_DECISION_FRAME.md`'s target user journey calls for
"propose what to do today" as a distinct step after compatibility is known.
This task builds only the deterministic planning step; it explicitly does
not decide exercise safety/compatibility (`GA-003`, commit `8ef17d0`) and
does not build the presentation layer (a future task).

## Scope

- A new domain module (`src/workout-planner/`) exposing
  `buildWorkoutPlan(context, compatibilityResult, options?)`.
- A small, documented v0.1 planning policy: flat per-modality
  prescription/duration defaults, a deterministic round-robin allocator,
  explicit `ready`/`partial`/`unavailable` statuses, and machine-readable
  warnings.
- Automated tests (`node --test`, no new dependency).
- An in-memory vertical-slice fixture wiring all three engines together.
- Documentation of the public interface for the next (UI) task.

## Out of scope

- Any exercise safety/compatibility decision (consumes Compatibility
  Engine's results verbatim; never recreates its rules).
- Per-exercise prescription/duration data (not supplied by the current
  exercise adapter contract) — a flat per-modality default is used
  instead, explicitly documented as a policy, not canonical data.
- A periodization/programming engine, substitutions, warm-up/cool-down
  structuring, rest-interval planning.
- `app.js`, Edge Function integration, UI, deploy, merge.
- Redesigning Context Engine or Compatibility Engine.

## Acceptance criteria

- [x] `buildWorkoutPlan` never selects an incompatible exercise (it only
      ever reads `.compatible`/`.conditional`).
- [x] Compatible preferred over conditional; conditional excluded by
      default and included only via explicit `options.allowConditional`.
- [x] `context.timeAvailableMinutes` and requested modalities respected.
- [x] No duplicate exercise identity within a plan.
- [x] Explicit ordered session (`order` field + array order).
- [x] Compatibility reasons preserved on conditional plan items; a
      plan-level warning surfaces conditional inclusion.
- [x] `ready`/`partial`/`unavailable` statuses defined and used instead of
      throwing for an ordinary "no valid workout" outcome.
- [x] Deterministic: no randomness, no LLM, no network; equivalent input
      produces identical output.
- [x] Automated tests cover the 15 cases in the task brief, plus an
      integration-style fixture test.
- [x] Not wired into `app.js` or any Edge Function.

## Allowed files/areas

- `src/workout-planner/**` (new directory).
- `tasks/**` (this task file's lifecycle).

## Dependencies

- `src/context-engine` (`GA-002`, commit `e601dbd`).
- `src/compatibility-engine` (`GA-003`, commit `8ef17d0`) — consumes
  `evaluateCatalogCompatibility`'s output; does not recreate its rules.

## Required validations

- `node --test src/context-engine/context-engine.test.mjs`
- `node --test src/compatibility-engine/compatibility-engine.test.mjs`
- `node --test src/workout-planner/workout-planner.test.mjs`
- `node src/workout-planner/examples/vertical-slice-example.mjs` (manual
  run of the vertical-slice fixture)
- `git diff --check`

## Result

**Summary:** Implemented Workout Planner v0.1 under `src/workout-planner/`,
mirroring the modular structure of Context/Compatibility Engine. No change
to either engine was required — Planner consumes their existing public
contracts as-is (`buildTrainingContext`'s output; `evaluateCatalogCompatibility`'s
`.compatible`/`.conditional`/`.incompatible` buckets). Not wired into
`app.js` or any Edge Function.

**Files created:**
- `src/workout-planner/planner-schema.mjs` — `PLAN_STATUSES`,
  `PLAN_WARNING_CODES`, `MODALITY_PLANNING_DEFAULTS`.
- `src/workout-planner/prescription-policy.mjs` —
  `resolveModalityPlanningDefaults`.
- `src/workout-planner/plan-id.mjs` — `computePlanId` (SHA-256 fingerprint,
  no randomness).
- `src/workout-planner/allocate.mjs` — `allocateExercises` (round-robin
  allocator).
- `src/workout-planner/errors.mjs` — `PlannerInputError`.
- `src/workout-planner/index.mjs` — `buildWorkoutPlan` (public entry
  point), status/warning resolution, result freezing.
- `src/workout-planner/workout-planner.test.mjs` — `node:test` coverage
  (15 tests).
- `src/workout-planner/examples/vertical-slice-example.mjs` — in-memory
  fixture (`fixtureRawContext`, `fixtureExercises`,
  `runVerticalSliceExample()`), runnable standalone and reused by the
  integration test.
- `src/workout-planner/README.md` — public API, plan contract, time-budget
  policy, selection/ordering policy, conditional policy, modality
  allocation policy, statuses, module layout, deferrals.

**Public API:**
`buildWorkoutPlan(context, compatibilityResult, options?) -> frozen plan
object` (see `src/workout-planner/README.md` "Plan output contract" for
the exact shape). Throws `PlannerInputError` only for a caller/integration
shape violation on `context`/`compatibilityResult`/`options`.

**Plan output contract:** `{ planId, status, requestedDurationMinutes,
estimatedDurationMinutes, modalitiesRequested, modalitiesCovered,
exercises: [{ order, exerciseId, name, modality, status, reasons,
prescription, estimatedDurationMinutes }], warnings, optionsUsed }`. Fully
frozen; never mutates the caller's `context`/`compatibilityResult`/exercise
objects.

**Time-budget policy:** one flat estimated-duration-per-exercise value per
requested modality (`MODALITY_PLANNING_DEFAULTS`: gym 6 min, calisthenics
5 min, cardio 8 min, core 4 min) — not per-exercise, because the exercise
adapter contract supplies no real duration data. A running
`remainingMinutes` counter gates each pick; once a modality's flat cost no
longer fits, that modality is marked exhausted (safe because every
remaining candidate for it costs the same). Demonstrated by test 7: the
same 20-candidate catalog produces a 3-exercise plan at 20 minutes and a
15-exercise plan at 90 minutes.

**Candidate selection/ordering policy:** deterministic round-robin across
`context.modalities` in their normalized/deduped order; within a modality,
compatible candidates before conditional ones; within the same status, the
stable order already present in `compatibilityResult.compatible`/`.conditional`
(itself the original catalog input order) is the documented tie-break. No
randomness, no LLM, no exercise-name heuristics. A multi-modality exercise
is selected at most once, under whichever modality's turn reaches it
first.

**Conditional-exercise policy:** conditional candidates are appended to a
modality's queue only when `options.allowConditional: true`; since
compatible candidates always sort first in the same queue, a conditional
item is only actually picked once compatible supply for that slot is
exhausted. A selected conditional item keeps Compatibility Engine's
`reasons` verbatim and produces a `CONDITIONAL_EXERCISES_INCLUDED`
plan-level warning; using any conditional item forces `status: 'partial'`.
`restriction.region` is never used for matching anywhere in this pipeline.

**Modality allocation policy:** the round-robin described above *is* the
multi-modality allocation policy — one pick per eligible modality per
round, no per-modality target counts or weighting, easy to replace later.

**READY/PARTIAL/UNAVAILABLE semantics:** `ready` = every requested modality
covered, only compatible candidates used. `partial` = non-empty plan, but
at least one modality uncovered or a conditional candidate was needed.
`unavailable` = zero exercises scheduled (no candidates, or none fit the
time budget). Never thrown for these ordinary outcomes; `PlannerInputError`
is reserved for a caller/integration contract violation.

**Tests and exact results:**
```
node --test src/context-engine/context-engine.test.mjs
tests 12, pass 12, fail 0

node --test src/compatibility-engine/compatibility-engine.test.mjs
tests 17, pass 17, fail 0

node --test src/workout-planner/workout-planner.test.mjs
✔ 1. builds a plan from compatible candidates
✔ 2. incompatible exercise is never selected
✔ 3. compatible preferred over conditional
✔ 4. conditional excluded by default
✔ 5. conditional can be included through an explicit option
✔ 6. conditional inclusion preserves reasons and produces a warning
✔ 7. a 20-minute context produces a smaller plan than a 90-minute context
✔ 8. requested modality is respected
✔ 9. multiple modalities receive deterministic round-robin treatment
✔ 10. duplicate exercise identity is not selected twice
✔ 11. no valid candidates -> unavailable, not an exception
✔ 12. insufficient candidates -> partial
✔ 13. deterministic output for equivalent input
✔ 14. malformed caller input is rejected
✔ 15. integration: Context Engine + Compatibility Engine + Planner via in-memory fixtures
tests 15, pass 15, fail 0
```
`git diff --check` — no whitespace errors (only benign CRLF-on-touch
notices, same as GA-002/GA-003).

**Vertical-slice fixture result:** `node src/workout-planner/examples/vertical-slice-example.mjs`
produces a `partial` plan (40-minute home context, modalities
`['gym','core']`, one soft shoulder restriction): 5 exercises (3 gym, 2
core, 26 of 40 minutes used), including the fixture's overhead-press
exercise as a `conditional` item (its `RESTRICTION_SOFT_MATCH` reason
preserved verbatim) with a `CONDITIONAL_EXERCISES_INCLUDED` warning — full
JSON output captured in this task's implementation session. This is the
exact object the next task's UI is expected to consume.

**Intentional deferrals:**
- Per-exercise duration/prescription data (blocked on the exercise
  contract; flat per-modality default used instead).
- Periodization/programming, exercise-sequencing beyond round-robin,
  warm-up/cool-down, rest intervals.
- Substitution logic.
- Any UI presentation of `reasons`/`warnings`.
- `app.js`/Edge Function integration.

**Risks:**
- None to existing behavior: no existing file was modified, and this
  module is not imported anywhere yet.
- The flat per-modality duration defaults are a placeholder policy; once
  real per-exercise duration data is available (from a future canonical
  Library field or a GymApp-side estimation model), only
  `prescription-policy.mjs`/`planner-schema.mjs` need to change — the
  allocator's control flow is unaffected by design.

**Pending decisions:**
- None required to close this task as implemented. Building the "Today's
  Workout UI" and wiring a real Gym-Exercise-Library-backed exercise
  catalog into this pipeline are separate future tasks.

**Git status at completion:** all changes are new, untracked files under
`src/workout-planner/` and this task file; nothing was committed or
pushed.

## Closeout note

- Workout Planner v0.1 implemented.
- Context Engine tests: 12/12 PASS.
- Compatibility Engine tests: 17/17 PASS.
- Workout Planner tests: 15/15 PASS.
- End-to-end in-memory vertical-slice fixture works.
- No production/UI integration yet.
- First visible GymApp 2.0 vertical slice intentionally deferred to next
  task.
