# Context Engine v0.1

Deterministic, side-effect-free domain module that normalizes and validates
the training context for a session. It is the first stage of the future
pipeline described in `docs/REENGINEERING_DECISION_FRAME.md`:

```
User/Profile + Today's Context + Active Constraints
  -> Context Engine        <- this module
  -> Compatibility Engine  <- not built yet
  -> Workout Planner
  -> LLM selection/ordering only where useful
  -> Today's Workout
```

It does **not** decide which exercises are safe or compatible. It only
produces a normalized, validated shape that a future Compatibility Engine
can consume.

## Public API

```js
import { buildTrainingContext, ContextValidationError } from './src/context-engine/index.mjs';

const context = buildTrainingContext({
  trainingGoal: 'strength',       // required — see TRAINING_GOALS
  environment: 'gym',             // required — see ENVIRONMENTS
  timeAvailableMinutes: 45,       // required — integer, 5-240
  experienceLevel: 'intermediate',// required — see EXPERIENCE_LEVELS
  modalities: ['gym', 'core'],    // required — non-empty, see MODALITIES
  equipment: ['dumbbell'],        // optional — defaults to ['bodyweight']
  restrictions: [                 // optional — defaults to []; never invented
    {
      description: 'Avoid overhead pressing on the left shoulder',
      region: 'shoulder',         // optional
      avoidTags: ['overhead_press'], // optional
      severity: 'soft',           // optional — defaults to 'hard'
      source: 'professional_guidance', // optional — defaults to 'user_declared'
    },
  ],
  preferences: {                  // optional — defaults to { dislikedEquipment: [], notes: null }
    dislikedEquipment: ['machine'],
    notes: 'prefers free weights',
  },
});
```

`buildTrainingContext` either returns a frozen, normalized object with
exactly the shape above, or throws `ContextValidationError`. The error
carries an `issues` array of `{ field, message, code }`, covering both
structurally invalid input (wrong type, missing required field) and
semantically invalid input (unknown enum value, out-of-range time).

Controlled vocabularies (`TRAINING_GOALS`, `ENVIRONMENTS`, `EQUIPMENT`,
`EXPERIENCE_LEVELS`, `MODALITIES`, `RESTRICTION_SEVERITIES`,
`RESTRICTION_SOURCES`) and range constants are re-exported from
`context-schema.mjs` via the module's index.

## Guarantees

- Deterministic: the same input always normalizes to the same output.
- No LLM calls, no network calls, no database calls.
- Unknown enum values (equipment, modality, goal, environment, level,
  restriction severity/source) are rejected, never silently coerced into a
  known value.
- A restriction is never invented; if the caller declares none, the
  normalized `restrictions` array is empty. If declared, it is preserved
  (not reinterpreted) and never assumed resolved by the passage of time —
  resolving/extending a restriction is an explicit, separate action outside
  this module's scope.

## Module layout

- `context-schema.mjs` — enums and range constants (the domain vocabulary).
- `normalize.mjs` — casing/whitespace/dedup normalization, restriction
  shape normalization, deep-freeze utility.
- `validate.mjs` — structural validation (shape/type) and semantic
  validation (enum membership, ranges), kept as two separate passes.
- `defaults.mjs` — fills optional fields only; never defaults a required
  field.
- `errors.mjs` — `ContextValidationError`.
- `index.mjs` — `buildTrainingContext(input)`, the only intended entry point.
- `context-engine.test.mjs` — `node --test` coverage.

## Integration boundary

Not wired into `app.js` or any Supabase Edge Function yet. The next task
(Compatibility Engine v0.1) is expected to take `buildTrainingContext`'s
output as its input, alongside canonical exercise attributes from
`Gym-Exercise-Library` (per `docs/EXERCISE_INTEGRATION_CONTRACT.md`) and
per-user physical constraints, to produce allowed/excluded/conditional
decisions. This module intentionally stops short of that.

## Running the tests

```
node --test src/context-engine/context-engine.test.mjs
```

No test framework dependency was introduced — Node's built-in test runner
(`node:test`) is used directly, since the repository has no existing
`package.json` or module/test convention to follow.
