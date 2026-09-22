# [GA-002] Context Engine v0.1

- **Status:** DONE
- **Agent/Owner:** Claude Sonnet 5

## Objective

Implement a deterministic, testable domain model that normalizes and
validates the training context for a session — the first stage of the
future User/Context/Constraints -> Context Engine -> Compatibility Engine
-> Workout Planner -> LLM -> Today's Workout pipeline.

## Context

`docs/REENGINEERING_DECISION_FRAME.md` ("New domain concepts required" ->
"Current training context") calls for an explicit session context model,
separate from the static profile, that a future Compatibility Engine can
consume. This task builds only that first stage. It does not touch exercise
identity/crosswalk work (`GA-001`, `docs/EXERCISE_INTEGRATION_CONTRACT.md`,
`docs/LEGACY_EXERCISE_CROSSWALK.md`), which governs a separate concern
(canonical exercise identity, not session context).

## Scope

- A new domain module (`src/context-engine/`) exposing
  `buildTrainingContext(input)`.
- Normalization (casing/whitespace/dedup), structural validation, semantic
  (enum/range) validation, and explicit defaults, kept as separate files.
- Automated tests (`node --test`, no new dependency).
- Documentation of the public interface for the next task
  (`src/context-engine/README.md`).

## Out of scope

- Solving HARD-001 through HARD-005 or touching
  `supabase/design/exercise_identity_mapping.sql`.
- Wiring this module into `app.js`, `generate-routine`, or any other
  production code path.
- The Compatibility Engine itself (deciding exercise safety/compatibility).
- Any change to the legacy exercise catalog or crosswalk.
- Deploy, production Supabase, or `main`.

## Acceptance criteria

- [x] `buildTrainingContext(input)` normalizes goal, environment, equipment,
      time, level, restrictions, preferences, and modalities.
- [x] Deterministic: equivalent input produces identical output.
- [x] No LLM/network/database calls.
- [x] Structurally invalid input is rejected (`ContextValidationError`).
- [x] Unknown enum values are rejected, never silently coerced.
- [x] Restrictions are preserved when present and never invented when
      absent.
- [x] Automated tests cover the 10 cases listed in the task brief.
- [x] Not wired into the production workout-generation flow.

## Allowed files/areas

