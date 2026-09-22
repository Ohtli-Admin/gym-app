# Compatibility Engine v0.1

Deterministic, side-effect-free domain module that reduces a set of
exercises to compatible / conditional / incompatible against a normalized
`TrainingContext` (see `src/context-engine/README.md`). Second stage of the
pipeline in `docs/REENGINEERING_DECISION_FRAME.md`:

```
Context Engine -> Compatibility Engine (this module) -> Workout Planner
```

No LLM decides compatibility here. This module also does not decide *what*
counts as a medically-relevant restriction — it only matches explicit,
already-machine-readable tags the caller provides (see "Domain boundary").

## Public API

```js
import { buildTrainingContext } from './src/context-engine/index.mjs';
import {
  evaluateExerciseCompatibility,
  evaluateCatalogCompatibility,
} from './src/compatibility-engine/index.mjs';

const context = buildTrainingContext({ /* ... */ });

const result = evaluateExerciseCompatibility(context, exercise);
// { exerciseId, exercise, status: 'compatible'|'conditional'|'incompatible', reasons: [...] }

const catalog = evaluateCatalogCompatibility(context, exercises);
// { results, compatible, conditional, incompatible }
```

`evaluateCatalogCompatibility` is the intended entry point for Workout
Planner: `catalog.compatible` / `.conditional` / `.incompatible` are ready
to use directly, each an array of the same per-exercise result objects
`evaluateExerciseCompatibility` returns (including the original `exercise`
reference), so Workout Planner never has to re-run any rule itself.

`context` must be the direct output of `buildTrainingContext()` — an
invalid shape throws `CompatibilityInputError` (a caller/integration bug,
not a data-quality issue). A single malformed *exercise* inside a catalog
is never thrown for; it is reported as a normal incompatible result (see
"Rule D") so one bad row doesn't abort the rest of the batch.

## Exercise input contract (adapter)

This engine does not read Supabase or the legacy `ejercicios` table. It
consumes a small, flat, canonical-compatible shape built only from
attributes `docs/EXERCISE_INTEGRATION_CONTRACT.md` documents as available
from Gym-Exercise-Library:

| Adapter field | Source (per the integration contract) |
|---|---|
| `exerciseId` (required) | `exercise_id` (tier 1 identity) |
| `name` (optional) | `names.en` / `names.es` (tier 1; display only, unused by any rule) |
| `equipmentRequired` (optional, default `[]`) | `setup.equipment_required` (tier 2) |
| `equipmentOptional` (optional, default `[]`) | `setup.equipment_optional` (tier 2; not used by any v0.1 rule) |
| `trainingModalities` (optional, default `[]`) | GymApp's own adapter-level name for the Library's training-domain classification — see note below |
| `bodyRegions` (optional, default `[]`) | `classification.body_regions` (tier 2) |
| `primaryMuscles` (optional, default `[]`) | `classification.primary_muscles` ("Ownership boundary") |
| `jointActions` (optional, default `[]`) | `classification.joint_actions` ("Ownership boundary") |
| `movementPatterns` (optional, default `[]`) | `classification.movement_patterns` ("Ownership boundary") |
| `constraints` (optional, default `[]`) | `biomechanics.constraints` (tier 3 — the field the contract explicitly earmarks for "once the compatibility engine exists") |

**`trainingModalities` naming note:** the integration contract confirms a
`taxonomy/training-types.json` controlled vocabulary exists upstream, but
does not pin an exact `classification.*` field name for it. `trainingModalities`
is therefore GymApp's own adapter-level name, pending upstream confirmation
— the same "Confirmed vs. Proposed" distinction the contract itself uses
elsewhere. No field name here was invented for anything the contract
doesn't otherwise confirm exists.

Every array field is validated (must be an array of strings if present)
and token-normalized (trim/lowercase/separator-unified, via the same
`normalizeToken`/`normalizeTokenArray` Context Engine uses) so values like
`'Dumbbell'` and `'dumbbell'` compare equal across both engines. `exerciseId`
is only trimmed, never case-normalized — GymApp must not alter canonical
identity strings.

Fields the contract documents but this engine does not consume: `status`
(no trust-tier rule in v0.1) and every `media.*` field.

## Compatibility rules v0.1

**A. Equipment.** Every `equipmentRequired` item other than `'bodyweight'`
must be present in `context.equipment`; each missing item produces its own
`EQUIPMENT_UNAVAILABLE` reason. `'bodyweight'` (or an empty
`equipmentRequired`) never requires anything from `context.equipment` — the
explicit "no equipment" semantics Context Engine already uses.

