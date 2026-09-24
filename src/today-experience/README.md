# Today Experience v0.3 (GA-005, product-model pass)

**Product-model update:** GymApp 2.0 is five separate training products
(Fuerza/Gimnasio, Cardio, Core/Abdomen, Calistenia, Rehabilitación) sharing
one profile/context, not one merged routine. Global nav is now **Inicio /
Planes / Historial / Perfil** (down from the prior Hoy/Entrenar/Progreso/
Perfil/Más). "Planes" is the product hub (`renderPlanes()` in `app.js`);
"Inicio" (`renderInicio()`) aggregates whatever each product already has
scheduled today via a **Today Coordinator**
(`today-coordinator.mjs` + `legacy-adapter.mjs`, both pure/tested) and can
launch one combined active-workout session across products, reusing the
exact session engine below unchanged. See "Product model" further down for
the full architecture; the rest of this document (orchestration,
compatibility, active workout, persistence) describes the underlying
engine, which did not change.

The primary GymApp 2.0 product surface: **Hoy** (plan a session) and
**Entrenar** (run it), covering the full gym-tomorrow journey —

```
login -> Hoy (generate) -> review plan -> Empezar entrenamiento
      -> Entrenar (log sets, advance) -> Finalizar -> resumen -> Hoy
```

— built entirely on the real deterministic pipeline:

```
Context Engine -> Compatibility Engine -> Workout Planner
```

This module is an **integration/orchestration + session-state layer only**.
It contains no compatibility/planning rules of its own — those are made by
`src/context-engine`, `src/compatibility-engine`, and `src/workout-planner`
exactly as those modules already implement and test them. Active-workout
progress (current exercise, logged sets, completion) is this module's own
state, deliberately kept local-only — see "Active workout / session state"
below for why.

## How it's reached

As of the GA-005 UX reorganization pass, GymApp's global nav (`app.js`'s
`renderNav()`) is exactly **Perfil / Entrenamiento / Historial**, with
Perfil as the default post-login screen. There is one obvious place per
action:

- **Perfil** (`renderPerfil()`): the persistent context GymApp uses:
  basic data and level, goals, availability (days, equipment), and
  restrictions (injuries, medical conditions, machine preference). This is
  the only place that context is edited. It has no generation actions.
- **Entrenamiento** (`renderEntrenamiento()`): the hub of every training
  product (see "Product model" below). Every create, regenerate or
  change-days action goes through `abrirGeneracionPlan()` ->
  `abrirModalGeneracion()` -> `invocarGeneracion()`.
- **Historial** (`renderHistorial()`): completed activity, plus the entry
  to log extra activity (`renderExtra()`).

1. `index.html` loads `app.js` (classic script) and, separately,
   `src/today-experience/browser-entry.mjs` as a native ES module.
2. `app.js` owns routing and legacy Supabase-backed screens; this
   directory provides the on-demand session builder (`mount`, screen
   `'home'`), the active-workout screen (`mount`, screen `'active'`), and
   the pure helpers bridged on `window.GymAppTodayExperience`
   (`special-training.mjs`, `today-intent.mjs`, the legacy adapters and
   Today Coordinator).

Removed destinations: Inicio, Planes, Más, "Ajustar contexto de hoy",
Generador, and the Rehabilitación placeholder. An unknown or old screen
name falls back to Perfil.

## Module layout

- `today-view-model.mjs` — pure translation layer. UI vocabulary (built
  from the real Context Engine enums, never a hand-maintained duplicate),
  `buildContextInputFromUi` (UI state -> `buildTrainingContext()` input),
  and `buildTodayViewModel`/`buildPlanViewModel`/`buildErrorViewModel`
  (domain result -> rendering-friendly view model, with every reason/
  warning code translated to a short non-technical sentence). No DOM code;
  fully unit-testable.
- `demo-catalog-provider.mjs` — the demo/in-memory exercise catalog for
  this slice (see "Demo catalog / provider boundary" below).
