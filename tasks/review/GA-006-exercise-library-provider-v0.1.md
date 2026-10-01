# [GA-006] Gym Exercise Library Provider v0.1

- **Status:** REVIEW
- **Agent/Owner:** Claude Opus 5.5

## Objective

Integrate the real `Ohtli-Admin/Gym-Exercise-Library` catalog into GymApp
through an explicit sync/import boundary and a pilot-trust provider, and
replace the demo catalog in the Calistenia flow with it.

## Context

GA-005 (commit `3e29572`) closed with Calistenia running the real
Context → Compatibility → Planner pipeline over a demo catalog. The
contract in `docs/EXERCISE_INTEGRATION_CONTRACT.md` defines the ownership
boundary and field tiers this task consumes.

## Scope

- `tools/sync-exercise-library.mjs`: a local importer that writes a
  GymApp-owned snapshot and manifest.
- `src/exercise-library/`: pilot policy, adapter, modality policy, a
  single equipment boundary, the provider, tests and a README.
- Calistenia wired to the Library provider with no demo fallback.

## Out of scope

Fuerza/Core/Cardio generation, Edge Functions, Supabase schema/SQL, GA-001
SQL, legacy crosswalk execution, writes of canonical ids to
`rutina_ejercicios`/`series_registradas`, media integration, modifying the
Library, merge, deploy.

## Acceptance criteria

- [x] Sync reads the local Library export and writes a snapshot and
  manifest (source repo, commit, schema version, counts, timestamp, policy
  version).
- [x] Explicit pilot trust policy. Nothing is fabricated, and ids are kept
  exactly.
- [x] Adapter maps objective fields only.
- [x] Training type → modality policy documented. The Calisthenics fallback
  was measured as needed before it was implemented.
- [x] One equipment mapping boundary. Mappings and unmapped values are
  reported.
- [x] Calistenia uses the Library snapshot. A missing snapshot shows a
  development error, with no demo fallback.
- [x] No legacy-history writes.
- [x] Focused tests 1–10 added and all existing tests preserved.
- [ ] Manual browser acceptance by the user.

## Allowed files/areas

`tools/sync-exercise-library.mjs`, `src/exercise-library/**`,
`src/today-experience/{orchestrator,today-panel,today-view-model}.mjs`,
`src/today-experience/README.md`, `app.js` (Calistenia mount only), this
task file.

## Dependencies

GA-001 (contract), GA-003/GA-004 engines, GA-005 UX baseline.

## Required validations

Full `node --test` suite, `node --check`, `git diff --check`, and a real
sync against `../Gym-Exercise-Library`. After that, manual browser
acceptance.

## Result

**Source:** `Ohtli-Admin/Gym-Exercise-Library` @
`584b45d5b68687346ba8c1b84d1680eb914b3e0e`. The Library working tree was
clean, and `catalog.json` was last changed in `0980ec9a`. Schema `0.2`.

**Real counts (from the sync, see `generated/manifest.json`):**

| Count | Records |
|---|---|
| Total read | 876 |
| Accepted | 610 |
| Rejected | 266 (`EQUIPMENT_REQUIRED_EMPTY` × 266; no other reason) |
| Explicit `training_types: calisthenics` | 0 |
| Calisthenics candidates (GymApp policy) | 88 (75 strength + 13 plyometrics, all `bodyweight`) |
| Missing Spanish name | 876 (all; names fall back to English) |
| Missing equipment | 266 |
| Missing training types | 0 |
| `primary_image` references | 41 (32 among accepted, all 32 resolvable in the checkout) |
| Statuses | `draft` / `review_required` × 876 |

`movement_patterns`, `joint_actions` and `constraints` are empty on every
record.

**Runtime flow:** Perfil → Entrenamiento → Calistenia →
`mount({ catalogSource: 'exercise_library' })` → `loadLibraryProvider()`
(fetches `generated/*.json`) → `runLibraryOrchestration` → Context Engine →
`toLibraryEquipmentContext` → Compatibility Engine → Workout Planner →
`createSessionFromPlan` → Entrenar.

**Example (bodyweight, 45 min):** a `ready` plan with 9 exercises, each
3×12:

| # | Exercise | exercise_id |
|---|---|---|
| 1 | 3/4 Sit-Up | `src-002-903b8fd1f633976e` |
| 2 | Air Bike | `src-002-9b4ed20a4bcf6cfc` |
| 3 | Alternate Heel Touchers | `src-002-51db8f77f302399e` |
| 4 | Bench Dips | `src-002-b27a42bd11afc245` |
| 5 | Bench Jump | `src-002-fd2f6eedd9692084` |
| 6 | Bent-Knee Hip Raise | `src-002-4561d7df09343779` |
| 7 | Body Tricep Press | `src-002-1a348211846687a0` |
| 8 | Body-Up | `src-002-3f0f2b158f7462b8` |
| 9 | Bodyweight Squat | `src-002-401371ec8a478eb6` |