**B. Requested modality.** `exercise.trainingModalities` must intersect
`context.modalities`; otherwise a single `MODALITY_UNSATISFIED` reason is
produced. An exercise with no modality tag at all cannot satisfy any
requested modality by the same intersection check — no special case is
needed, and no modality is ever guessed from the exercise's name.

**C. Explicit active restrictions.** Each `context.restrictions[]` entry's
own `avoidTags` is matched against the exercise's pooled objective tags
(`constraints`, `jointActions`, `movementPatterns`, `primaryMuscles`,
`bodyRegions`). A match on a `severity: 'hard'` restriction produces
`RESTRICTION_HARD_MATCH`; a match on `severity: 'soft'` produces
`RESTRICTION_SOFT_MATCH`. `restriction.region` is never used for matching —
a region name alone doesn't say which movements to avoid, and inferring
that would be exactly the kind of medical inference this engine must not
perform.

**D. Malformed/insufficient exercise input.** Structurally invalid input
(missing `exerciseId`, wrong-typed fields, not an object) is never silently
treated as compatible: it always evaluates to `status: 'incompatible'` with
a single `EXERCISE_CONTRACT_INVALID` reason carrying the structural issues.
This is a deliberate, documented choice — not a thrown exception — so
`evaluateCatalogCompatibility` can process the rest of a catalog even when
one record is bad.

## Precedence

All applicable rules run for every exercise; reasons are never dropped
after the first match (`evaluateExerciseCompatibility` always collects
every rule's output before deciding a status). The final status collapses
the collected reasons with fixed precedence:

1. Any reason in `INCOMPATIBLE_REASON_CODES` (`EXERCISE_CONTRACT_INVALID`,
   `EQUIPMENT_UNAVAILABLE`, `MODALITY_UNSATISFIED`, `RESTRICTION_HARD_MATCH`)
   → `status: 'incompatible'`, regardless of any conditional match also
   present.
2. Else, any reason in `CONDITIONAL_REASON_CODES` (`RESTRICTION_SOFT_MATCH`)
   → `status: 'conditional'`.
3. Else → `status: 'compatible'`, `reasons: []`.

## Reason codes

`REASON_CODES` (re-exported from `index.mjs`):
`EXERCISE_CONTRACT_INVALID`, `EQUIPMENT_UNAVAILABLE`,
`MODALITY_UNSATISFIED`, `RESTRICTION_HARD_MATCH`, `RESTRICTION_SOFT_MATCH`.
Each reason is `{ code, message, detail }`; `detail` carries the specific
equipment item, the requested/exercise modality sets, or the matched
restriction id + tags, depending on the code.

## No side effects

No Supabase, network, LLM, or UI calls; no `app.js` or Edge Function
integration. `context` and the caller's `exercise` objects are never
mutated — only the engine's own result object and its `reasons` array are
frozen. Same input always produces the same output.

## Module layout

- `compatibility-schema.mjs` — statuses, reason codes, precedence sets,
  exercise-adapter field lists.
- `exercise-adapter.mjs` — `validateExerciseStructure`, `normalizeExercise`,
  `extractExerciseId` (the exercise input contract).
- `rules.mjs` — `evaluateEquipmentRule`, `evaluateModalityRule`,
  `evaluateRestrictionsRule` (rules A–C).
- `errors.mjs` — `CompatibilityInputError`.
- `index.mjs` — `evaluateExerciseCompatibility`, `evaluateCatalogCompatibility`
  (the only intended entry points), precedence resolution, freezing.
- `compatibility-engine.test.mjs` — `node --test` coverage.

## Integration boundary for Workout Planner

Not wired into `app.js` or any Edge Function. Workout Planner is expected
to call `evaluateCatalogCompatibility(context, exercises)` and build a
session from `.compatible` (and, at its own discretion, `.conditional`)
results — it should not need to re-implement equipment/modality/restriction
matching. What Workout Planner still owns and this engine does not do:
choosing/ordering exercises into a session, substitutions, and any UI
presentation of `reasons` to the user.

## Intentionally deferred (not in v0.1)

- Any rule based on `equipmentOptional` (e.g. a "conditional if only
  optional equipment is missing" outcome).
- Any rule based on exercise `status` (draft/review_required/approved/
  deprecated) — no trust-tier filtering is implemented yet.
- Using `restriction.region` for matching, or any inference from a
  restriction's region/description to exercise attributes — only explicit
  `avoidTags` participate.
- Media/provenance fields — irrelevant to compatibility.
- Workout Planner itself: exercise selection, ordering, substitutions.

## Running the tests

```
node --test src/context-engine/context-engine.test.mjs
node --test src/compatibility-engine/compatibility-engine.test.mjs
```