- `orchestrator.mjs` — `runTodayOrchestration(uiState, { catalogProvider })`:
  calls `buildTrainingContext()` -> catalog provider -> 
  `evaluateCatalogCompatibility()` -> `buildWorkoutPlan()` in sequence and
  classifies any thrown error as `'validation'` (bad Today input) or
  `'integration'` (a wiring bug) — see "Result experience" below. No DOM
  code; fully unit-testable.
- `workout-session.mjs` — pure active-workout state machine
  (`createSessionFromPlan`, `logSet`, `completeExercise`, `goToExercise`,
  `finishSession`, `buildSessionSummary`) plus a small shared, local-only
  session store (`getActiveSession`/`setActiveSession`/`clearActiveSession`,
  module-level cache backed by best-effort `localStorage`). No DOM code;
  fully unit-testable. See "Active workout / session state" below.
- `today-panel.mjs` — the **only** file here that touches `document`.
  Renders all four screens (planning form, generated-plan preview, active
  workout, completion summary) via `runTodayOrchestration` +
  `buildTodayViewModel`/`buildActiveSessionViewModel`/
  `buildSessionSummaryViewModel`. Never reimplements a rule from any
  engine or the session state machine.
- `browser-entry.mjs` — the one bridge that exposes `today-panel.mjs`'s
  `mount()` on `window` for `app.js` (a classic script) to call.
- `legacy-adapter.mjs` — pure functions (`adaptFuerzaDay`, `adaptAbdomenDay`,
  `adaptCardioDay`) that reshape an already-loaded legacy Fuerza/Abdomen/
  Cardio "today" day (as app.js already has it from
  `cargarRutina`/`cargarRutinaAbdomen`/`cargarRutinaCardio`) into the same
  session-item shape a Workout Planner plan produces. No Supabase calls of
  its own, no generation/compatibility logic — pure reshaping.
- `today-coordinator.mjs` — `buildTodayOverview(components)`, the Today
  Coordinator: aggregates each product's items (already adapted) into a
  per-product summary and one combined item list, for Inicio's "Empezar
  entrenamiento" (all products) action.
- `today-panel.mjs` — the **only** file here that touches `document`.
  Renders all four screens (planning form — generic or locked to one
  product's modality, generated-plan preview, active workout, completion
  summary) via `runTodayOrchestration` +
  `buildTodayViewModel`/`buildActiveSessionViewModel`/
  `buildSessionSummaryViewModel`. Never reimplements a rule from any
  engine or the session state machine.
- `browser-entry.mjs` — the one bridge that exposes `today-panel.mjs`'s
  `mount()`, the legacy adapters, `buildTodayOverview`, and
  `startSessionFromItems` on `window` for `app.js` (a classic script) to
  call. No logic of its own — every function here is a direct re-export/
  thin wrapper of something defined and tested elsewhere in this directory.
- `today-experience.test.mjs` — `node --test` coverage for the pure
  orchestration/view-model logic (9 tests).
- `workout-session.test.mjs` — pure session state machine + store (6 tests).
- `legacy-adapter.test.mjs` — pure adapter shape/mapping (4 tests).
- `today-coordinator.test.mjs` — pure aggregation logic (2 tests).

DOM rendering itself is exercised manually — see the task file's "Manual
verification" section.

## Product model

Every training product lives inside **Entrenamiento** and follows the same
pattern. With an active plan, the hub card's single action is **Ver
plan**. The product screen then shows the plan, with the secondary actions
("Regenerar plan o cambiar días", "Regenerar solo este día") behind
**Ajustar plan**. Without a plan, the only action is **Crear plan**, which
opens a modal that asks only for days. Everything else comes from Perfil,
and weekly plan generation never asks for session duration.