- `src/context-engine/**` (new directory).
- `tasks/**` (this task file's lifecycle).

## Dependencies

- `docs/REENGINEERING_DECISION_FRAME.md` ("Current training context").
- None on `GA-001`/the exercise crosswalk — this task's context model is
  independent of canonical exercise identity.

## Required validations

- `node --test src/context-engine/context-engine.test.mjs` — 12 tests
  (the 10 required cases plus 2 additional structural/immutability checks).
- `git diff --check` — no whitespace errors.

## Result

**Summary:** Implemented Context Engine v0.1 as a standalone ES module
under `src/context-engine/`, per the plain-JS-modules preference (the repo
has no existing bundler/module/test convention — `app.js` is a single
global-scope `<script>`). Not wired into `app.js` or any Edge Function.

**Files created:**
- `src/context-engine/context-schema.mjs` — enums and range constants.
- `src/context-engine/normalize.mjs` — token normalization, restriction
  normalization/dedup, preferences normalization, `deepFreeze`.
- `src/context-engine/validate.mjs` — `validateStructure` (shape/type) and
  `validateSemantics` (enum membership, ranges), as two separate passes.
- `src/context-engine/defaults.mjs` — `applyDefaults` (equipment,
  restrictions, preferences only; never defaults a required field).
- `src/context-engine/errors.mjs` — `ContextValidationError`.
- `src/context-engine/index.mjs` — `buildTrainingContext(input)` (public
  entry point) plus schema/error re-exports.
- `src/context-engine/context-engine.test.mjs` — `node:test` coverage.
- `src/context-engine/README.md` — public API, guarantees, module layout,
  and the integration boundary for the next task.

**Public API:**
`buildTrainingContext(input) -> normalized, frozen context object`, or
throws `ContextValidationError` (with an `issues: {field, message, code}[]`
array). See `src/context-engine/README.md` for the full shape and enums.

**Normalization/default rules implemented:**
- String enum fields (`trainingGoal`, `environment`, `experienceLevel`,
  each `modalities`/`equipment` entry) are trimmed, lowercased, and
  whitespace/hyphens unified to underscores before enum-checking.
- Equipment and modalities arrays are deduplicated by normalized value,
  keeping first-seen order.
- Restrictions are deduplicated by normalized id (explicit id, or a slug of
  the description when omitted), keeping first occurrence.
- Defaults applied only when a field is entirely omitted: `equipment` ->
  `['bodyweight']` (explicit "no equipment", not "assume all equipment" —
  see `REENGINEERING_DECISION_FRAME.md`'s note on that legacy bug);
  `restrictions` -> `[]`; `preferences` -> `{ dislikedEquipment: [], notes:
  null }`; a restriction's own `severity` -> `'hard'`, `source` ->
  `'user_declared'` (defaulting a sub-field of an already-declared
  restriction is not the same as inventing a restriction — covered
  separately by test 9, "no restriction invented when absent").
- Required fields (`trainingGoal`, `environment`, `experienceLevel`,
  `timeAvailableMinutes`, `modalities`) are never defaulted — omitting one
  is a structural validation error.

**Validation rules implemented:**
- Structural pass: input must be a plain object; required fields present
  with correct primitive types; optional fields, if present, correctly
  typed (including per-item checks on `restrictions[]` and
  `preferences.*`).
- Semantic pass (after normalization/defaults): every enum field checked
  against its controlled vocabulary (`TRAINING_GOALS`, `ENVIRONMENTS`,
  `EQUIPMENT`, `EXPERIENCE_LEVELS`, `MODALITIES`,
  `RESTRICTION_SEVERITIES`, `RESTRICTION_SOURCES`); `timeAvailableMinutes`
  must be an integer in `[5, 240]`; `modalities` must be non-empty after
  dedup. Unknown values throw rather than being coerced into a known value.

**Tests and exact results:**
```
node --test src/context-engine/context-engine.test.mjs

✔ 1. minimal valid context is normalized with explicit defaults
✔ 2. full context normalizes every declared field
✔ 3. duplicate equipment is normalized to a single entry
✔ 4. duplicate modalities are normalized to a single entry
✔ 5. invalid time is rejected
✔ 6. unknown experience level is rejected
✔ 7. unknown modality is rejected
✔ 8. an active restriction is preserved in the output
✔ 9. no restriction is invented when none is declared
✔ 10. equivalent input produces deterministic output
✔ rejects structurally invalid input instead of guessing
✔ the returned context is frozen (immutable)
tests 12, pass 12, fail 0
```
`git diff --check` — no output (no whitespace errors).

**Deferred to the Compatibility Engine (not built here):**
- Interpreting `biomechanics.constraints`/`classification.joint_actions`
  (canonical, objective attributes) against a restriction's `avoidTags`/
  `region` to produce an allowed/excluded/conditional decision.
- Any notion of exercise safety/compatibility itself — this module only
  validates and normalizes the *input* to that future decision.
- Wiring `buildTrainingContext` into `app.js` or any Edge Function.
- Restriction lifecycle transitions (resolve/extend/modify at a review
  date) — this module only preserves a restriction's declared fields; the
  lifecycle itself belongs to the profile/constraint domain described in
  `docs/REENGINEERING_DECISION_FRAME.md` ("Physical constraint"), not to
  Context Engine v0.1.

**Risks:**
- None to existing behavior: no existing file was modified, and this
  module is not imported anywhere yet, so it cannot affect `app.js`, any
  Edge Function, or the legacy exercise catalog.
- The chosen equipment vocabulary (`EQUIPMENT` in `context-schema.mjs`) is
  a first pass and will likely need extending once the Compatibility
  Engine's real equipment-matching needs are known; extending an enum
  array is a low-risk, additive change.

**Pending decisions:**
- None required to close this task as implemented. Wiring this module into
  any production path, and designing the Compatibility Engine itself, are
  separate future tasks per `docs/REENGINEERING_DECISION_FRAME.md`'s
  "First implementation slice."

**Git status at completion:** all changes are new, untracked files under
`src/context-engine/` and this task file; nothing was committed or pushed.

## Closeout note

- Context Engine v0.1 implemented.
- 12/12 automated tests passing.
- No production integration yet.
- Compatibility decisions intentionally deferred to the next task.
