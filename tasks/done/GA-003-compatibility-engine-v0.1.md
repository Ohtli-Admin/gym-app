# [GA-003] Compatibility Engine v0.1

- **Status:** DONE
- **Agent/Owner:** Claude Sonnet 5

## Objective

Implement a deterministic, pure domain component that reduces a set of
exercises to compatible / conditional / incompatible against a normalized
`TrainingContext` (`src/context-engine`), as the second stage of the
pipeline: Context Engine -> Compatibility Engine -> Workout Planner.

## Context

`docs/REENGINEERING_DECISION_FRAME.md` ("Compatibility decision") defines
compatibility as `canonical exercise attributes + user constraint + current
context -> allowed / excluded / conditional`, decided deterministically
outside the LLM. `docs/EXERCISE_INTEGRATION_CONTRACT.md`'s "Ownership
boundary" and "Field tiers" sections name the specific objective Library
attributes (`biomechanics.constraints`, `classification.joint_actions`,
`classification.movement_patterns`, `classification.primary_muscles`,
`classification.body_regions`, `setup.equipment_required`) this engine's
rules are grounded in.

## Scope

- A new domain module (`src/compatibility-engine/`) exposing
  `evaluateExerciseCompatibility(context, exercise)` and
  `evaluateCatalogCompatibility(context, exercises)`.
- A minimal canonical-compatible exercise adapter/input contract, decoupled
  from Supabase and the legacy `ejercicios` shape.
- Deterministic rules A–D (equipment, requested modality, explicit
  restriction matching, malformed-input handling), with explicit
  precedence and machine-readable reason codes.
- Automated tests (`node --test`, no new dependency).
- Documentation of the public interface for Workout Planner
  (`src/compatibility-engine/README.md`).

## Out of scope

- Any medical knowledge, diagnosis, or inference (e.g. inferring that a
  region implies which movements to avoid).
- Coupling to Supabase, the legacy `ejercicios` table, or
  `Gym-Exercise-Library`'s repository internals.
- HARD-001..005, `supabase/design/exercise_identity_mapping.sql`, legacy
  crosswalk/migration work.
- `app.js`, Edge Function integration, Workout Planner, UI, deploy, merge.

## Acceptance criteria

- [x] `evaluateExerciseCompatibility`/`evaluateCatalogCompatibility`
      implemented, pure, deterministic, no LLM/network/Supabase/UI calls.
- [x] Exercise adapter uses only attributes documented in
      `docs/EXERCISE_INTEGRATION_CONTRACT.md`; no invented fields.
- [x] Rules A (equipment), B (modality), C (explicit restriction match), D
      (malformed input) implemented with explicit precedence.
- [x] No rule infers a restriction's meaning from a region/description —
      only explicit `avoidTags` match against explicit exercise attributes.
- [x] Multiple reason codes preserved; hard exclusion outranks conditional.
- [x] Catalog-level partitioning API for Workout Planner.
- [x] Automated tests cover the 14 cases in the task brief.
- [x] Context Engine's existing restriction model (avoidTags + severity)
      already supports the required semantics — no Context Engine change
      was necessary.
- [x] Not wired into `app.js` or any Edge Function.

## Allowed files/areas