| Product | Plan/generation | Reached via |
|---|---|---|
| Fuerza / Gimnasio | Legacy `generate-routine` / `regenerate-day` | Entrenamiento -> `rutina` |
| Cardio | Legacy `generate-cardio-plan` / `regenerate-cardio-day` | Entrenamiento -> `cardio` |
| Core / Abdomen | Legacy `generate-routine {tipo:'abdominales'}` / `regenerate-day` | Entrenamiento -> `abdomen` |
| Calistenia | On-demand session only (new engine, locked to `calisthenics`); **no persisted plan yet**, and the UI says so | Entrenamiento -> `calistenia` |
| Entrenamiento especial | See below | Entrenamiento -> `especial` |

Fuerza and Core share `perfiles.dias_disponibles` because `generate-routine`
reads the day count from the profile for both. The creation modal says so
explicitly.

**Entrenamiento especial** (`special-training.mjs` + `app.js`'s
`renderEspecial()`): the user writes "¿Qué quieres preparar o resolver?"
and then explicitly chooses one of two modes. The mode is never inferred
from the text.

- *Crear un entrenamiento independiente*: opens the on-demand session
  builder (time, place and modalities for that one session). Nothing is
  persisted, and the text is not interpreted automatically yet.
- *Adaptar mis planes actuales*: stores the objective in this browser
  until the user removes it. Saving it regenerates nothing. It is sent as
  labeled intent (`intencion_hoy`) only when the user generates or
  regenerates a product listed in `productsUsingObjective()` (today:
  Fuerza and Core, via `generate-routine`). Cardio's generator does not
  accept a request body yet, and the UI says so.

Neither mode is a diagnosis or a safety input. Persistent restrictions
stay in Perfil.

**Rehabilitación** is intentionally not a product. GymApp has no
rehabilitation plan engine (`docs/REENGINEERING_DECISION_FRAME.md` treats
it as a future domain concept). Until one exists, adaptation is expressed
through Perfil restrictions and Entrenamiento especial, and the result is
never labeled as a rehabilitation protocol.

