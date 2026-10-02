# Phase 0 Research: Legacy Exercise Reference Census

## Decision 1: How the script authenticates against Supabase

**Decision**: Use `@supabase/supabase-js` v2 (npm), authenticated via
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` read from the environment at
run time — the same two variable names the Edge Functions already use
(`supabase/functions/generate-routine/index.ts`,
`supabase/functions/regenerate-day/index.ts`). This repository has no
`package.json` yet; this feature adds one, scoped to this single
dependency.

**Rationale**:
- A census over *all* historical rows (not just one user's own, RLS-scoped
  rows) requires elevated access — the service-role key, not the anon key.
  The Edge Functions already establish the pattern of reading that key
  from an environment variable and never hardcoding or committing it; this
  tool follows the same discipline (`AGENTS.md`: "never commit secrets,"
  Constitution Principle V).
- `@supabase/supabase-js` is already the library this codebase uses to
  talk to this exact Postgres schema (inside the Edge Functions, via
  Deno's `npm:` specifier). Reusing it in Node keeps one mental model and
  one client API across the whole repo, instead of introducing a second,
  different way to query the same database.

**Alternatives considered**:
- *Raw Postgres driver (`pg`) with a direct connection string.* Rejected:
  would require managing a Postgres connection string/pooler config this
  repo doesn't otherwise handle, for no real benefit over the client
  library already in use elsewhere in the same codebase.
- *Supabase REST API via `fetch`, anon key only.* Rejected: the anon key
  is RLS-scoped to a single authenticated user's own rows. This census
  needs every row regardless of owner, which requires the service-role
  key regardless of transport — so there is no safety benefit to avoiding
  the client library, only extra hand-rolled HTTP/pagination code.
- *Interactive one-off queries (e.g. via an MCP Supabase tool), no
  committed script.* Rejected: the spec (FR-010) explicitly requires the
  census to be re-runnable later without manual, one-off query
  construction — a committed, reusable script is what the feature asks
  for, not a single interactive run.

## Decision 2: How to capture IDs embedded in `rutina_ejercicios.alternativas`

**Decision**: Fetch `alternativas` as its native `jsonb` value via
supabase-js (it arrives as a parsed JS array/object, no manual JSON
parsing needed), then iterate every array element and read its
`ejercicio_id` key in application code — not a Postgres-side `jsonb`
query/function.

**Rationale**: The spec's own edge case list requires tolerating `NULL`,
missing, or malformed `alternativas` values without erroring. Handling
this in plain JS (a `try`/guard per row) is simpler to get right and
easier to unit-test in isolation (Decision 3) than pushing the same
logic into a SQL `jsonb_array_elements` expression, and this script has no
performance requirement that would justify doing the extraction in the
database instead of in code.

**Alternatives considered**:
- *Postgres-side `jsonb_array_elements` + extraction in SQL.* Rejected:
  harder to unit-test without a live database, and the row counts here
  (~1,464 `ejercicios` rows, a comparably small `rutina_ejercicios` table)
  are far too small for this to be a meaningful performance
  consideration either way.

## Decision 3: What gets a `node --test` unit test vs. what doesn't

**Decision**: Extract the pure logic — deduplicating IDs across the three
sources, counting references per source, and safely reading
`ejercicio_id` out of a possibly-`NULL`/malformed `alternativas` entry —
into plain, exported functions that take already-fetched rows as plain
JS data and return the census structure. These functions get `node --test`
coverage with hand-built fixture rows covering every edge case from
spec.md (`NULL` alternativas, empty array, ID only in alternativas, ID in
multiple sources, malformed/missing `ejercicio_id` key inside an
alternative). The thin Supabase-fetching wrapper (the part that actually
calls `.from(...).select(...)`) is not unit-tested — it has no branching
logic of its own, matching how `tools/sync-exercise-library.mjs` does not
unit-test its own file-reading I/O layer either, only the
transformation logic downstream of it.

**Rationale**: Matches Constitution Principle V ("non-trivial changes
require tests, or an explicit written explanation of why a test is not
applicable") and this repo's existing precedent
(`src/exercise-library/*.test.mjs` tests pure transformation functions,
not the sync script's file I/O). The live database fetch is instead
verified by the quickstart's manual run against real data (`quickstart.md`),
where its row counts can be checked against a direct `SELECT COUNT(*)` as
a sanity check.

**Alternatives considered**:
- *Mock the Supabase client for a full integration-style unit test.*
  Rejected as unnecessary complexity for a single offline script with no
  other consumers — this repo's existing tools don't do this either, and
  the actual risk (a malformed `alternativas` row crashing the whole
  census) is already covered by testing the pure extraction logic
  directly.

## Decision 4: Snapshot reproducibility mechanism

**Decision**: The snapshot file records (a) the exact literal query/select
used, (b) an ISO-8601 run timestamp, and (c) a SHA-256 hash computed over
the canonicalized (stable key order) row data only — excluding the
timestamp — so two runs over unchanged data produce the same content hash
even though their timestamps differ.

**Rationale**: Directly satisfies spec FR-003 and SC-002 (identical runs
over unchanged data must be confirmably identical). Hashing only the row
data (not the wrapper timestamp) is what makes "confirmably identical"
possible to check mechanically rather than by eyeballing a diff.

**Alternatives considered**:
- *Hash the entire output file including the timestamp.* Rejected: this
  would make every run's hash different by construction, defeating the
  purpose of SC-002's reproducibility check.
