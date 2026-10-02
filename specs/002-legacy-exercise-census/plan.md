# Implementation Plan: Legacy Exercise Reference Census

**Branch**: `002-legacy-exercise-census` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-legacy-exercise-census/spec.md`

## Summary

Build a read-only, offline Node.js tool that (1) snapshots the full legacy
`ejercicios` table and (2) computes a deduplicated census of every legacy
`ejercicio_id` referenced anywhere with historical weight — in
`rutina_ejercicios.ejercicio_id`, `series_registradas.ejercicio_id`, and
embedded inside `rutina_ejercicios.alternativas` JSON arrays — with a
per-source reference-count breakdown. This is the "next implementation
step" `docs/LEGACY_EXERCISE_CROSSWALK.md` already defines (migration
sequence, step 2), and nothing more: no schema, no candidate matching, no
writes, no application behavior change.

## Technical Context

**Language/Version**: Node.js (ESM `.mjs`), matching the existing
`tools/sync-exercise-library.mjs` convention — same runtime already used in
this repo, no new language introduced.

**Primary Dependencies**: `@supabase/supabase-js` (v2, matching the version
already used inside the Edge Functions via Deno's `npm:@supabase/supabase-js@2`
specifier). This repository currently has no root `package.json` or npm
dependencies at all — `tools/sync-exercise-library.mjs` only reads a local
git checkout via `node:fs`/`node:child_process` and never touches the
network or the database. Adding `@supabase/supabase-js` as this repo's
first real npm dependency is a new, visible decision; see `research.md` for
why it was chosen over a raw Postgres driver or the Supabase REST API.

**Storage**: Supabase Postgres (project `ibjbbisbyygbuqemobir`), read-only.
No new tables, columns, or migrations. Tables read: `ejercicios`,
`rutina_ejercicios`, `series_registradas`.

**Testing**: `node --test`, matching the existing convention in
`supabase/functions/generate-routine/*.test.mjs` and
`src/exercise-library/*.test.mjs`. The census's core logic (deduplicating
IDs across three sources, counting references per source, parsing the
`alternativas` JSON shape) is pure/testable without a live database
connection — only the final data-fetching step touches Supabase. Per
Constitution Principle V, pure logic gets unit tests; the live-fetch step is
exercised by the quickstart's manual run against the real database, since
mocking Supabase's client for one script is not worth the complexity this
project's existing tools don't otherwise carry.

**Target Platform**: Developer/agent workstation or this project's own
cloud session — never deployed, never part of the running application.

**Project Type**: Single offline CLI tool (matches "Option 1: Single
project" / `tools/` pattern already established by
`tools/sync-exercise-library.mjs`).

**Performance Goals**: N/A — this is a one-off/occasional analysis script,
not a latency-sensitive service. Correctness and reproducibility matter;
runtime speed does not.

**Constraints**:
- Read-only: `SELECT` only, enforced by code review, not by a DB-level
  permission change (creating a restricted read-only Postgres role is out
  of scope for this feature — see Assumptions in spec.md).
- Credentials (Supabase URL + service-role key, needed to read all rows
  across all tables regardless of RLS) MUST come from environment
  variables, exactly like the Edge Functions already do
  (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) — never hardcoded, never
  committed, per `AGENTS.md`'s "never commit secrets" rule and Constitution
  Principle V.
- Output must be deterministic given the same underlying data (spec
  FR-003, SC-002): row/reference data must be byte-stable across runs;
  only a run timestamp/hash wrapper may differ.

**Scale/Scope**: ~1,464 `ejercicios` rows (expected, per
`docs/CURRENT_STATE_RECONCILIATION.md` — the actual current count is what
gets reported, not assumed); on the order of tens to low hundreds of
distinct referenced legacy IDs across `rutina_ejercicios`,
`series_registradas`, and embedded `alternativas` entries (prior, known-
incomplete estimate: ~76, undercounting the embedded-alternatives source).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

- **Principle I (Source of Truth & Branch Discipline)**: PASS. Work happens
  on dedicated branch `002-legacy-exercise-census`; `main` is untouched.
  GitHub remains the source of truth for the resulting script and its
  committed output.
- **Principle II (Human Approval Boundary, NON-NEGOTIABLE)**: PASS. This
  feature performs no merge to `main`, no production deploy, and no write
  of any kind to the production Supabase project — it only issues `SELECT`
  queries. No approval boundary is crossed by the feature itself; merging
  the resulting branch to `main` still requires explicit human approval as
  usual.
- **Principle III (Catalog and Domain Ownership Separation)**: PASS. This
  feature does not touch `Gym-Exercise-Library` or its data at all, and
  does not remove, replace, or rewrite any legacy GymApp exercise ID —
  it only reads and counts references to them. Directly advances this
  principle's stated requirement that a verified crosswalk must exist
  before legacy IDs can ever be removed/replaced.
- **Principle IV (Deterministic Safety)**: N/A — this feature does not
  touch routine generation, compatibility validation, or any
  safety-relevant code path. `generate-routine`/`regenerate-day` are
  explicitly unchanged (spec FR-008).
- **Principle V (Process Discipline)**: PASS. Starts from a clean,
  verified branch state; pure logic gets `node --test` coverage; no
  secrets are introduced into committed code (env vars only); this task
  was checked against `tasks/` and recent branches before starting (see
  chat record) to avoid duplicating in-progress work.

**Gate result: PASS, no violations to justify. Complexity Tracking section
is omitted (nothing to justify).**

## Project Structure

### Documentation (this feature)

```text
specs/002-legacy-exercise-census/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

No `contracts/` directory: this is a purely internal, offline analysis
tool with no API, UI, or other interface exposed to users or other
systems — nothing external to define a contract against.

### Source Code (repository root)

```text
tools/
└── census-legacy-exercises.mjs      # The census tool (new)
└── census-legacy-exercises.test.mjs # Unit tests for pure logic (new)

tools/generated/
└── legacy-exercise-census/
    ├── snapshot.json                 # Full ejercicios table snapshot + query + hash/timestamp
    └── census.json                   # Deduplicated ID list with per-source counts
```

**Structure Decision**: Follows the existing `tools/*.mjs` single-script
pattern (`tools/sync-exercise-library.mjs`) rather than introducing a new
top-level directory structure. Output lands under `tools/generated/` (new)
rather than inside `src/exercise-library/generated/`, because this census
is about the *legacy* catalog, not the Library's canonical one, and
keeping the two generated-output trees separate avoids implying a
relationship between them that doesn't exist yet (that relationship is
exactly what a future crosswalk feature would create).