**Persistence:** Calistenia sessions stay local-only
(`localStorage`, `gymapp2.activeSession.v1`), as in GA-005. Canonical ids
are never written to Supabase.

**Validation:** 104/104 tests pass (93 existing plus 11 new). `node --check`
is clean. The snapshot is served by `tools/dev-server.mjs` with a JSON MIME
type, and `loadLibraryProvider()` loaded 610 exercises over HTTP. A missing
snapshot produces `LibrarySnapshotError` with the sync command. The Library
checkout was unchanged after the sync.

**Risks / limitations and pending decisions (first pass):** superseded
by the hardening pass below.

---

## Result (final product hardening)

Four fixes; the integration design is unchanged. Supabase,
Fuerza/Core/Cardio and the Library repository were not touched.

**1. Calistenia selection quality.** New `src/exercise-library/session-variety-policy.mjs`
(`ga006-variety-v1`). It runs between Compatibility Engine and Workout
Planner and only reorders candidates:
1. Candidates at or below the user's level come first, using the Library
   difficulty ranks (expert sits above advanced).
2. Candidates are grouped by their first primary muscle, else their first
   body region.
3. Groups are interleaved round-robin.
4. Groups and members are ordered by a hash seeded with `YYYY-MM-DD#n`
   (date plus press count).

Measured on the real snapshot (bodyweight, 45 min):

| | Before | After |
|---|---|---|
| Distinct sessions | 1, always identical | 14 of 14 over 14 dates |
| Groups per session | 3 | 9 of 9 |
| Core (`core_trunk`) exercises per session | 5 | 0–2 |
| Distinct exercises across 14 sessions | 9 | 48 of 88 |

The same seed is reproducible, and no expert exercise is picked while
level-appropriate ones remain. Limitation: movement patterns and joint
actions are empty upstream, so there is no push/pull/pattern split.

**2. Entrenamiento especial → independiente** now uses the same Library
path. `montarArmadorSesion` always passes `catalogSource: 'exercise_library'`,
and it is the only mount that can choose a catalog. No UI path uses the
demo catalog any more. With the current export, Core and Cardio have
**0** Library candidates: no `core_training` type exists, and every
cardio record has empty equipment. Those modalities therefore report
"No encontramos ejercicios disponibles" honestly.

**3. Profile restrictions.** The shared session builder receives
`getProfileInjuries: () => [...perfilForm.lesiones]`, read at generation
time. `profile-restriction-mapping.mjs` maps each structured chip to its
Library body region as a hard, user_declared restriction:
- Hombro → `shoulder_girdle`
- Muñeca → `forearm_hand`
- Espalda baja → `posterior_core`
- Cadera → `hip_pelvis`
- Tobillo → `lower_leg_foot`

Rodilla has no Library region: it is not approximated, and the UI shows it
as unverifiable. `condiciones_medicas` free text is never read. After each
generation the UI states which restrictions were applied, which couldn't be
verified, and that only exercises with a recorded region can be avoided.
On the real snapshot, Hombro excludes 25 of the 88 Calisthenics candidates.

**4. Snapshot committed.** `src/exercise-library/generated/{catalog,manifest}.json`
will be committed; there is no `.gitignore` entry and no runtime/deploy
access to the Library. The sync now reads the Library's committed state by
default (`git show HEAD:<path>`; `--ref` / `--working-tree` are
available). During this pass, the Library's own visual pipeline had
uncommitted changes (a new `primary_image` plus assets). They are
deliberately excluded. The snapshot is exactly commit `584b45d`, with the
same counts as before: 876 read, 610 accepted, 88 Calisthenics candidates.

**Validation:** 109/109 tests pass (104 plus 5 new: variety, level tier,
restriction mapping, restrictions end to end, Especial path). `node --check`
and `git diff --check` are clean.

**Remaining risks:**
- Some upstream equipment data is incomplete (for example, Chin-Up lists
  only `bodyweight`).
- Restrictions can't match records with empty body regions.
- Names are English only.
- Especial Core/Cardio have no Library content yet.

**Pending:** the user's manual browser acceptance, then approval to commit.

---

## Result (continuation: session persistence + physical context model)

Status remains **REVIEW**. Supabase schema, Fuerza/Core/Cardio and the
Library source data were not touched.

**P0 — disappearing sessions.**

Root cause: the generated plan existed only in a closure inside the
builder screen (`today-panel.mjs`) and in the DOM. Leaving the screen
replaced the DOM, and remounting created a fresh, empty form. Only
"Empezar" wrote to `localStorage`, and the active store also cached a
module-level copy. Separately, entering Entrenamiento especial from the hub
reset its mode, so an independent routine couldn't be reached again.

Fix:
- New `session-slots.mjs` holds prepared, active and completed sessions
  plus the seed counter. It reads storage on every access and has a memory
  fallback.
- New DOM-free `session-builder.mjs` handles generate/restore/start/warn.
- The panel restores the prepared routine instead of regenerating it.
- The hub shows "Sesión en curso" and "Rutina preparada" banners.
- `abrirEspecial()` reopens a prepared independent routine together with its
  session text.