The Today Coordinator (`today-coordinator.mjs`, `buildTodayOverview`) and
`today-intent.mjs` remain tested and bridged, but no screen uses them after
this pass. They are kept for the future day-specific override ("hoy solo
tengo 35 minutos"), which should adapt only that day's session, never the
weekly plan.

## Today input fields

| Field | Control | Default | Context Engine field |
|---|---|---|---|
| Time available | chips: 20 / 45 / 60 / 90 min | 45 | `timeAvailableMinutes` |
| Environment | chips (Context Engine's `ENVIRONMENTS`, friendly labels) | `gym` | `environment` |
| Modalities | multi-select chips (Context Engine's `MODALITIES`, friendly labels) | `['gym']` | `modalities` |
| Experience level | chips (Context Engine's `EXPERIENCE_LEVELS`, friendly labels) | `intermediate` | `experienceLevel` |
| Equipment available | multi-select chips (Context Engine's `EQUIPMENT`, friendly labels) | `['bodyweight']` | `equipment` |
| DEMO shoulder restriction | toggle, explicitly labeled DEMO | off | `restrictions` (see below) |
| Allow conditional exercises | toggle | off | `buildWorkoutPlan`'s `options.allowConditional` |

**`trainingGoal` (required by Context Engine, not exposed as a control):**
the legacy app's `perfiles.metas` is a different vocabulary (Spanish
strings like "Hipertrofia") that doesn't map onto Context Engine's enum
without adding scope this slice doesn't need yet. `TODAY_DEFAULT_TRAINING_GOAL`
(`today-view-model.mjs`) is fixed to `'general_fitness'` — an explicit,
visible, documented temporary default (shown as fixed text in the panel),
not a silent guess. No current Compatibility/Planner rule reads
`trainingGoal` yet, so this has no effect on the generated plan today.

**Restrictions:** the legacy `perfiles.lesiones` field (e.g. `"Hombro"`) is
a body-region label, not a machine-readable avoidance tag — turning it into
`avoidTags: ['overhead_press']` would require inferring which movements
involve that region, which is exactly the kind of inference `AGENTS.md`
and the Compatibility Engine's own domain boundary forbid. This slice does
**not** attempt that adaptation and defaults to **zero** active
restrictions. The architecture already supports supplying real
restrictions to Context Engine (`buildContextInputFromUi` builds a
`restrictions` array); a future task can wire in a real, explicit,
user-authored restriction record once one exists, without changing this
layer's shape.

**DEMO restriction toggle:** `DEMO_SHOULDER_RESTRICTION`
(`today-view-model.mjs`) is one hardcoded, developer-authored restriction
object (`avoidTags: ['overhead_press']`, `severity: 'soft'`) — never
inferred from free text at runtime, never read from or written to any real
user profile data, and only included when the user explicitly flips the
toggle labeled "DEMO" in the UI. It exists solely to demonstrate the
conditional-exercise pathway end to end.

## Orchestration path (proof it uses the real three engines)

`orchestrator.mjs`'s `runTodayOrchestration` does nothing but:

```js
context = buildTrainingContext(buildContextInputFromUi(uiState));      // src/context-engine
exercises = catalogProvider();                                          // demo-catalog-provider.mjs (or a future real one)
compatibilityResult = evaluateCatalogCompatibility(context, exercises); // src/compatibility-engine
plan = buildWorkoutPlan(context, compatibilityResult, { allowConditional }); // src/workout-planner
```

`today-experience.test.mjs` tests 2 and 8 assert that
`runTodayOrchestration`'s output is *identical* (`deepEqual`) to calling
`buildTrainingContext`/`evaluateCatalogCompatibility` directly with
equivalent input — proof this layer does not duplicate or diverge from the
engines' own logic.

## Demo catalog / provider boundary

```
catalog provider           (demo-catalog-provider.mjs today; a real
      |                     Gym-Exercise-Library-backed provider later)
      v
canonical-compatible exercise records   (src/compatibility-engine's
      |                                  exercise-adapter contract)
      v
Compatibility Engine
      v
Workout Planner
```

`demo-catalog-provider.mjs` exports one function, `getDemoExerciseCatalog()
-> exercise[]`, returning ~12 hand-authored records shaped exactly to
`src/compatibility-engine/exercise-adapter.mjs`'s contract (the same shape
`src/workout-planner/examples/vertical-slice-example.mjs` uses for its own,
separate, Node-only fixture). `orchestrator.mjs` depends only on "a
function that returns canonical-compatible exercise records" — it imports
`getDemoExerciseCatalog` only as its *default*, and accepts any
`catalogProvider` via its options parameter (used by several tests to
swap in a smaller fixture catalog).

**Future replacement seam:** a real `Gym-Exercise-Library`-backed provider
(per `docs/EXERCISE_INTEGRATION_CONTRACT.md`, once GA-001's HARD-001..005
and the legacy crosswalk are resolved) replaces `demo-catalog-provider.mjs`
by exporting a function with the same shape — `() -> exercise[]`, or a
`Promise` of one once real fetching is involved. Nothing in
`orchestrator.mjs`, `today-panel.mjs`, or any engine needs to change; only
the `catalogProvider` passed to `runTodayOrchestration` (or its default)
changes.

## Browser portability

The three domain engines are consumed as native ES modules, unmodified —
no bundler, no transpilation. The only portability issue found:
`src/workout-planner/plan-id.mjs` used Node's `node:crypto` for its
SHA-256 plan-id hash, which does not resolve in a browser. It was replaced
with a small pure-JS FNV-1a-based fingerprint (same function signature,
same determinism guarantee, no import at all) — see that file's own
comment and `plan-id.test.mjs`. No other Node-only API was found anywhere
in the browser-reachable import graph (`today-experience.test.mjs` test 9
asserts this for every file in that graph, by source inspection).

## Active workout / session state

Tapping **"Empezar entrenamiento"** calls `createSessionFromPlan(plan)`
(raw plan data — exercise id/name/modality/status/reasons/prescription —
not the display view model) and stores it via `setActiveSession`, then
asks `app.js` to navigate to **Entrenar**. The active-session screen reads
the same shared store on every mount, so the in-progress workout survives
navigating to Progreso/Perfil and back, and a page reload (best-effort,
via `localStorage`).

**Logging:** a `sets_reps` exercise shows a reps/weight input row and a
"Marcar serie" button (each tap appends one numbered set); a `duration`
exercise (cardio/some core prescriptions) shows a single "Marcar como
completado" button instead — there is no reps/weight to log for a
duration-based prescription. `Anterior`/`Siguiente`/tapping any exercise in
the mini-list navigates via `goToExercise`; `Completar ejercicio` marks the
current one done independent of set-logging (a user may consider an
exercise "done" without having logged every set). `Finalizar entrenamiento`
calls `finishSession` and immediately shows the summary screen.

**PERSISTENCE DECISION — local-only, not a shortcut:** logged
sets/exercise-completion are **not** written to Supabase's
`rutinas`/`rutina_ejercicios`/`series_registradas` tables. The demo
catalog's exercise ids (e.g. `demo-dumbbell-goblet-squat`) are neither
legacy `ejercicios` rows nor canonical Gym-Exercise-Library ids — writing
them into those tables would invent exercise identity outside the
approved catalog (`AGENTS.md`) and risk corrupting real historical rows.
A local-only session, under its own namespaced `localStorage` key
(`gymapp2.activeSession.v1`), guarded by try/catch everywhere it touches
storage, is therefore the *correct* choice until a real catalog provider
supplies real, storable exercise identity — not merely the fastest one
tonight. See `workout-session.mjs`'s own header comment.

## Result experience

- **`ready`** — status banner styled as success (green), the ordered
  exercise list, per-exercise prescription/duration, modalities covered,
  and an "Empezar entrenamiento" CTA.
- **`partial`** — status banner styled as a warning (amber); any
  conditional exercise is marked "Con precaución" with its reason
  translated to plain language (never the raw `RESTRICTION_SOFT_MATCH`
  code); any `MODALITY_NOT_COVERED`/`CONDITIONAL_EXERCISES_INCLUDED`
  warning is shown as a translated sentence.
- **`unavailable`** — status banner styled as danger (red) plus an empty
  state ("No hay ejercicios en el plan.") and no start CTA.
- **validation/integration error** — a `PlannerInputError`/
  `CompatibilityInputError`/`ContextValidationError` never reaches the UI
  as raw text; `buildErrorViewModel` maps it to one of two short,
  non-technical messages ("Revisa los datos de hoy" for bad Today input,
  "Algo salió mal generando tu rutina" for an integration bug), while the
  real error message is only ever sent to `console.error` for developers.
- **Entrenar with no active session** — an explicit empty state ("No
  tienes un entrenamiento en curso") with a CTA back to Hoy, never a blank
  or broken screen.
- **Completion summary** — exercises completed / total, total sets logged,
  elapsed minutes (from `startedAt`/`finishedAt`), and a "Volver a Hoy"
  action that clears the session and returns to the planning form.

## Intentionally deferred

- Reusing/mapping the real logged-in user's profile (`perfiles.metas`,
  `lesiones`) into `trainingGoal`/`restrictions` — see "Today input
  fields" above for why this slice doesn't attempt it yet.
- A real `Gym-Exercise-Library`-backed catalog provider.
- Writing completed sets/sessions to Supabase — see "Active workout /
  session state" above for why a local-only session is the correct choice
  for the demo catalog, not just a shortcut.
- A full redesign of every legacy screen (Generador/Rutina
  clásica/Abdomen/Cardio/Extra/Historial/Registro) — they are reachable,
  fully functional, and visually unchanged behind **Más** / **Progreso** /
  **Perfil**.
- Rest-timer, warm-up/cool-down structuring, and any training-science
  beyond what Workout Planner already produces.