- `src/compatibility-engine/**` (new directory).
- `tasks/**` (this task file's lifecycle).

## Dependencies

- `src/context-engine` (`GA-002`, commit `e601dbd`) — consumes
  `buildTrainingContext`'s output and reuses its `normalizeToken`/
  `normalizeTokenArray` for cross-engine token consistency.
- `docs/EXERCISE_INTEGRATION_CONTRACT.md` — source of the exercise adapter
  field list.

## Required validations

- `node --test src/context-engine/context-engine.test.mjs`
- `node --test src/compatibility-engine/compatibility-engine.test.mjs`
- `git diff --check`

## Result

**Summary:** Implemented Compatibility Engine v0.1 under
`src/compatibility-engine/`, mirroring Context Engine's modular structure
(schema / adapter / rules / errors / index, each a separate file). Not
wired into `app.js` or any Edge Function. No change to Context Engine was
required — its existing restriction shape (`avoidTags` + `severity: 'soft'
| 'hard'`) already covers the semantics this engine needs.

**Files created:**
- `src/compatibility-engine/compatibility-schema.mjs` — statuses, reason
  codes, precedence sets, exercise-adapter field lists.
- `src/compatibility-engine/exercise-adapter.mjs` — `validateExerciseStructure`,
  `normalizeExercise`, `extractExerciseId`.
- `src/compatibility-engine/rules.mjs` — `evaluateEquipmentRule`,
  `evaluateModalityRule`, `evaluateRestrictionsRule`.
- `src/compatibility-engine/errors.mjs` — `CompatibilityInputError`.
- `src/compatibility-engine/index.mjs` — `evaluateExerciseCompatibility`,
  `evaluateCatalogCompatibility`, precedence resolution, result freezing.
- `src/compatibility-engine/compatibility-engine.test.mjs` — `node:test`
  coverage (17 tests).
- `src/compatibility-engine/README.md` — public API, exercise adapter
  contract, rules, precedence, reason codes, and the Workout Planner
  integration boundary.

**Public APIs:**
- `evaluateExerciseCompatibility(context, exercise) -> { exerciseId, exercise, status, reasons }`
- `evaluateCatalogCompatibility(context, exercises) -> { results, compatible, conditional, incompatible }`

Both throw `CompatibilityInputError` if `context` is not a normalized
`TrainingContext` shape (a caller/integration bug, thrown fail-fast); a
single malformed exercise inside a catalog is never thrown for — see rule D.

**Exercise adapter/input contract:** a flat, canonical-compatible shape
built only from attributes `docs/EXERCISE_INTEGRATION_CONTRACT.md`
documents: `exerciseId` (required, <- `exercise_id`), `name` (optional,
display-only), `equipmentRequired`/`equipmentOptional` (<-
`setup.equipment_*`), `bodyRegions`/`primaryMuscles`/`jointActions`/
`movementPatterns` (<- `classification.*`, named in the contract's
"Ownership boundary" as the objective attributes GymApp's compatibility
layer interprets), `constraints` (<- `biomechanics.constraints`, the field
the contract explicitly earmarks for "once the compatibility engine
exists"). `trainingModalities` is GymApp's own adapter-level name — the
contract confirms a `taxonomy/training-types.json` vocabulary exists
upstream but does not pin an exact field path for it, so this name is
flagged in the README as GymApp-adopted, not contract-confirmed, following
the contract document's own "Confirmed vs. Proposed" convention. No
attribute was invented beyond what the contract documents. Full mapping
table in `src/compatibility-engine/README.md`.

**Implemented compatibility rules:**
- **A. Equipment** — every non-`'bodyweight'` `equipmentRequired` item must
  be in `context.equipment`; one `EQUIPMENT_UNAVAILABLE` reason per missing
  item. `'bodyweight'`/empty `equipmentRequired` never requires anything.
- **B. Requested modality** — `exercise.trainingModalities` must intersect
  `context.modalities`; otherwise `MODALITY_UNSATISFIED`. An exercise with
  no modality tag fails the same intersection check — no special case, no
  inference from the exercise's name.
- **C. Explicit active restrictions** — a restriction's own `avoidTags` are
  matched against the exercise's pooled objective tags (`constraints`,
  `jointActions`, `movementPatterns`, `primaryMuscles`, `bodyRegions`).
  `severity: 'hard'` match -> `RESTRICTION_HARD_MATCH`; `'soft'` match ->
  `RESTRICTION_SOFT_MATCH`. `restriction.region` is never used for
  matching — matching on region alone would require inferring which
  movements it implies, which is out of scope by the task's own domain
  boundary.
- **D. Malformed/insufficient exercise input** — structurally invalid input
  (missing `exerciseId`, wrong-typed field, non-object) always resolves to
  `incompatible` with `EXERCISE_CONTRACT_INVALID`, never silently
  compatible; reported per-record (not thrown) so one bad catalog row
  doesn't abort the batch.

**Precedence:** all three rules always run and every reason is collected
before a status is decided (no short-circuiting). Final status: any
`INCOMPATIBLE_REASON_CODES` member present -> `incompatible` (wins over any
conditional match); else any `CONDITIONAL_REASON_CODES` member ->
`conditional`; else `compatible` with `reasons: []`.

**Reason codes:** `EXERCISE_CONTRACT_INVALID`, `EQUIPMENT_UNAVAILABLE`,
`MODALITY_UNSATISFIED`, `RESTRICTION_HARD_MATCH`, `RESTRICTION_SOFT_MATCH`
— each `{ code, message, detail }`.

**Tests and exact results:**
```
node --test src/context-engine/context-engine.test.mjs
tests 12, pass 12, fail 0

node --test src/compatibility-engine/compatibility-engine.test.mjs
✔ 1. compatible exercise with available equipment
✔ 2. missing required equipment -> incompatible
✔ 3. bodyweight/no-equipment exercise is compatible regardless of context equipment
✔ 4. requested modality match
✔ 5. modality mismatch -> incompatible
✔ 6. explicit hard restriction match -> incompatible
✔ 7. explicit conditional (soft) restriction match -> conditional
✔ 8. hard exclusion takes precedence over conditional
✔ 9. multiple reason codes are preserved, not short-circuited
✔ 10. malformed exercise cannot silently become compatible
✔ 11. catalog partitioning
✔ 12. deterministic output for equivalent input
✔ 13. no restriction is invented when context contains none
✔ 14. exercise identity is preserved in the result
✔ rejects a context that is not a normalized TrainingContext
✔ evaluateCatalogCompatibility rejects a non-array exercises argument
✔ the result is frozen but the caller-owned exercise object is not
tests 17, pass 17, fail 0
```
`git diff --check` — no whitespace errors (only benign CRLF-on-touch
notices from `git add -N`, same as GA-002).

**Intentional deferrals:**
- `equipmentOptional`-based rules (e.g. a softer outcome when only optional
  equipment is missing).
- Exercise `status` (draft/review_required/approved/deprecated) trust-tier
  filtering.
- Any use of `restriction.region` for matching, or any inference from a
  restriction's region/description to exercise attributes.
- Workout Planner itself (selection, ordering, substitutions) and any UI
  presentation of `reasons`.

**Risks:**
- None to existing behavior: no existing file was modified, and this
  module is not imported anywhere yet.
- `trainingModalities`'s field-name mapping to the eventual Library export
  is an assumption (flagged as such in the README); when
  `Gym-Exercise-Library` confirms the real field path, only
  `exercise-adapter.mjs`'s doc comment and any real Library-backed adapter
  (not yet built) need updating — the rule logic itself is unaffected.

**Pending decisions:**
- None required to close this task as implemented. Building Workout
  Planner, and wiring a real Gym-Exercise-Library-backed adapter into this
  engine's input contract, are separate future tasks.

**Git status at completion:** all changes are new, untracked files under
`src/compatibility-engine/` and this task file; nothing was committed or
pushed.

## Closeout note

- Compatibility Engine v0.1 implemented.
- Context Engine tests: 12/12 PASS.
- Compatibility Engine tests: 17/17 PASS.
- No production integration yet.
- Workout planning intentionally deferred to GA-004.