The full lifecycle and storage keys are documented in
`src/today-experience/README.md` ("Lifecycle (GA-006)").

**P1 — physical context.**
- Persistent, user-authored: `perfiles.condiciones_medicas` (existing
  column, no schema change), relabelled in Perfil as "Lesiones, molestias o
  limitaciones que quieras que GymApp tenga en cuenta". It is saved verbatim
  only when the user saves Perfil. Generation passes it to Context Engine as
  a restriction with no `avoidTags`, and it is reported as not
  automatically evaluable.
- Legacy chips `perfiles.lesiones`: kept, relabelled "Atajos rápidos por
  zona (opcional)", and still mapped to Library regions as before.
  `generate-routine` also still reads them.
- Temporary: the Entrenamiento especial text goes to Context Engine as
  `preferences.notes` only. It is stored inside that session's own record,
  gone after the session ends, and never written to the profile or to the
  "adapt my plans" objective.
- No free text is ever parsed into anatomy or rules. The runtime context is
  rebuilt from explicit inputs on every generation and never written back.

**P2 — uncertainty wording.** "GymApp aplicó las restricciones que pudo
verificar con la información disponible del catálogo." The UI also says:
- which chips were applied, noting that some exercises involving the zone
  may not be detected;
- which chips can't be verified;
- that profile and session text can't be evaluated automatically;
- to review each exercise.

Nothing is called safe. Real example: with Hombro declared, Chin-Up can
still be selected, because the Library tags it back/lats, not
`shoulder_girdle`.

**P3 — prescriptions.** New `src/exercise-library/prescription-policy.mjs`:
- plyometrics → 3 × 6–8 reps
- isolation → 3 × 12–15 reps
- compound → 3 × 8–12 reps
- anything else → 3 series, reps left to the user

No seconds are output, because the Library doesn't mark isometric
exercises. The plan note explains how to handle hold-type exercises.

**Validation:**
- 120/120 tests pass (109 plus 11 in the new
  `src/today-experience/session-lifecycle.test.mjs`, covering items 1–10 and
  the prescription policy).
- `node --check` is clean.
- A scratch jsdom smoke run of the real `today-panel.mjs` passed 23/23
  checks: generate, remount twice, regenerate (warns, new seed, persisted),
  start, log a set, navigate, remount (progress kept), finish (summary kept
  until dismissed, active slot cleared).
- Not yet run in a real browser with Supabase login: the `app.js` hub
  banners and the Perfil relabel need the manual retest.

**Risks:**
- ~~The relabelled Perfil field is still the column the Edge Functions
  describe to the LLM as a "condición médica real". Users may now write
  milder things there, which those generators will treat conservatively.
  Their code is unchanged.~~ **Resolved** — see "Manual browser acceptance"
  below (specs/001-ga006-closure, FR-006): the Edge Function prompt text was
  updated to describe the field consistently regardless of wording.
- The prepared/active session is per browser (`localStorage`), so it doesn't
  sync across devices.
- Restriction coverage is limited by the Library metadata described above.

---

## Manual browser acceptance (2026-10-01) — DONE

Performed by the product owner directly against production Supabase, per
`specs/001-ga006-closure/spec.md` User Story 1 (FR-001–FR-005). All four
scenarios pass:

1. **Injury exclusion + restriction reporting (FR-001, FR-002)**: PASS. With
   hombro declared in Perfil, Calistenia generation explicitly stated which
   restrictions it applied and what it took into account — confirmed by the
   product owner reading the on-screen explanation directly, not inferred.
2. **Session persistence across navigation (FR-003)**: PASS. Leaving and
   returning to the screen preserves the prepared/active session; it is not
   regenerated or lost. (The "Crear sesión" button label is misleading when a
   session already exists — it resumes rather than creates — noted as a minor
   wording finding, not a functional defect, not blocking.)
3. **Variety across repeated generations (FR-004)**: PASS. Confirmed:
   "cada generación cambió ejercicios" — exercise lists differ between
   generations rather than repeating the same set.
4. **Fuerza/Core/Cardio unaffected (FR-005)**: PASS. Product owner confirmed
   the rest continues to generate correctly, unchanged from before this
   feature.

**Also explicitly confirmed during this pass**: physical restrictions
(lesiones/condiciones_medicas) are per-user profile data — read from and
written to the product owner's own `perfiles` row via the Perfil screen's
chips — never a global or hardcoded configuration applied to other users,
and never auto-expiring (requires explicit user action to add or remove),
per Constitution Principle IV. Verified by reading `app.js`'s profile
load/save code (`perfilForm.lesiones`), not merely asserted.

**Status update**: this task's only remaining blocker — manual browser
acceptance — is now satisfied. The Perfil-field cross-contamination risk
(flagged in the previous Result section) was resolved under
`specs/001-ga006-closure` (FR-006). Remaining step before this task can move
out of `tasks/review/`: explicit product-owner approval of the
merge/deploy recommendation (`specs/001-ga006-closure/tasks.md` T014–T016).
