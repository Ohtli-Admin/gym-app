# Implementation Plan: Close Out GA-006 (Exercise Library Provider)

**Branch**: `reengineering/gymapp-2-core` (feature tracked at `specs/001-ga006-closure/`) | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-ga006-closure/spec.md`

## Summary

GA-006 (deterministic Calistenia pipeline against the real Gym-Exercise-Library catalog) is already
implemented, tested (120/120), and committed, but stuck in REVIEW. This plan covers three concrete,
independently-completable pieces of work to move it out of REVIEW: (1) a scoped Edge Function wording fix
so `condiciones_medicas` is described consistently to the LLM across Calistenia and Fuerza/Core/Cardio,
(2) preparation of a clean integration branch from `main` that carries GA-006 forward without regressing
`main`'s already-deployed `grupos_excluidos` safety fix, and (3) the manual browser-test protocol the
product owner will run against production. This plan explicitly stops short of merging to `main` or
deploying anything — that remains gated on the product owner's explicit approval per Constitution
Principle II.

## Technical Context

**Language/Version**: Vanilla JavaScript (frontend, `app.js` + ES modules under `src/`), TypeScript/Deno
(Supabase Edge Functions)

**Primary Dependencies**: Supabase JS client, Anthropic Claude API (tool-use) from the Edge Functions,
Node.js `--test` runner for the existing test suites (no framework/bundler for the frontend)

**Storage**: Supabase Postgres (`perfiles`, `rutinas`, `rutina_ejercicios`, etc.) — no schema changes in
this feature

**Testing**: `node --test` (existing 120 tests across `compatibility-engine`, `context-engine`,
`workout-planner`, `today-experience`, `exercise-library`, plus `generate-routine`'s
`diagnostico.test.mjs`/`reintentos.test.mjs`), `node --check` for syntax validation, manual browser testing
by the product owner (no automated e2e exists)

**Target Platform**: Web (PWA), frontend on Vercel, backend on Supabase (hosted)

**Project Type**: Web application (vanilla JS frontend + Supabase backend) — single repository, no
separate frontend/backend directory split

**Performance Goals**: N/A — no performance requirement introduced by this feature

**Constraints**: No CI/CD exists (manual validation only); no code change may alter the deterministic
validation logic (`grupos_excluidos`, `validarRutina`) already live in production, only the descriptive
text around it; no merge to `main` or deploy to production may occur without explicit human approval
(Constitution Principle II)

**Scale/Scope**: Single real user (personal-use app); scope is limited to the 4 Edge Function files, the
integration-branch preparation, and a manual test protocol — no new training modality, no schema change

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (source of truth & branch discipline)**: PASS. All work happens on
  `reengineering/gymapp-2-core` and a new integration branch prepared from `main`; `main` itself is not
  touched by this plan.
- **Principle II (human approval boundary — NON-NEGOTIABLE)**: PASS by design. This plan's scope ends at
  producing a mergeable, reviewed integration branch and a documented merge/deploy recommendation. No task
  in this plan merges to `main`, deploys an Edge Function, or touches production Supabase schema/data.
- **Principle III (catalog/domain ownership)**: PASS. No change to `Gym-Exercise-Library` ownership, no
  legacy exercise ID removal/replacement.
- **Principle IV (deterministic safety — NON-NEGOTIABLE)**: PASS by design, with one gate to enforce during
  implementation: the FR-006 wording fix MUST NOT touch `validarRutina`, `validarDia`, or the
  `grupos_excluidos` schema/validation logic — only the natural-language description fed to the LLM. Any
  task that touches that validation logic is out of scope and must stop per Principle V.
- **Principle V (process discipline)**: PASS. `git status`/branch checked before this work began (done
  earlier in this session); non-trivial changes get tests (existing suite re-run) or an explicit note if a
  test is not applicable (e.g., the integration-branch preparation itself, which is validated by diffing,
  not by a new automated test).

No violations requiring justification in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-ga006-closure/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── condiciones-medicas-field-contract.md
└── tasks.md             # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
supabase/functions/
├── generate-routine/
│   ├── index.ts          # FR-006: reword condiciones_medicas tool-schema description
│   ├── diagnostico.ts     # untouched (validation logic — Principle IV gate)
│   └── reintentos.ts      # untouched (retry-feedback logic)
└── regenerate-day/
    └── index.ts           # FR-006: reword condiciones_medicas tool-schema description

tasks/review/
└── GA-006-exercise-library-provider-v0.1.md   # updated with final acceptance results

specs/001-ga006-closure/
└── (this feature's own planning artifacts)

# No frontend source changes are required by this plan — GA-006's frontend/src/exercise-library and
# src/today-experience code is already complete and is validated, not modified, here.
```

**Structure Decision**: Single repository, no new directories. Changes are confined to the two existing
Edge Function files named above (wording only) plus this feature's own `specs/` documentation and the
task file's closing update. The integration-branch preparation (FR-007) is a git operation, not a source
tree change within `reengineering/gymapp-2-core` itself — it produces a *separate* branch, documented in
`research.md` and `quickstart.md`, not new files in this branch.

## Complexity Tracking

No constitution violations to justify — table omitted.
