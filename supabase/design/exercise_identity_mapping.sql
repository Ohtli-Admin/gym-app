-- ============================================================================
-- NOT PRODUCTION READY — DO NOT EXECUTE. DESIGN ONLY — DO NOT APPLY TO ANY
-- DATABASE (staging or production).
--
-- GA-001 is closed as the GymApp reengineering DESIGN BASELINE (revision 6
-- below), not as production-ready executable SQL. The final independent
-- review's outstanding findings are recorded as binding implementation
-- hardening requirements, HARD-001 through HARD-005, none of which are fixed
-- in this file:
--   HARD-001 (BLOCKER before execution) — enforce GEC-1 JSON types and
--     canonical exercise_id syntax (not just presence/equality).
--   HARD-002 (BLOCKER before execution) — cryptographically bind stored raw
--     export/taxonomy payloads, declared hashes, normalized records,
--     taxonomy identity, and record counts into one verifiable chain.
--   HARD-003 (before canonical_exercise_current is relied upon) —
--     canonical_exercise_current must order by server-controlled completion
--     chronology (completed_at), not caller-influenced imported_at.
--   HARD-004 (implementation hardening) — legacy_exercise_evaluation must
--     carry and cross-check its own gec_contract_version against the
--     evaluated snapshot.
--   HARD-005 (implementation hardening) — reconcile/enforce confidence
--     semantics for unmatched/ambiguous evaluations and candidates, not just
--     matched.
-- See "Revision 7" in the Result section of
-- tasks/done/GA-001-exercise-integration-contract.md for the full, binding
-- list and closure statement. This file is NOT cleared to run against
-- Supabase or any other database until HARD-001/HARD-002 are resolved.
--
-- This file is a proposed, non-production schema design produced by task
-- GA-001 (docs/EXERCISE_INTEGRATION_CONTRACT.md, docs/LEGACY_EXERCISE_CROSSWALK.md).
--
-- Revision 6 responds to an independent adversarial review that ran 22
-- regression scenarios (S1-S12, C1-C10) against revision 5 and found: 21/22
-- PASS, C9 FAIL, plus 2 additional BLOCKER-severity defects, 1 additional
-- MAJOR, 2 MINOR, and a documentation-consistency defect that revision 5's
-- own text introduced. All were fixed here, not only the blockers:
--   1. (BLOCKER) `payload ->> 'x' = column` CHECK constraints on
--      canonical_exercise_import were satisfiable by a payload MISSING the
--      key (e.g. payload='{}') because `null = column` evaluates to NULL,
--      and PostgreSQL treats a NULL-valued CHECK as satisfied. Fixed with
--      explicit `is not null` guards, plus a new trigger
--      (validate_canonical_exercise_import_payload()) enforcing the other
--      two Tier-1 contract fields that cannot be a same-row CHECK
--      (payload.schema_version matching the snapshot's library_schema_version,
--      payload.names.en present/non-blank).
--   2. (BLOCKER) Snapshot-children mutation vs. snapshot finalization had no
--      locking, only MVCC visibility — a concurrent DELETE on a child row and
--      a concurrent finalize() could each proceed against a stale view of the
--      other, producing a "complete" snapshot whose declared record_count
--      silently disagreed with its actual children. Fixed by having
--      forbid_mutation_of_completed_snapshot_children() take `FOR UPDATE` on
--      the parent snapshot header before reading its status, matching the
--      lock finalize_canonical_import_snapshot() already takes. See "R1-R4
--      locking analysis" near the end of this file.
--   3. (BLOCKER) The identical race existed between
--      legacy_exercise_evaluation_candidate mutation and evaluation
--      finalization. Fixed the same way, in
--      forbid_mutation_of_finalized_evaluation_children().
--   4. (the review's "C9") `evaluated_by=''` / `notes=''` passed the evidence-
--      required CHECK, because it only tested `IS NOT NULL`. Fixed with
--      `btrim(...) <> ''`.
--   5. (MAJOR) `finalized_at`/`completed_at` used
--      `coalesce(new.x, now())`, which RESPECTS a caller-supplied value
--      whenever one is given. Fixed to unconditionally overwrite with
--      `clock_timestamp()` at both the evaluation draft->final and the
--      snapshot building->complete transitions — the client can never
--      control or later see its own supplied value take effect.
--   6. (MINOR) `ambiguous` finalization required only >= 1 candidate, but
--      this document's own definition of ambiguous is "more than one
--      plausible candidate." Fixed to require >= 2.
--   7. (MINOR) `legacy_exercise_crosswalk_status` collapsed "never
--      evaluated" and "a draft evaluation exists but hasn't finalized yet"
--      into the same `legacy_only` label. Fixed by distinguishing
--      `legacy_only` / `draft_in_progress` / a finalized outcome, plus an
--      unconditional `has_draft_evaluation` column.
--   8. (documentation consistency) A comment above
--      require_complete_snapshot_for_crosswalk() incorrectly claimed
--      legacy_exercise_evaluation_candidate has a direct trigger calling it;
--      it does not — its protection is indirect, via the composite FK onto
--      its already-gated parent evaluation row. Comment corrected; both
--      companion documents re-checked line-by-line against this file for any
--      other drift (none else found).
-- Revision 5 (preserved below, unchanged in substance) was itself a
-- structural refactor, not a local patch: (1) closed a gap where
-- canonical_import_snapshot could be INSERTed directly with
-- status='complete', bypassing every completion check (the completion
-- validation trigger previously fired on UPDATE only); (2) replaced the
-- mutable-single-row-per-legacy-id crosswalk (legacy_exercise_crosswalk +
-- a copy-on-write audit-log table) with a genuine append-only evaluation/
-- revision ledger (legacy_exercise_evaluation /
-- legacy_exercise_evaluation_candidate), because the prior design let a
-- finalized `matched` decision be silently rewritten by a plain UPDATE — an
-- audit log recorded that a rewrite happened, but nothing stopped the
-- rewrite itself. See the block comment above "3. legacy_exercise_evaluation"
-- below for the full rationale. Revision 3's exercise_reference strategy
-- (section 6) remains UNCHANGED and out of scope for both revisions 5 and 6.
-- This file has NOT been reviewed for production application, has NOT been
-- tested against the real deployed schema (or any live PostgreSQL — see "R1-R4
-- locking analysis" below for why), and defines NO RLS policies or grants.
--
-- What "additive" means in this file, precisely (unchanged from revision 2,
-- with ONE explicitly flagged exception introduced in revision 3 — see
-- "Future additive columns" below, which is not purely additive and says so):
--   - it creates new tables and, in one clearly separated section near the
--     bottom, proposes (but does not apply) new columns/constraints on
--     existing tables for a *future* task, once the Compatibility Engine
--     exists;
--   - it does not ALTER, DROP, or rewrite any EXISTING column or row on
--     public.ejercicios, public.rutina_ejercicios, public.series_registradas,
--     or public.ejercicio_imagenes in the part of this file that is not
--     explicitly marked as a future proposal;
--   - every table this file actually creates can be dropped without any
--     effect on existing legacy data, because nothing outside this file
--     references these tables yet;
--   - "additive" does NOT mean "free of side effects." `create extension`
--     is a database-global object, not scoped to this file's new tables,
--     and typically requires elevated privileges (superuser or the
--     extension-owner role) that an ordinary application role may not
--     hold — see the note above that statement below.
--
-- Applying this requires explicit human approval per AGENTS.md. No agent may
-- run this against the deployed GYM-APP Supabase project.
-- ============================================================================

-- `public.ejercicios`, `public.rutina_ejercicios` and `public.series_registradas`
-- all define `id`/`*_id` as `text` (supabase/baseline/schema_snapshot.sql).
-- That snapshot file explicitly does NOT capture PRIMARY KEY, UNIQUE, FOREIGN
-- KEY, or index definitions (see its own trailing comment: "Constraints,
-- foreign keys, RLS policies and indexes are documented in
-- docs/CURRENT_STATE_RECONCILIATION.md and must be converted into an ordered
-- migration only after dependency/order review"). docs/CURRENT_STATE_RECONCILIATION.md
-- states in prose that production foreign keys already "point to ejercicios",
-- which implies ejercicios.id already carries a PK/UNIQUE constraint in the
-- live database — but that claim comes from Supabase's own introspection
-- report, not from a structural artifact this task could diff against.
-- CONSEQUENCE: the `references public.ejercicios (id)` foreign keys below are
-- a design assumption consistent with that prose claim, NOT a fact verified
-- against a captured schema artifact. Before this file is ever applied, an
-- operator must independently confirm (e.g. via `\d ejercicios` or
-- `information_schema.table_constraints`) that `ejercicios.id` actually has a
-- PRIMARY KEY or UNIQUE constraint — Postgres will refuse to create these
-- foreign keys otherwise, which is the correct failure mode, not a silent one.

-- pgcrypto is already declared in supabase/baseline/schema_snapshot.sql, so
-- this statement is expected to be a no-op against the real target database.
-- It is listed here only so this file is self-contained if ever tested
-- against a fresh/empty database. It is NOT purely "additive" in the sense
-- of "new, isolated, no side effects": CREATE EXTENSION is a database-global
-- operation that can require superuser or extension-owner privileges an
-- application role does not hold, and DROP EXTENSION would affect every
-- consumer of pgcrypto in the database, not just the tables in this file.
-- Revision 3 also relies on pgcrypto's `digest()` function (used below for
-- reproducible content hashing), not just `gen_random_uuid()`.
create extension if not exists pgcrypto;

-- ============================================================================
-- 1. canonical_import_snapshot
--
-- Immutable, content-addressed header row for ONE pinned Gym-Exercise-Library
-- import. Revision 3 redesign, addressing the second review's "snapshot must
-- represent identity of CONTENT, not just an import attempt":
--
--   - identity/idempotency is now REPRODUCIBLE FOR THE SAME CONTENT: the
--     `content_fingerprint` column is a Postgres GENERATED column computed
--     from `raw_export_sha256` and `taxonomy_fingerprint` (both mandatory),
--     with a UNIQUE constraint on it. Two import attempts of byte-identical
--     content (same raw export + same taxonomy files) always compute the
--     SAME `content_fingerprint` and therefore collide on the same row —
--     the importer must look up-or-insert by `content_fingerprint`
--     (`INSERT ... ON CONFLICT (content_fingerprint) DO NOTHING` then
--     `SELECT`), not blindly insert a new header per attempt. This replaces
--     revision 2's "distinguished by (source_commit, imported_at), not
--     deduplicated" — that was attempt-identity, not content-identity, which
--     is exactly what the review flagged as wrong.
--   - `raw_export_sha256` is now NOT NULL (was optional in revision 2) —
--     hashing the raw artifact is mandatory, not best-effort.
--   - `status` gives the snapshot an explicit lifecycle
--     (`building` → `complete`, or `failed`). Only a `complete` snapshot may
--     ever be referenced by the crosswalk (enforced by trigger, see
--     `require_complete_snapshot_for_crosswalk()` below) — a `building`
--     snapshot is, by construction, not yet known to be internally
--     consistent (record_count and taxonomy content are only verified at
--     the `finalize_canonical_import_snapshot()` gate).
--   - once `status = 'complete'`, the header row (and, separately, every
--     `canonical_exercise_import` row under it) becomes immutable — see the
--     triggers below.
--
-- A re-import that intentionally changes content (a new Library commit, or
-- the same commit with different taxonomy content — e.g. a dirty working
-- tree) naturally produces a different `content_fingerprint` and therefore a
-- new row, which is still correct: that is genuinely different content, not
-- a repeated attempt at the same content.
--
-- Open question this design does NOT resolve (documented, not fabricated):
-- if a future contract revision (e.g. `GEC-2`) needs to reinterpret
-- already-imported raw content differently, that is a new *interpretation*
-- of existing content, not new content — this design intentionally does not
-- mint a second snapshot row for that case. Left for whoever defines the
-- next `GEC-*` revision.
--
-- Required idempotent-import sequence (S12 in the adversarial review —
-- "import identical content twice" must be deterministic/coherent, not merely
-- non-erroring): the importer must (1) compute raw_export_sha256 and
-- taxonomy_fingerprint from the source content BEFORE touching the database;
-- (2) `INSERT ... ON CONFLICT (content_fingerprint) DO NOTHING` the header
-- row, then `SELECT id, status ... WHERE content_fingerprint = <computed>`
-- to obtain the (possibly pre-existing) row; (3) if the found row's
-- status = 'complete', stop — the content is already fully imported, and no
-- further INSERT into its children is even possible (the immutability
-- triggers below unconditionally reject inserting a child into a complete
-- snapshot, by design); (4) if status = 'building' (e.g. a resumed retry
-- after a crash), continue inserting any missing children idempotently
-- (`ON CONFLICT DO NOTHING` on canonical_exercise_import's
-- (snapshot_id, exercise_id) unique constraint and on
-- canonical_import_raw_taxonomy's (snapshot_id, taxonomy_name) unique
-- constraint; canonical_import_raw_artifact's primary key is snapshot_id
-- itself, so the same pattern applies) before calling
-- finalize_canonical_import_snapshot(). This is why "same content always
-- resolves to the same header row" alone is not sufficient for idempotency —
-- the importer must branch on the found row's status rather than
-- unconditionally repeating every insert.
-- ============================================================================
create table if not exists public.canonical_import_snapshot (
  id uuid not null default gen_random_uuid(),

  gec_contract_version text not null,         -- 'GEC-1', per docs/EXERCISE_INTEGRATION_CONTRACT.md
  library_schema_version text not null,       -- e.g. '0.2', the `schema_version` const observed across the payload's records

  source_commit text not null,                -- Gym-Exercise-Library git SHA the operator pinned and verified at import time
  source_commit_verified_at timestamptz not null default now(),

  -- MANDATORY hash of the raw exported artifact (e.g. the exact bytes of
  -- output/gym-exercise-library/catalog.json at source_commit), computed by
  -- the importer over the ORIGINAL FILE BYTES before any JSON parsing —
  -- see "Invariants deferred to the importer/transaction" near the bottom
  -- of this file for why Postgres cannot verify this itself.
  raw_export_sha256 text not null,

  -- Deterministic aggregate hash over every taxonomy/*.json file's own
  -- sha256, computed by the importer as
  -- sha256(string_agg(per_file_sha256, ':' order by taxonomy_name)) —
  -- the SAME formula `finalize_canonical_import_snapshot()` below
  -- recomputes from canonical_import_raw_taxonomy and checks against this
  -- value before allowing the snapshot to become `complete`.
  taxonomy_fingerprint text not null,

  -- Content-addressed identity: same (raw_export_sha256, taxonomy_fingerprint)
  -- pair always yields the same content_fingerprint, computed by Postgres
  -- itself (not trusted to importer arithmetic), and UNIQUE below. This is
  -- what makes snapshot identity reproducible for the same content instead
  -- of merely timestamped per attempt.
  content_fingerprint text generated always as (
    encode(digest(raw_export_sha256 || ':' || taxonomy_fingerprint, 'sha256'), 'hex')
  ) stored,

  record_count integer not null,              -- number of exercise records this snapshot's payload declares; validated against actual canonical_exercise_import rows at finalize time, not merely accepted on faith
  status text not null default 'building',    -- 'building' | 'complete' | 'failed' — lifecycle; see finalize_canonical_import_snapshot()
  completed_at timestamptz,                   -- set only by finalize_canonical_import_snapshot(), when status transitions to 'complete'

  imported_by text not null,
  imported_at timestamptz not null default now(),
  notes text,

  constraint canonical_import_snapshot_pkey primary key (id),
  constraint canonical_import_snapshot_record_count_check check (record_count >= 0),
  constraint canonical_import_snapshot_status_check check (status in ('building', 'complete', 'failed')),
  constraint canonical_import_snapshot_content_fingerprint_unique unique (content_fingerprint),
  constraint canonical_import_snapshot_completed_at_check check (
    (status = 'complete' and completed_at is not null)
    or
    (status <> 'complete' and completed_at is null)
  )
);

create index if not exists canonical_import_snapshot_commit_idx
  on public.canonical_import_snapshot (source_commit);

comment on table public.canonical_import_snapshot is
  'DESIGN ONLY. Content-addressed, lifecycle-tracked header for one Gym-Exercise-Library import. Identity is (raw_export_sha256, taxonomy_fingerprint) via the generated content_fingerprint column, not attempt timestamp. Immutable once status=complete (see triggers below). An incomplete (building/failed) snapshot may never be referenced by the crosswalk.';

-- ----------------------------------------------------------------------------
-- 1a. canonical_import_raw_artifact
--
-- Second review point 2 ("un snapshot auditable debe conservar el raw
-- canonical export... o una referencia durable obligatoriamente hasheada"):
-- this table holds the actual raw exported artifact (or a durable pointer to
-- it), distinct from the header's mandatory hash and distinct from the
-- normalized per-record projection in canonical_exercise_import below.
--
-- The hash itself lives once, on canonical_import_snapshot.raw_export_sha256
-- (not duplicated here) to avoid two copies of the same hash drifting apart.
-- This table exists so GymApp never needs to re-read
-- Gym-Exercise-Library's internal files to interpret an already-imported
-- snapshot: either the exact bytes are stored inline (raw_export_payload),
-- or a durable reference GymApp controls is stored (raw_export_uri, e.g. a
-- pinned git blob URL at source_commit, or a Supabase Storage object path —
-- NOT a path that depends on the Library repo's working-copy layout).
-- ----------------------------------------------------------------------------
create table if not exists public.canonical_import_raw_artifact (
  snapshot_id uuid not null,
  raw_export_uri text,      -- durable reference GymApp controls, if not stored inline
  raw_export_payload jsonb, -- inline copy of the bare exported array, if not referenced by URI
  stored_at timestamptz not null default now(),

  constraint canonical_import_raw_artifact_pkey primary key (snapshot_id),
  constraint canonical_import_raw_artifact_snapshot_fk
    foreign key (snapshot_id) references public.canonical_import_snapshot (id),
  constraint canonical_import_raw_artifact_requires_content
    check (raw_export_uri is not null or raw_export_payload is not null)
);

comment on table public.canonical_import_raw_artifact is
  'DESIGN ONLY. The raw canonical export artifact (inline or a durable GymApp-controlled reference) for one snapshot. Its hash is recorded once, on canonical_import_snapshot.raw_export_sha256. Distinct from canonical_import_raw_taxonomy (raw taxonomies) and canonical_exercise_import (normalized per-record projection).';

-- ----------------------------------------------------------------------------
-- 1b. canonical_import_raw_taxonomy
--
-- Second review point 2: "las taxonomías exactas utilizadas para interpretar
-- los IDs de ese snapshot, no solamente sus hashes." Revision 2 only stored
-- a jsonb summary of {sha256, record_count} per taxonomy file. Revision 3
-- adds this table to hold the EXACT raw taxonomy content (or a durable
-- reference to it) per file, per snapshot — the actual vocabulary that gives
-- meaning to every classification.*/setup.* ID array in that snapshot's
-- exercise records, not just a fingerprint of it.
-- ----------------------------------------------------------------------------
create table if not exists public.canonical_import_raw_taxonomy (
  id uuid not null default gen_random_uuid(),
  snapshot_id uuid not null,
  taxonomy_name text not null,   -- e.g. 'body-regions', matching the taxonomy/<name>.json filename stem
  sha256 text not null,          -- this file's own content hash at source_commit
  record_count integer,          -- number of entries in this taxonomy file, when it is an array (null for difficulty.json, which is a bare object)
  raw_uri text,                  -- durable reference (e.g. pinned git blob URL for taxonomy/<name>.json at source_commit)
  raw_payload jsonb,             -- inline copy of the exact file content
  created_at timestamptz not null default now(),

  constraint canonical_import_raw_taxonomy_pkey primary key (id),
  constraint canonical_import_raw_taxonomy_snapshot_fk
    foreign key (snapshot_id) references public.canonical_import_snapshot (id),
  constraint canonical_import_raw_taxonomy_unique_per_snapshot
    unique (snapshot_id, taxonomy_name),
  constraint canonical_import_raw_taxonomy_requires_content
    check (raw_uri is not null or raw_payload is not null)
);

create index if not exists canonical_import_raw_taxonomy_snapshot_idx
  on public.canonical_import_raw_taxonomy (snapshot_id);

comment on table public.canonical_import_raw_taxonomy is
  'DESIGN ONLY. Exact raw content (inline or durable reference) of every taxonomy/*.json file pinned by a snapshot, one row per file. canonical_import_snapshot.taxonomy_fingerprint is checked against an aggregate of this table''s sha256 values at finalize time (see finalize_canonical_import_snapshot()), so the two cannot silently drift apart once a snapshot is complete.';

-- Convenience read projection, computed (never independently written), so it
-- can never drift from the raw rows it summarizes — replaces revision 2's
-- manually-populated canonical_import_snapshot.taxonomy_snapshot jsonb column.
create or replace view public.canonical_import_taxonomy_summary as
select
  snapshot_id,
  jsonb_object_agg(taxonomy_name, jsonb_build_object('sha256', sha256, 'record_count', record_count)) as taxonomy_snapshot
from public.canonical_import_raw_taxonomy
group by snapshot_id;

comment on view public.canonical_import_taxonomy_summary is
  'DESIGN ONLY. Derived per-snapshot taxonomy summary ({name: {sha256, record_count}}), computed from canonical_import_raw_taxonomy. Read-only projection, not a source of truth.';

-- ----------------------------------------------------------------------------
-- 2. canonical_exercise_import
--
-- Append-only per-record projection, always tied to exactly one
-- canonical_import_snapshot header. Stores the full record payload (not a
-- hand-picked subset of columns), so GymApp can adopt more of the canonical
-- schema later without a migration — this is the "proyección
-- normalizada/queryable" tier, distinct from the raw artifact/taxonomy
-- tables above.
--
-- Revision 3 changes:
--   - `is_current` is REMOVED. Second review point 1 ("no depender de
--     is_current mutable para definir identidad"): a manually-flipped
--     boolean is not a reliable identity/currency mechanism. Currency is now
--     DERIVED, via the canonical_exercise_current view below, from which
--     COMPLETE snapshot most recently imported a given exercise_id — nothing
--     mutates a stored flag to express this.
--   - two new CHECK constraints enforce that the projected `exercise_id` and
--     `status` columns actually match what `payload` (the raw record) says,
--     so the "queryable projection" cannot silently diverge from the record
--     it was projected from.
--   - rows become immutable once their parent snapshot is `complete` (see
--     the trigger below) — a snapshot's children are frozen together with
--     its header.
-- ----------------------------------------------------------------------------
create table if not exists public.canonical_exercise_import (
  id uuid not null default gen_random_uuid(),
  snapshot_id uuid not null,
  exercise_id text not null,

  status text not null,                     -- copy of the record's own `status` field (draft/review_required/approved/deprecated) at import time
  payload jsonb not null,                   -- full canonical exercise record, unmodified — the "raw snapshot for audit" tier

  -- Computed by the importer (application-level, from `payload`) against the
  -- field tiers defined in docs/EXERCISE_INTEGRATION_CONTRACT.md. This is a
  -- cache, not a source of truth — `payload` remains authoritative.
  field_completeness jsonb not null default '{}'::jsonb,

  imported_at timestamptz not null default now(),
  imported_by text not null,

  constraint canonical_exercise_import_pkey primary key (id),
  constraint canonical_exercise_import_snapshot_fk
    foreign key (snapshot_id) references public.canonical_import_snapshot (id),
  constraint canonical_exercise_import_unique_per_snapshot
    unique (snapshot_id, exercise_id),
  constraint canonical_exercise_import_status_check
    check (status in ('draft', 'review_required', 'approved', 'deprecated')),
  -- Revision 6 (BLOCKER fix): `payload ->> 'x' = column` alone is satisfiable
  -- by a payload MISSING the key entirely, because `null = column` evaluates
  -- to NULL and PostgreSQL treats a CHECK that evaluates to NULL as
  -- SATISFIED, not violated. Reproduced concretely: payload = '{}'::jsonb
  -- with valid exercise_id/status column values passed the old constraints
  -- unmodified. The added `is not null` forces the expression to a real
  -- boolean whenever the key is absent (or the payload is the JSON literal
  -- `null`, since `->>` on a non-object jsonb value also returns NULL rather
  -- than erroring).
  constraint canonical_exercise_import_exercise_id_matches_payload
    check (payload ->> 'exercise_id' is not null and payload ->> 'exercise_id' = exercise_id),
  constraint canonical_exercise_import_status_matches_payload
    check (payload ->> 'status' is not null and payload ->> 'status' = status),
  -- exercise_id is this row's identity; an empty string is not a valid
  -- identity value even though it is technically non-null text.
  constraint canonical_exercise_import_exercise_id_not_blank
    check (btrim(exercise_id) <> '')
);

create index if not exists canonical_exercise_import_exercise_id_idx
  on public.canonical_exercise_import (exercise_id);

comment on table public.canonical_exercise_import is
  'DESIGN ONLY. Append-only, snapshot-scoped normalized projection of Gym-Exercise-Library canonical exercise records. Never referenced by legacy tables directly. Immutable once its parent snapshot is complete.';

-- ----------------------------------------------------------------------------
-- validate_canonical_exercise_import_payload()
--
-- Revision 6 (BLOCKER fix, continued): exercise_id/status are enforced by the
-- same-row CHECK constraints above; the other two Tier-1 fields
-- (docs/EXERCISE_INTEGRATION_CONTRACT.md, "Field tiers" -> "1. Minimum
-- identity/matching contract") cannot be expressed as a same-row CHECK:
--   - `payload.schema_version` must be present AND match the PARENT
--     SNAPSHOT's own `library_schema_version` -- a cross-table comparison,
--     which a CHECK constraint cannot perform (CHECK may not reference other
--     tables in PostgreSQL);
--   - `payload.names.en` must be present and non-blank (`names.es` may be
--     `null` per the contract document -- deliberately NOT required here).
-- No new mandatory field is invented: both are already named as Tier-1
-- requirements in the contract document, just not yet structurally enforced.
-- ----------------------------------------------------------------------------
create or replace function public.validate_canonical_exercise_import_payload()
returns trigger
language plpgsql
as $$
declare
  v_payload_schema_version text;
  v_expected_schema_version text;
  v_names_en text;
begin
  v_payload_schema_version := new.payload ->> 'schema_version';
  if v_payload_schema_version is null or btrim(v_payload_schema_version) = '' then
    raise exception 'canonical_exercise_import %/%: payload.schema_version is required and cannot be null/blank',
      new.snapshot_id, new.exercise_id;
  end if;

  select library_schema_version into v_expected_schema_version
  from public.canonical_import_snapshot
  where id = new.snapshot_id;

  if v_payload_schema_version <> v_expected_schema_version then
    raise exception 'canonical_exercise_import %/%: payload.schema_version (%) does not match its snapshot''s declared library_schema_version (%)',
      new.snapshot_id, new.exercise_id, v_payload_schema_version, v_expected_schema_version;
  end if;

  v_names_en := new.payload #>> '{names,en}';
  if v_names_en is null or btrim(v_names_en) = '' then
    raise exception 'canonical_exercise_import %/%: payload.names.en is required and cannot be null/blank (Tier 1, docs/EXERCISE_INTEGRATION_CONTRACT.md; names.es may be null)',
      new.snapshot_id, new.exercise_id;
  end if;

  return new;
end;
$$;

comment on function public.validate_canonical_exercise_import_payload() is
  'DESIGN ONLY. BEFORE INSERT OR UPDATE gate enforcing the two Tier-1 contract fields that cannot be a same-row CHECK: payload.schema_version present and matching the parent snapshot''s library_schema_version, and payload.names.en present/non-blank.';

create trigger canonical_exercise_import_validate_payload
  before insert or update on public.canonical_exercise_import
  for each row execute function public.validate_canonical_exercise_import_payload();

-- ----------------------------------------------------------------------------
-- gec1_required_taxonomy_names()
--
-- Revision 4 (targeted fix, third review round — TEST 2 defects A/B/C):
-- the EXACT set of taxonomy/*.json files this GEC-1 contract observes in
-- Gym-Exercise-Library, verified directly against the sibling repo's
-- taxonomy/ directory during this revision (`find ../Gym-Exercise-Library/
-- taxonomy -type f`, 9 files, no subdirectories) — the same 9 files already
-- identified in GA-001 revision 2's evidence log. Not invented: this is the
-- observed contractual set for GEC-1, hard-coded here (rather than inferred
-- from "whatever rows happen to exist") specifically so completion can be
-- checked against a known-complete set instead of a self-referential one.
-- A future contract revision that changes this set is a new GEC-* version
-- and would define its own required-set function, not silently redefine
-- this one.
-- ----------------------------------------------------------------------------
create or replace function public.gec1_required_taxonomy_names()
returns text[]
language sql
immutable
as $$
  select array[
    'body-positions', 'body-regions', 'difficulty', 'equipment', 'grips',
    'joint-actions', 'movement-patterns', 'muscles', 'training-types'
  ]::text[];
$$;

comment on function public.gec1_required_taxonomy_names() is
  'DESIGN ONLY. The exact, verified set of taxonomy/*.json file stems required for a GEC-1 snapshot to be completable. Sorted ascending to match array_agg(... order by taxonomy_name) comparisons.';

-- ----------------------------------------------------------------------------
-- validate_snapshot_completion()
--
-- Revision 4 (targeted fix — TEST 1 defect A, TEST 2 defects A/B/C):
-- previously, ALL completion validation lived only inside
-- finalize_canonical_import_snapshot(), which meant a plain
-- `update canonical_import_snapshot set status = 'complete' ...` bypassed
-- every check (record_count, raw artifact presence, taxonomy completeness,
-- taxonomy_fingerprint) — nothing on the table itself stopped it, and the
-- completed_at CHECK constraint is satisfiable by the same bypassing UPDATE.
--
-- Fix: the validation now lives in a BEFORE UPDATE trigger on
-- canonical_import_snapshot itself, so it fires for ANY update that
-- attempts the building -> complete transition, regardless of whether it
-- goes through finalize_canonical_import_snapshot() or a direct UPDATE.
-- This is the "mecanismo de finalización validado" the transition must pass
-- through — enforced structurally, not by convention or by trusting the
-- caller to use the function. finalize_canonical_import_snapshot() below is
-- now a thin, documented entry point; it has no validation logic of its own
-- to avoid the two copies drifting apart.
--
-- Only the transition INTO complete is gated here:
--   - updates that leave status alone (e.g. editing notes while building)
--     pass through untouched, preserving "failed/building pueden conservar
--     la flexibilidad necesaria para importer/retry";
--   - updates to an ALREADY complete row are separately forbidden by
--     canonical_import_snapshot_immutable (forbid_mutation_of_completed_
--     snapshot), so un-completing a snapshot is never possible here or there;
--   - only 'building' -> 'complete' is accepted; 'failed' -> 'complete' is
--     rejected, so a failed import cannot be silently resurrected as
--     complete by flipping the status column.
-- ----------------------------------------------------------------------------
create or replace function public.validate_snapshot_completion()
returns trigger
language plpgsql
as $$
declare
  v_actual_records integer;
  v_raw_artifact_count integer;
  v_actual_taxonomy_names text[];
  v_required_taxonomy_names text[];
  v_computed_taxonomy_fingerprint text;
begin
  -- Revision 5 (targeted fix -- S1 in the fourth adversarial review round):
  -- this function was previously attached BEFORE UPDATE only, so a direct
  -- `INSERT ... (status, completed_at, record_count, ...) VALUES ('complete',
  -- now(), 0, ...)` bypassed every check below entirely -- nothing on the
  -- table stopped an attempt-zero snapshot from being inserted already
  -- "complete". Invariants 1/2 ("A snapshot is INSERTED only as BUILDING.
  -- COMPLETE cannot be supplied on INSERT") require this to fail structurally,
  -- not by convention. Fixed by attaching this same function BEFORE INSERT as
  -- well (see the trigger definition below) and handling that case first, since
  -- OLD is unassigned on INSERT and every reference to it below assumes UPDATE.
  if TG_OP = 'INSERT' then
    if new.status <> 'building' then
      raise exception 'canonical_import_snapshot can only be INSERTed with status = building (attempted %); COMPLETE is reachable only via the building -> complete UPDATE transition validated below',
        new.status;
    end if;
    return new;
  end if;

  -- TG_OP = 'UPDATE' from here on; OLD is safely assigned.
  -- Not a transition into complete: nothing to validate here (immutability
  -- of an already-complete row is enforced separately, by a different
  -- trigger, not this one).
  if new.status is distinct from 'complete' or old.status = 'complete' then
    return new;
  end if;

  if old.status <> 'building' then
    raise exception 'canonical_import_snapshot % cannot become complete from status % (only building -> complete is a valid transition)',
      new.id, old.status;
  end if;

  select count(*) into v_actual_records
  from public.canonical_exercise_import
  where snapshot_id = new.id;

  if v_actual_records <> new.record_count then
    raise exception 'record_count mismatch for snapshot %: declared %, actually imported %',
      new.id, new.record_count, v_actual_records;
  end if;

  select count(*) into v_raw_artifact_count
  from public.canonical_import_raw_artifact
  where snapshot_id = new.id;

  if v_raw_artifact_count <> 1 then
    raise exception 'snapshot % cannot become complete: canonical_import_raw_artifact row is required (found %)',
      new.id, v_raw_artifact_count;
  end if;

  v_required_taxonomy_names := public.gec1_required_taxonomy_names();

  select array_agg(taxonomy_name order by taxonomy_name) into v_actual_taxonomy_names
  from public.canonical_import_raw_taxonomy
  where snapshot_id = new.id;

  if v_actual_taxonomy_names is distinct from v_required_taxonomy_names then
    raise exception 'snapshot % cannot become complete: required taxonomy set mismatch. Expected %, found %',
      new.id, v_required_taxonomy_names, coalesce(v_actual_taxonomy_names, array[]::text[]);
  end if;

  select encode(digest(string_agg(sha256, ':' order by taxonomy_name), 'sha256'), 'hex')
    into v_computed_taxonomy_fingerprint
  from public.canonical_import_raw_taxonomy
  where snapshot_id = new.id;

  if v_computed_taxonomy_fingerprint is distinct from new.taxonomy_fingerprint then
    raise exception 'taxonomy_fingerprint mismatch for snapshot %: header declares %, raw taxonomy rows compute %',
      new.id, new.taxonomy_fingerprint, v_computed_taxonomy_fingerprint;
  end if;

  -- Revision 6 (MAJOR fix, found by self-review during the finalized_at
  -- review round below): `coalesce(new.completed_at, now())` RESPECTS a
  -- caller-supplied completed_at (e.g. a backdated value) whenever the
  -- caller supplies one, since coalesce only falls back to now() when the
  -- caller left it null. The client must not control this timestamp at all.
  -- Fixed to unconditionally overwrite with clock_timestamp() (the actual
  -- wall-clock moment of finalization, not the transaction's snapshot time),
  -- so a supplied value is silently ignored/overridden, never honored.
  new.completed_at := clock_timestamp();

  return new;
end;
$$;

comment on function public.validate_snapshot_completion() is
  'DESIGN ONLY. BEFORE INSERT OR UPDATE gate: on INSERT, rejects any status other than building (COMPLETE cannot be supplied on INSERT). On UPDATE attempting building->complete, validates record_count, mandatory raw artifact presence, the exact required taxonomy set (gec1_required_taxonomy_names()), and taxonomy_fingerprint, against what is actually stored. Fires for every INSERT/UPDATE, not only calls through finalize_canonical_import_snapshot() -- this is the structural enforcement, not the function.';

create trigger canonical_import_snapshot_validate_completion
  before insert or update on public.canonical_import_snapshot
  for each row execute function public.validate_snapshot_completion();

-- ----------------------------------------------------------------------------
-- finalize_canonical_import_snapshot(p_snapshot_id)
--
-- Documented, ergonomic entry point for completing a snapshot. Locks the
-- header row (`for update`) so a concurrent finalize/mutation attempt
-- cannot race past the status check. All completion validation (record
-- count, raw artifact presence, exact required taxonomy set, taxonomy
-- fingerprint) is enforced by validate_snapshot_completion() above, which
-- fires on the UPDATE this function issues exactly as it would on any other
-- UPDATE attempting the same transition -- kept out of this function body so
-- the two cannot drift apart.
--
-- This function does NOT decide what counts as "the import is done" in a
-- business sense (e.g. whether every record has been importer-validated) —
-- it only triggers the check that what was declared matches what was
-- actually stored. The importer/transaction remains responsible for
-- actually inserting every canonical_exercise_import, the
-- canonical_import_raw_artifact row, and every canonical_import_raw_taxonomy
-- row before calling this function.
-- ----------------------------------------------------------------------------
create or replace function public.finalize_canonical_import_snapshot(p_snapshot_id uuid)
returns void
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.canonical_import_snapshot
  where id = p_snapshot_id
  for update;

  if not found then
    raise exception 'canonical_import_snapshot % does not exist', p_snapshot_id;
  end if;

  if v_status <> 'building' then
    raise exception 'canonical_import_snapshot % is not in building status (found %)', p_snapshot_id, v_status;
  end if;

  update public.canonical_import_snapshot
  set status = 'complete'
  where id = p_snapshot_id;
end;
$$;

comment on function public.finalize_canonical_import_snapshot(uuid) is
  'DESIGN ONLY. Documented entry point that transitions a snapshot from building to complete. The actual validation (record_count, raw artifact, required taxonomy set, taxonomy_fingerprint) is enforced by the canonical_import_snapshot_validate_completion trigger on every UPDATE attempting this transition, so calling this function is a convenience, not the only structurally-enforced path.';

-- ----------------------------------------------------------------------------
-- Immutability: once a snapshot is complete, neither its header nor its
-- child canonical_exercise_import rows may be mutated or deleted. This is
-- the DDL-level answer to "mecanismo para impedir mutación de snapshots
-- finalizados" (second review point 1) — not merely a documented convention.
-- ----------------------------------------------------------------------------
create or replace function public.forbid_mutation_of_completed_snapshot()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'complete' then
    raise exception 'canonical_import_snapshot % is complete and immutable (attempted %)', old.id, TG_OP;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger canonical_import_snapshot_immutable
  before update or delete on public.canonical_import_snapshot
  for each row execute function public.forbid_mutation_of_completed_snapshot();

-- Revision 4 (targeted fix — TEST 1 defect B): the previous version used
-- coalesce(new.snapshot_id, old.snapshot_id), which on UPDATE always
-- resolved to NEW.snapshot_id and only ever checked the TARGET snapshot's
-- status. That let a row be reparented (UPDATE ... SET snapshot_id = ...)
-- OUT of an already-complete snapshot into a 'building' one, silently
-- shrinking a complete snapshot's child set without tripping any check.
-- Fixed by checking OLD.snapshot_id and NEW.snapshot_id independently and
-- unconditionally (not one-or-the-other): moving a row OUT of a complete
-- snapshot is forbidden, and inserting/reparenting a row INTO a complete
-- snapshot is forbidden, regardless of which side of the UPDATE it is.
-- This same function is now also attached to canonical_import_raw_artifact
-- and canonical_import_raw_taxonomy below (TEST 1 defect C / TEST 2 defect
-- D — immutability previously covered only the header and
-- canonical_exercise_import, not the raw artifact/taxonomy rows).
create or replace function public.forbid_mutation_of_completed_snapshot_children()
returns trigger
language plpgsql
as $$
declare
  v_old_status text;
  v_new_status text;
begin
  -- OLD is unassigned (not merely null) on INSERT, and NEW is unassigned on
  -- DELETE; referencing either field outside its valid TG_OP would raise
  -- "record 'old'/'new' is not assigned yet". Branch on TG_OP explicitly
  -- rather than relying on implicit short-circuiting.
  --
  -- Revision 6 (BLOCKER fix -- R1/R2 race condition, fifth adversarial review
  -- round): these SELECTs previously had no `for update`, so they read the
  -- parent snapshot's status under plain MVCC visibility without taking any
  -- lock on it. Concretely: Tx A starts a child DELETE (this trigger) while
  -- the snapshot is `building`, without committing; Tx B calls
  -- finalize_canonical_import_snapshot(), which locks the header row `for
  -- update` and validates record_count against whatever is currently
  -- committed -- under READ COMMITTED, Tx B does not see Tx A's uncommitted
  -- delete, so it can commit a `complete` snapshot whose declared
  -- record_count no longer matches reality once Tx A also commits. Fixed by
  -- having every child mutation take the SAME row lock
  -- (`for update` on canonical_import_snapshot`) that
  -- finalize_canonical_import_snapshot()/the building->complete UPDATE
  -- already takes, BEFORE reading status: whichever transaction reaches the
  -- header row lock first now forces the other to wait until it commits or
  -- rolls back, so the two can never interleave. See the "R1-R4 locking
  -- analysis" block comment near the end of this file for the full
  -- two-session walkthrough.
  if TG_OP in ('UPDATE', 'DELETE') then
    select status into v_old_status from public.canonical_import_snapshot where id = old.snapshot_id for update;
    if v_old_status = 'complete' then
      raise exception '% row cannot leave canonical_import_snapshot % (complete, immutable); attempted %',
        TG_TABLE_NAME, old.snapshot_id, TG_OP;
    end if;
  end if;

  if TG_OP in ('INSERT', 'UPDATE') then
    select status into v_new_status from public.canonical_import_snapshot where id = new.snapshot_id for update;
    if v_new_status = 'complete' then
      raise exception '% row cannot be inserted/reparented into canonical_import_snapshot % (complete, immutable); attempted %',
        TG_TABLE_NAME, new.snapshot_id, TG_OP;
    end if;
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger canonical_exercise_import_immutable
  before insert or update or delete on public.canonical_exercise_import
  for each row execute function public.forbid_mutation_of_completed_snapshot_children();

create trigger canonical_import_raw_artifact_immutable
  before insert or update or delete on public.canonical_import_raw_artifact
  for each row execute function public.forbid_mutation_of_completed_snapshot_children();

create trigger canonical_import_raw_taxonomy_immutable
  before insert or update or delete on public.canonical_import_raw_taxonomy
  for each row execute function public.forbid_mutation_of_completed_snapshot_children();

-- ----------------------------------------------------------------------------
-- canonical_exercise_current
--
-- Replaces revision 2's manually-flipped `is_current` boolean. "Currency" is
-- derived — the most recently imported row for a given exercise_id, among
-- COMPLETE snapshots only, ordered by when that snapshot was imported — never
-- stored as a mutable flag that could go stale or be flipped inconsistently.
-- ----------------------------------------------------------------------------
create or replace view public.canonical_exercise_current as
select distinct on (cei.exercise_id)
  cei.exercise_id,
  cei.id as import_id,
  cei.snapshot_id,
  cei.payload,
  cei.field_completeness,
  cei.status,
  s.imported_at as snapshot_imported_at
from public.canonical_exercise_import cei
join public.canonical_import_snapshot s on s.id = cei.snapshot_id
where s.status = 'complete'
order by cei.exercise_id, s.imported_at desc, s.id desc;

comment on view public.canonical_exercise_current is
  'DESIGN ONLY. Derived "latest complete import per exercise_id" view. Deliberately replaces a stored is_current flag — currency is computed, not mutated.';

-- ----------------------------------------------------------------------------
-- canonical_removed_exercise_ids(p_snapshot_prev, p_snapshot_new)
--
-- Second review point 1: "detección de removals únicamente entre snapshots
-- completos." Revision 2 documented this as an ad hoc query; revision 3
-- makes it a function that REFUSES to run unless both snapshots are
-- `complete`, so the rule is enforced, not merely suggested by convention.
-- ----------------------------------------------------------------------------
create or replace function public.canonical_removed_exercise_ids(p_snapshot_prev uuid, p_snapshot_new uuid)
returns table (exercise_id text)
language plpgsql
as $$
declare
  v_status_prev text;
  v_status_new text;
begin
  select status into v_status_prev from public.canonical_import_snapshot where id = p_snapshot_prev;
  select status into v_status_new from public.canonical_import_snapshot where id = p_snapshot_new;

  if v_status_prev is null or v_status_new is null then
    raise exception 'both snapshot ids must reference an existing canonical_import_snapshot (prev=%, new=%)', p_snapshot_prev, p_snapshot_new;
  end if;

  if v_status_prev <> 'complete' or v_status_new <> 'complete' then
    raise exception 'removal detection requires both snapshots to be complete (prev status=%, new status=%)', v_status_prev, v_status_new;
  end if;

  return query
    select prev.exercise_id
    from public.canonical_exercise_import prev
    where prev.snapshot_id = p_snapshot_prev
      and not exists (
        select 1 from public.canonical_exercise_import cur
        where cur.snapshot_id = p_snapshot_new
          and cur.exercise_id = prev.exercise_id
      );
end;
$$;

comment on function public.canonical_removed_exercise_ids(uuid, uuid) is
  'DESIGN ONLY. exercise_ids present in p_snapshot_prev but absent from p_snapshot_new. Raises unless both snapshots are complete. Rows returned keep their prior payload (see canonical_exercise_import) and remain resolvable for any crosswalk row already pointing at them.';

-- ----------------------------------------------------------------------------
-- require_complete_snapshot_for_crosswalk()
--
-- Shared trigger function: "un snapshot incompleto nunca puede utilizarse
-- para crosswalk/compatibility" (second review point 1).
--
-- Revision 6 (documentation-consistency fix, fifth adversarial review round):
-- the prior wording here claimed this function is attached "wherever a table
-- pins an evaluated_snapshot_id — legacy_exercise_evaluation,
-- legacy_exercise_evaluation_candidate, and exercise_reference ... all reuse
-- this one function" as if all three had a DIRECT trigger calling it. That
-- was inaccurate: only legacy_exercise_evaluation (trigger
-- legacy_exercise_evaluation_requires_complete_snapshot, below) and
-- exercise_reference (trigger exercise_reference_requires_complete_snapshot,
-- section 6 below) actually attach this function directly.
-- legacy_exercise_evaluation_candidate has NO trigger calling this function
-- at all — its protection against an incomplete snapshot is INDIRECT, via
-- the composite foreign key `legacy_exercise_evaluation_candidate_evaluation_fk`
-- on `(evaluation_id, evaluated_snapshot_id)` referencing
-- `legacy_exercise_evaluation (id, evaluated_snapshot_id)`: a candidate's
-- evaluated_snapshot_id must equal its parent evaluation's own
-- evaluated_snapshot_id, and that PARENT row is the one this function
-- directly gates. A candidate can therefore never reference an incomplete
-- snapshot that its parent evaluation itself was not already allowed to
-- reference — but the mechanism is referential integrity onto an already-
-- gated parent, not a second direct call to this function.
-- ----------------------------------------------------------------------------
create or replace function public.require_complete_snapshot_for_crosswalk()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  if new.evaluated_snapshot_id is null then
    return new; -- e.g. legacy_only crosswalk rows, or exercise_reference rows with source='legacy', legitimately have no evaluated snapshot
  end if;

  select status into v_status from public.canonical_import_snapshot where id = new.evaluated_snapshot_id;

  if v_status is null then
    raise exception 'evaluated_snapshot_id % does not reference an existing canonical_import_snapshot', new.evaluated_snapshot_id;
  end if;

  if v_status <> 'complete' then
    raise exception 'canonical_import_snapshot % is not complete (status=%); an incomplete snapshot cannot be used for crosswalk or compatibility evaluation', new.evaluated_snapshot_id, v_status;
  end if;

  return new;
end;
$$;

-- ============================================================================
-- Revision 5 (structural refactor — crosswalk model): STOP mutating one
-- crosswalk decision in place. Prior revisions modeled reevaluation as a
-- mutable single row per legacy_ejercicio_id (`legacy_exercise_crosswalk`,
-- DELETE forbidden but UPDATE always allowed) plus a separate audit-log
-- table (`legacy_exercise_crosswalk_history`) that recorded that a rewrite
-- happened, without preventing the rewrite itself. That does NOT satisfy
-- "once finalized, its semantic decision cannot be silently rewritten" —
-- a `matched` row's `canonical_exercise_id`/`confidence`/`notes` could be
-- freely UPDATEd after the fact with nothing structurally stopping it
-- (only a trigger firing afterward to log the change). This is the third
-- adversarial review round's C3 finding, and it is fixed here by replacing
-- the mutable-row-plus-audit-log pattern with a genuine append-only
-- evaluation/revision ledger, mirroring the building->complete lifecycle
-- pattern already proven for canonical_import_snapshot above:
--
--   - `legacy_exercise_evaluation`: one row per evaluation/revision (NOT one
--     row per legacy id). A legacy exercise accumulates MANY evaluation rows
--     over time, one per (re)evaluation attempt — never one mutated row.
--   - each evaluation has its own draft/final lifecycle: `draft` while its
--     evidence/candidates are still being assembled, `final` once
--     `finalize_legacy_exercise_evaluation()` locks it — after which it is
--     immutable (UPDATE/DELETE forbidden by trigger, the same pattern as
--     canonical_import_snapshot's immutability trigger), so C3 cannot
--     reoccur: there is no row left to rewrite once final.
--   - `legacy_exercise_evaluation_candidate` rows belong to exactly ONE
--     evaluation (FK on `evaluation_id`, not on a mutable legacy parent) —
--     satisfying crosswalk requirement 3. They may be freely added/edited/
--     removed while their parent evaluation is `draft` (so a reevaluation can
--     actually be assembled), then become append-only/immutable the moment
--     their parent evaluation finalizes (requirement 4) — via the same
--     "reject if parent is final" trigger pattern used for snapshot children.
--   - "current/latest accepted evaluation" (requirement 6) is DERIVED — the
--     most recently finalized evaluation per legacy id — never a mutated
--     pointer column on a shared row. See `legacy_exercise_current_evaluation`
--     below. A superseding evaluation (B) is simply a NEW row; the prior one
--     (A) is never touched, so A remains independently retrievable with its
--     own candidates/evidence intact (requirement 9 / C10).
--   - `legacy_only` (a legacy exercise with no evaluation yet) is no longer a
--     stored status on a permanent row — it is the natural absence of any
--     evaluation row for that legacy id, surfaced by the
--     `legacy_exercise_crosswalk_status` view below, which still exposes the
--     original matched/ambiguous/unmatched/legacy_only vocabulary as a read
--     model over the append-only ledger.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 3. legacy_exercise_evaluation
--
-- One row per evaluation/revision of a legacy public.ejercicios.id against a
-- specific, complete canonical_import_snapshot. Never mutates
-- public.ejercicios, public.rutina_ejercicios or public.series_registradas.
-- See docs/LEGACY_EXERCISE_CROSSWALK.md.
--
-- Lifecycle (mirrors canonical_import_snapshot's building/complete pattern):
--   draft  — being assembled; candidates may be freely inserted/updated/
--            deleted while the parent evaluation stays draft; content-level
--            evidence requirements (evidence/target CHECK constraints below)
--            already apply even in draft, so a row cannot half-exist as
--            "matched with no target" at any point.
--   final  — locked by finalize_legacy_exercise_evaluation(); immutable from
--            that point on (see legacy_exercise_evaluation_immutable below).
--            A reevaluation is always a NEW row, never a rewrite of this one.
-- ----------------------------------------------------------------------------
create table if not exists public.legacy_exercise_evaluation (
  id uuid not null default gen_random_uuid(),
  legacy_ejercicio_id text not null,

  -- Every evaluation is necessarily against one specific, pinned, complete
  -- snapshot — there is no "legacy_only" evaluation row; the absence of any
  -- evaluation row IS legacy_only (see legacy_exercise_crosswalk_status view).
  evaluated_snapshot_id uuid not null,

  match_status text not null,               -- 'matched' | 'ambiguous' | 'unmatched' — this evaluation's own declared outcome
  canonical_exercise_id text,                -- set only when match_status = 'matched'; see composite FK below
  confidence text,                           -- low/medium/high; required when match_status = 'matched'

  gec_contract_version text,                 -- which contract version this evaluation was made against

  -- Free-text pointer, NOT a FK, to a canonical_exercise_id that GymApp
  -- believes has superseded `canonical_exercise_id` (e.g. the Library
  -- deprecated it and a human identified a replacement). This does not
  -- assert that the Library models renames this way — see "Canonical
  -- identifier stability: confirmed vs proposed" in
  -- docs/EXERCISE_INTEGRATION_CONTRACT.md. Manual follow-up only; nothing
  -- reads this column automatically.
  superseded_by_exercise_id text,

  evaluated_by text,                         -- reviewer identity; required for matched/ambiguous
  notes text,                                -- evidence; required for matched/ambiguous

  lifecycle_state text not null default 'draft',  -- 'draft' | 'final'
  created_at timestamptz not null default now(),
  finalized_at timestamptz,                       -- set only by finalize_legacy_exercise_evaluation()

  constraint legacy_exercise_evaluation_pkey primary key (id),
  constraint legacy_exercise_evaluation_ejercicio_fk
    foreign key (legacy_ejercicio_id) references public.ejercicios (id),
  constraint legacy_exercise_evaluation_snapshot_fk
    foreign key (evaluated_snapshot_id) references public.canonical_import_snapshot (id),
  -- Real referential integrity: the claimed canonical target must actually
  -- exist in the evaluated snapshot's own imported payload (C7).
  constraint legacy_exercise_evaluation_canonical_target_fk
    foreign key (evaluated_snapshot_id, canonical_exercise_id)
    references public.canonical_exercise_import (snapshot_id, exercise_id),
  -- FK target for legacy_exercise_evaluation_candidate: ties a candidate to
  -- "this exact evaluation, evaluated under this exact snapshot" (C6) — a
  -- candidate cannot claim evaluation_id = B while evaluated_snapshot_id = A,
  -- because no (B, A) row exists here if B's own evaluated_snapshot_id is B.
  constraint legacy_exercise_evaluation_id_snapshot_unique
    unique (id, evaluated_snapshot_id),
  constraint legacy_exercise_evaluation_status_check
    check (match_status in ('matched', 'ambiguous', 'unmatched')),
  constraint legacy_exercise_evaluation_confidence_check
    check (confidence is null or confidence in ('low', 'medium', 'high')),
  constraint legacy_exercise_evaluation_lifecycle_check
    check (lifecycle_state in ('draft', 'final')),
  constraint legacy_exercise_evaluation_finalized_at_check
    check (
      (lifecycle_state = 'final' and finalized_at is not null)
      or
      (lifecycle_state = 'draft' and finalized_at is null)
    ),
  constraint legacy_exercise_evaluation_matched_requires_target
    check (
      (match_status = 'matched' and canonical_exercise_id is not null and confidence is not null)
      or
      (match_status <> 'matched' and canonical_exercise_id is null)
    ),
  -- Evidence required for both matched and ambiguous rows (C9 / part of C8).
  -- Revision 6 (C9 fix, fifth adversarial review round): `evaluated_by is not
  -- null` / `notes is not null` alone accepted the EMPTY STRING as evidence
  -- (evaluated_by='', notes='') -- an absence of evidence disguised as a
  -- present-but-blank value, not a null one. Added btrim(...) <> '' so
  -- whitespace-only values are rejected the same way nulls already are. This
  -- is presence-of-evidence enforcement only (a non-blank string), not
  -- semantic/human validation of the evidence's content.
  constraint legacy_exercise_evaluation_evidence_required_check
    check (
      (match_status in ('matched', 'ambiguous')
        and evaluated_by is not null and btrim(evaluated_by) <> ''
        and notes is not null and btrim(notes) <> '')
      or
      (match_status = 'unmatched')
    )
);

create index if not exists legacy_exercise_evaluation_legacy_idx
  on public.legacy_exercise_evaluation (legacy_ejercicio_id);

create index if not exists legacy_exercise_evaluation_status_idx
  on public.legacy_exercise_evaluation (match_status);

comment on table public.legacy_exercise_evaluation is
  'DESIGN ONLY. Append-only evaluation/revision ledger: one row per (re)evaluation of a legacy ejercicios.id against a specific complete canonical_import_snapshot, never one mutated row per legacy id. Draft rows may still be refined; final rows are immutable (see legacy_exercise_evaluation_immutable). A reevaluation is always a new row.';

create trigger legacy_exercise_evaluation_requires_complete_snapshot
  before insert or update on public.legacy_exercise_evaluation
  for each row execute function public.require_complete_snapshot_for_crosswalk();

-- Immutability once final. Named to sort alphabetically BEFORE
-- legacy_exercise_evaluation_validate_finalization (see below), so on any
-- UPDATE of an already-final row this trigger raises first — the
-- finalization-validation trigger never even runs against an already-final
-- row. This is what makes C3 ("mutate/delete finalized evaluation A") FAIL.
create or replace function public.forbid_mutation_of_finalized_evaluation()
returns trigger
language plpgsql
as $$
begin
  if old.lifecycle_state = 'final' then
    raise exception 'legacy_exercise_evaluation % is final and immutable (attempted %); represent a reevaluation as a NEW evaluation row, never a rewrite of a finalized one',
      old.id, TG_OP;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger legacy_exercise_evaluation_immutable
  before update or delete on public.legacy_exercise_evaluation
  for each row execute function public.forbid_mutation_of_finalized_evaluation();

-- ----------------------------------------------------------------------------
-- validate_evaluation_finalization()
--
-- Same structural lesson already applied to canonical_import_snapshot above
-- (revision 5's S1 fix): validation must live in a trigger that fires on
-- EVERY attempt at the transition, INSERT included, not only inside a
-- documented entry-point function that a caller could bypass by issuing a
-- raw INSERT/UPDATE directly.
--
--   - INSERT: an evaluation can only ever be inserted as 'draft'
--     (lifecycle_state = 'final' on INSERT is rejected outright) — mirrors
--     "a snapshot is inserted only as building" for evaluations.
--   - UPDATE into 'final': by the time this runs, the immutable trigger above
--     has already guaranteed old.lifecycle_state = 'draft' (an already-final
--     row never reaches here). The one thing no column-level CHECK can
--     express is enforced here: an 'ambiguous' evaluation must have at least
--     TWO candidate rows before it can finalize (C8; revision 6 tightened
--     this from >= 1 to >= 2 to match this contract's own definition of
--     "ambiguous" as multiple plausible candidates —
--     docs/LEGACY_EXERCISE_CROSSWALK.md). matched/evidence
--     requirements are already guaranteed unconditionally by this table's own
--     CHECK constraints (legacy_exercise_evaluation_matched_requires_target,
--     ..._evidence_required_check), so a row that violates them cannot exist
--     at all, let alone reach finalize — a stronger guarantee than "cannot
--     finalize" (C9).
--   - UPDATE that leaves lifecycle_state at 'draft' (e.g. correcting notes
--     before finalizing): passes through untouched.
-- ----------------------------------------------------------------------------
create or replace function public.validate_evaluation_finalization()
returns trigger
language plpgsql
as $$
declare
  v_candidate_count integer;
begin
  if TG_OP = 'INSERT' then
    if new.lifecycle_state = 'final' then
      raise exception 'legacy_exercise_evaluation cannot be INSERTed already final (legacy_ejercicio_id %); insert as draft, then call finalize_legacy_exercise_evaluation()',
        new.legacy_ejercicio_id;
    end if;
    return new;
  end if;

  -- TG_OP = 'UPDATE'; legacy_exercise_evaluation_immutable (sorts before this
  -- trigger alphabetically) has already rejected any update where
  -- old.lifecycle_state = 'final', so old.lifecycle_state = 'draft' here.
  if new.lifecycle_state is distinct from 'final' then
    return new; -- still draft after this update: nothing to validate yet
  end if;

  if new.match_status = 'ambiguous' then
    -- Revision 6 (MINOR fix, fifth adversarial review round):
    -- docs/LEGACY_EXERCISE_CROSSWALK.md defines `ambiguous` as "more than one
    -- canonical candidate is plausible" -- i.e. requires >= 2 candidates, not
    -- merely >= 1. The prior `= 0` check accepted a single-candidate
    -- "ambiguous" evaluation, which contradicts that documented definition
    -- (a single plausible candidate is not an ambiguity, it is either a
    -- match or a weak/unmatched call). No new field/status is invented here:
    -- this only tightens the existing gate to match the contract's own
    -- prose, which the SQL previously under-enforced.
    select count(*) into v_candidate_count
    from public.legacy_exercise_evaluation_candidate
    where evaluation_id = new.id;

    if v_candidate_count < 2 then
      raise exception 'legacy_exercise_evaluation % cannot finalize as ambiguous with fewer than 2 candidates (found %); ambiguous means multiple plausible candidates, per docs/LEGACY_EXERCISE_CROSSWALK.md',
        new.id, v_candidate_count;
    end if;
  end if;

  -- Revision 6 (MAJOR fix, fifth adversarial review round): the client must
  -- not be able to decide finalization order by supplying its own
  -- finalized_at (e.g. a backdated '2000-01-01'). `coalesce(new.finalized_at,
  -- now())` previously RESPECTED a caller-supplied value whenever one was
  -- given -- only falling back to now() when the caller left it null. Fixed
  -- to unconditionally overwrite with clock_timestamp() (actual wall-clock
  -- finalization moment, monotonic even across multiple statements in the
  -- same transaction, unlike now()/transaction timestamp), so a supplied
  -- value is silently ignored/overridden, never honored. Once final, this
  -- row (and this column) becomes fully immutable
  -- (legacy_exercise_evaluation_immutable, above), so it cannot be edited
  -- afterward either.
  new.finalized_at := clock_timestamp();
  return new;
end;
$$;

comment on function public.validate_evaluation_finalization() is
  'DESIGN ONLY. BEFORE INSERT OR UPDATE gate on legacy_exercise_evaluation: rejects INSERTing an already-final row, and on the draft->final UPDATE, requires an ambiguous evaluation to have at least TWO candidates (the one requirement no column-level CHECK can express) and unconditionally sets finalized_at to clock_timestamp(), overriding any caller-supplied value. Fires for every INSERT/UPDATE, not only calls through finalize_legacy_exercise_evaluation().';

create trigger legacy_exercise_evaluation_validate_finalization
  before insert or update on public.legacy_exercise_evaluation
  for each row execute function public.validate_evaluation_finalization();

-- ----------------------------------------------------------------------------
-- finalize_legacy_exercise_evaluation(p_evaluation_id)
--
-- Documented, ergonomic entry point, exactly analogous to
-- finalize_canonical_import_snapshot() above. Locks the row (`for update`) so
-- a concurrent finalize/mutation attempt cannot race past the status check.
-- All completion validation lives in validate_evaluation_finalization() above
-- (fires on the UPDATE this function issues, exactly as on any other UPDATE
-- attempting the same transition), kept out of this function body so the two
-- cannot drift apart.
-- ----------------------------------------------------------------------------
create or replace function public.finalize_legacy_exercise_evaluation(p_evaluation_id uuid)
returns void
language plpgsql
as $$
declare
  v_state text;
begin
  select lifecycle_state into v_state
  from public.legacy_exercise_evaluation
  where id = p_evaluation_id
  for update;

  if not found then
    raise exception 'legacy_exercise_evaluation % does not exist', p_evaluation_id;
  end if;

  if v_state <> 'draft' then
    raise exception 'legacy_exercise_evaluation % is not draft (found %)', p_evaluation_id, v_state;
  end if;

  update public.legacy_exercise_evaluation
  set lifecycle_state = 'final'
  where id = p_evaluation_id;
end;
$$;

comment on function public.finalize_legacy_exercise_evaluation(uuid) is
  'DESIGN ONLY. Documented entry point that transitions an evaluation from draft to final. The actual validation is enforced by the legacy_exercise_evaluation_validate_finalization trigger on every UPDATE attempting this transition, so calling this function is a convenience, not the only structurally-enforced path.';

-- ----------------------------------------------------------------------------
-- legacy_exercise_current_evaluation / legacy_exercise_crosswalk_status
--
-- Requirement 6 ("A mechanism must identify the current/latest accepted
-- evaluation without mutating/deleting A"): DERIVED, never a stored/mutated
-- pointer. The most recently finalized evaluation per legacy id is "current".
-- Creating evaluation B never touches A's row (C5, C10).
--
-- legacy_exercise_crosswalk_status additionally reconstructs the original
-- matched/ambiguous/unmatched/legacy_only vocabulary as a read model: a
-- legacy id with zero evaluation rows is legacy_only by absence, not by a
-- stored default row.
-- ----------------------------------------------------------------------------
create or replace view public.legacy_exercise_current_evaluation as
select distinct on (legacy_ejercicio_id)
  id as evaluation_id,
  legacy_ejercicio_id,
  evaluated_snapshot_id,
  match_status,
  canonical_exercise_id,
  confidence,
  superseded_by_exercise_id,
  gec_contract_version,
  evaluated_by,
  notes,
  finalized_at
from public.legacy_exercise_evaluation
where lifecycle_state = 'final'
order by legacy_ejercicio_id, finalized_at desc, id desc;

comment on view public.legacy_exercise_current_evaluation is
  'DESIGN ONLY. Most recently finalized legacy_exercise_evaluation per legacy_ejercicio_id. Derived, never a stored/mutated pointer -- superseding a legacy id''s current evaluation with a new one never touches the prior evaluation row.';

-- Revision 6 (MINOR fix, fifth adversarial review round): the prior version
-- of this view collapsed TWO distinct states into one label -- "never
-- evaluated" (zero legacy_exercise_evaluation rows ever) and "a draft
-- evaluation exists but has not been finalized yet" -- both showed as
-- `legacy_only`, because the join was only against
-- legacy_exercise_current_evaluation (which only sees `final` rows). A
-- legacy id with an in-progress draft evaluation would therefore
-- semantically "disappear" and look identical to one nobody has ever looked
-- at, which the review correctly flagged as wrong. Fixed by additionally
-- checking for any `draft` row per legacy id:
--   - a finalized evaluation exists -> its match_status (matched/ambiguous/
--     unmatched), exactly as before;
--   - no finalized evaluation, but a draft one exists -> 'draft_in_progress'
--     (distinct from both a finalized outcome and true legacy_only);
--   - neither exists -> 'legacy_only', unchanged.
-- `has_draft_evaluation` is additionally exposed unconditionally (not only
-- when there is no final row), so a REEVALUATION in progress on top of an
-- already-finalized legacy id is also visible, not just the "never
-- evaluated at all" case.
create or replace view public.legacy_exercise_crosswalk_status as
select
  ej.id as legacy_ejercicio_id,
  case
    when cur.match_status is not null then cur.match_status
    when draft.legacy_ejercicio_id is not null then 'draft_in_progress'
    else 'legacy_only'
  end as match_status,
  cur.evaluation_id as current_evaluation_id,
  cur.evaluated_snapshot_id,
  cur.canonical_exercise_id,
  cur.confidence,
  cur.finalized_at,
  (draft.legacy_ejercicio_id is not null) as has_draft_evaluation
from public.ejercicios ej
left join public.legacy_exercise_current_evaluation cur
  on cur.legacy_ejercicio_id = ej.id
left join (
  select distinct legacy_ejercicio_id
  from public.legacy_exercise_evaluation
  where lifecycle_state = 'draft'
) draft on draft.legacy_ejercicio_id = ej.id;

comment on view public.legacy_exercise_crosswalk_status is
  'DESIGN ONLY. Per-legacy-exercise read model reconstructing matched/ambiguous/unmatched/legacy_only/draft_in_progress: legacy_only is the natural absence of ANY legacy_exercise_evaluation row (draft or final); draft_in_progress means a draft evaluation exists but none has finalized yet -- distinct from both legacy_only and a finalized outcome. has_draft_evaluation is exposed even when a final evaluation already exists, so a reevaluation in progress on top of a finalized legacy id remains visible.';

-- ----------------------------------------------------------------------------
-- 4. legacy_exercise_evaluation_candidate
--
-- One-to-many candidates belonging to exactly ONE evaluation (crosswalk
-- requirement 3 — "candidates belong to one evaluation, not to a mutable
-- legacy parent"). Resolution to 'matched' is a manual decision made when the
-- evaluation itself is created/finalized; rows here are never auto-promoted
-- (no trigger performs this).
--
-- `evaluated_snapshot_id` is denormalized onto each candidate row (rather
-- than looked up transitively through evaluation_id) specifically so it can
-- be tied by a REAL composite FK to the parent evaluation's own
-- (id, evaluated_snapshot_id) pair — this is what makes C6 ("candidate B
-- references snapshot A while evaluation B references B") a structural FK
-- violation instead of an application-trusted invariant.
-- ----------------------------------------------------------------------------
create table if not exists public.legacy_exercise_evaluation_candidate (
  id uuid not null default gen_random_uuid(),
  evaluation_id uuid not null,
  evaluated_snapshot_id uuid not null,      -- must match the parent evaluation's own evaluated_snapshot_id; see composite FK below
  canonical_exercise_id text not null,
  confidence text not null,
  rank integer not null,                    -- lower rank = stronger candidate; must be positive and unique within its evaluation
  notes text,
  created_at timestamptz not null default now(),

  constraint legacy_exercise_evaluation_candidate_pkey primary key (id),
  -- Ties this candidate to "this exact evaluation, evaluated under this exact
  -- snapshot" — the parent evaluation must actually have this
  -- evaluated_snapshot_id (C6).
  constraint legacy_exercise_evaluation_candidate_evaluation_fk
    foreign key (evaluation_id, evaluated_snapshot_id)
    references public.legacy_exercise_evaluation (id, evaluated_snapshot_id),
  -- The candidate's claimed target must actually exist in that snapshot's own
  -- imported payload (C7, same reasoning as the evaluation's own target FK).
  constraint legacy_exercise_evaluation_candidate_target_fk
    foreign key (evaluated_snapshot_id, canonical_exercise_id)
    references public.canonical_exercise_import (snapshot_id, exercise_id),
  constraint legacy_exercise_evaluation_candidate_confidence_check
    check (confidence in ('low', 'medium', 'high')),
  constraint legacy_exercise_evaluation_candidate_rank_positive_check
    check (rank > 0),
  constraint legacy_exercise_evaluation_candidate_unique
    unique (evaluation_id, canonical_exercise_id),
  constraint legacy_exercise_evaluation_candidate_rank_unique
    unique (evaluation_id, rank)
);

create index if not exists legacy_exercise_evaluation_candidate_evaluation_idx
  on public.legacy_exercise_evaluation_candidate (evaluation_id);

comment on table public.legacy_exercise_evaluation_candidate is
  'DESIGN ONLY. Candidate canonical matches belonging to exactly one legacy_exercise_evaluation, referentially tied to both that evaluation''s own (id, evaluated_snapshot_id) pair and to the evaluated snapshot''s own imported payload. Freely editable while the parent evaluation is draft; append-only/immutable once the parent finalizes (see forbid_mutation_of_finalized_evaluation_children below). Not auto-promoted into a match.';

-- Append-only ONLY once the parent evaluation is final (crosswalk
-- requirement 4: "candidates are append-only/immutable AFTER the evaluation
-- is finalized" -- not before; while draft, candidates may still be
-- assembled/corrected/removed, since finalize's ambiguous->needs-candidates
-- check would otherwise be untestable in practice). This is what makes C4
-- ("mutate/delete candidates belonging to finalized A") FAIL, while still
-- permitting normal editing of an in-progress (draft) evaluation.
create or replace function public.forbid_mutation_of_finalized_evaluation_children()
returns trigger
language plpgsql
as $$
declare
  v_state text;
begin
  -- Revision 6 (BLOCKER fix -- R3/R4 race condition, fifth adversarial
  -- review round): mirrors the R1/R2 fix on
  -- forbid_mutation_of_completed_snapshot_children() above. These SELECTs
  -- previously had no `for update`, so a candidate DELETE/UPDATE could read
  -- the parent evaluation's lifecycle_state under plain MVCC visibility with
  -- no lock on it. Concretely: Tx A deletes/modifies a candidate belonging to
  -- a `draft` evaluation without committing; Tx B calls
  -- finalize_legacy_exercise_evaluation(), which locks the evaluation row
  -- `for update` and counts candidates against whatever is currently
  -- committed -- under READ COMMITTED it does not see Tx A's uncommitted
  -- change, so an `ambiguous` evaluation can finalize with evidence that
  -- Tx A's subsequent commit then invalidates. Fixed by taking the SAME row
  -- lock on legacy_exercise_evaluation (`for update`, matching
  -- finalize_legacy_exercise_evaluation()'s own lock) BEFORE reading
  -- lifecycle_state, so a candidate mutation and a finalization can never
  -- interleave. See the "R1-R4 locking analysis" block comment near the end
  -- of this file.
  if TG_OP in ('UPDATE', 'DELETE') then
    select lifecycle_state into v_state from public.legacy_exercise_evaluation where id = old.evaluation_id for update;
    if v_state = 'final' then
      raise exception '% row cannot be modified: parent legacy_exercise_evaluation % is final (immutable historical evidence); attempted %',
        TG_TABLE_NAME, old.evaluation_id, TG_OP;
    end if;
  end if;

  if TG_OP in ('INSERT', 'UPDATE') then
    select lifecycle_state into v_state from public.legacy_exercise_evaluation where id = new.evaluation_id for update;
    if v_state = 'final' then
      raise exception '% row cannot be inserted/reparented into finalized legacy_exercise_evaluation %; attempted %',
        TG_TABLE_NAME, new.evaluation_id, TG_OP;
    end if;
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger legacy_exercise_evaluation_candidate_immutable
  before insert or update or delete on public.legacy_exercise_evaluation_candidate
  for each row execute function public.forbid_mutation_of_finalized_evaluation_children();

-- Cross-table consistency this design ADDITIONALLY enforces at finalize time
-- (see validate_evaluation_finalization() above), not merely documented as a
-- reconciliation query: an 'ambiguous' evaluation cannot transition to final
-- with fewer than two legacy_exercise_evaluation_candidate rows (revision 6;
-- previously fewer than one, which under-enforced this document's own
-- "ambiguous means multiple plausible candidates" definition). (Prior revisions of
-- this file left this as a suggested reconciliation query only, since it was
-- attached to a mutable crosswalk row with no finalize gate to hook it into;
-- the evaluation lifecycle now gives it a real enforcement point.)

-- ============================================================================
-- 6. exercise_reference — the chosen strategy for future exercise reference
--    (second review point 4, marked critical)
--
-- CHOSEN STRATEGY: a local indirection ENTITY (not inline discriminated
-- columns repeated on every consuming table). rutina_ejercicios and
-- series_registradas gain ONE new nullable column (`exercise_ref_id`,
-- proposed below in "Future additive columns") pointing here, instead of
-- each carrying its own (source, legacy_id, canonical_id) triple.
--
-- Why an entity instead of inline discriminated columns on each table:
--   - the exactly-one-of(legacy, canonical) invariant is defined ONCE, here,
--     instead of being duplicated (and risking drift) across
--     rutina_ejercicios, series_registradas, and any future consumer;
--   - the future Compatibility Engine gets ONE join target to resolve
--     "what exercise is this, regardless of where the reference came from",
--     instead of having to special-case which table/column supplied the
--     identity;
--   - multiple rows referencing the same underlying exercise can share one
--     exercise_reference row (enforced by the partial unique indexes below),
--     instead of repeating the same discriminated triple on every row.
--
-- What this table does NOT do: it does not replace or migrate the existing
-- `ejercicio_id text not null` column on rutina_ejercicios/series_registradas
-- for historical rows. Every historical row keeps resolving through that
-- column exactly as it does today (requirement A) — this table and its
-- future FK column are additive, for NEW rows going forward (requirement B),
-- and are the ONLY way to represent a canonical-only exercise — one that has
-- never existed in public.ejercicios — without inventing a synthetic legacy
-- row (requirement C, explicitly forbidden by this task).
--
-- source = 'legacy' rows exist mainly so the Compatibility Engine has one
-- resolution path; a NEW row referencing a legacy exercise may continue to
-- just set `ejercicio_id` directly, exactly as today, without ever creating
-- an exercise_reference row — that remains valid and is not required to
-- change.
-- ============================================================================
create table if not exists public.exercise_reference (
  id uuid not null default gen_random_uuid(),
  source text not null,                      -- 'legacy' | 'canonical' — discriminator; the two identity namespaces are never mixed in one row
  legacy_ejercicio_id text,                  -- set only when source = 'legacy'
  canonical_exercise_id text,                -- set only when source = 'canonical'; not a FK to external Library identity (see legacy_exercise_evaluation for why), but IS checked against the evaluated snapshot's own payload below when evaluated_snapshot_id is set
  evaluated_snapshot_id uuid,                -- which canonical_import_snapshot's payload this canonical_exercise_id was resolved against, when known; always null for source='legacy'
  created_at timestamptz not null default now(),
  created_by text not null,

  constraint exercise_reference_pkey primary key (id),
  constraint exercise_reference_source_check check (source in ('legacy', 'canonical')),
  constraint exercise_reference_discriminated_check check (
    (source = 'legacy' and legacy_ejercicio_id is not null and canonical_exercise_id is null and evaluated_snapshot_id is null)
    or
    (source = 'canonical' and canonical_exercise_id is not null and legacy_ejercicio_id is null)
  ),
  constraint exercise_reference_legacy_fk
    foreign key (legacy_ejercicio_id) references public.ejercicios (id),
  constraint exercise_reference_snapshot_fk
    foreign key (evaluated_snapshot_id) references public.canonical_import_snapshot (id),
  -- When a canonical_exercise_id is pinned to a specific evaluated snapshot,
  -- it must actually exist in that snapshot's own imported payload (same
  -- reasoning as legacy_exercise_evaluation's canonical target FK). A
  -- source='canonical' row with evaluated_snapshot_id left null skips this
  -- check — that is a deliberately looser case (a canonical id asserted
  -- without pinning which snapshot vouches for it) and is flagged as an
  -- importer/transaction responsibility below, not something this design
  -- forbids outright, since GA-001 does not mandate every future consumer
  -- go through a snapshot-evaluated path.
  constraint exercise_reference_canonical_target_fk
    foreign key (evaluated_snapshot_id, canonical_exercise_id)
    references public.canonical_exercise_import (snapshot_id, exercise_id)
);

-- Deduplication: at most one exercise_reference row per legacy id, and at
-- most one per canonical id, so consumers naturally converge on sharing a
-- reference rather than minting duplicates for the same underlying exercise.
create unique index if not exists exercise_reference_legacy_unique
  on public.exercise_reference (legacy_ejercicio_id) where source = 'legacy';

create unique index if not exists exercise_reference_canonical_unique
  on public.exercise_reference (canonical_exercise_id) where source = 'canonical';

comment on table public.exercise_reference is
  'DESIGN ONLY, proposed for a future task (not applied by GA-001). Local indirection entity so rutina_ejercicios/series_registradas/alternativas can point at ONE reference regardless of whether the underlying exercise identity is legacy (public.ejercicios) or canonical-only (never existed in public.ejercicios, and never will via a synthetic legacy row). See the block comment above this table for why an entity was chosen over inline discriminated columns.';

create trigger exercise_reference_requires_complete_snapshot
  before insert or update on public.exercise_reference
  for each row execute function public.require_complete_snapshot_for_crosswalk();

-- ============================================================================
-- Future additive columns — NOT part of this design's applied surface.
--
-- These ALTER TABLE statements are a design PROPOSAL for a later task, once
-- the Compatibility Engine (docs/REENGINEERING_DECISION_FRAME.md) exists and
-- GymApp begins generating NEW routine-exercise rows that may reference
-- canonical identity directly, including canonical-only exercises that never
-- existed in public.ejercicios.
--
-- IMPORTANT, flagged explicitly: the `alter column ejercicio_id drop not
-- null` statements below are the ONE proposal in this entire file that is
-- NOT purely additive in the strict sense used elsewhere (new tables /
-- new nullable columns only). It loosens an existing constraint. It is
-- unavoidable given requirement C from the second review: a canonical-only
-- exercise must be representable on a NEW rutina_ejercicios/
-- series_registradas row WITHOUT inventing a synthetic legacy ejercicios
-- row (explicitly forbidden). Since `ejercicio_id` is `not null` today,
-- the only way for such a row to exist with zero legacy identity is to make
-- the column nullable for rows that don't need it. This does NOT rewrite
-- any existing value on any existing row — every historical row keeps its
-- current non-null `ejercicio_id` exactly as-is (requirement A) — and is
-- trivially reversible (re-adding NOT NULL) if this strategy is ever
-- abandoned before any row actually relies on the loosened constraint.
--
--   alter table public.rutina_ejercicios
--     alter column ejercicio_id drop not null;
--
--   alter table public.series_registradas
--     alter column ejercicio_id drop not null;
--
--   alter table public.rutina_ejercicios
--     add column if not exists exercise_ref_id uuid references public.exercise_reference (id);
--
--   alter table public.series_registradas
--     add column if not exists exercise_ref_id uuid references public.exercise_reference (id);
--
-- Every row — historical or new — must resolve via at least one identity
-- path (requirement B: new rows may use legacy OR canonical, never neither):
--
--   alter table public.rutina_ejercicios
--     add constraint rutina_ejercicios_identity_present_check
--     check (ejercicio_id is not null or exercise_ref_id is not null);
--
--   alter table public.series_registradas
--     add constraint series_registradas_identity_present_check
--     check (ejercicio_id is not null or exercise_ref_id is not null);
--
-- Namespaces stay separate: `ejercicio_id` is always a raw legacy text id;
-- `exercise_ref_id` is always a UUID pointing at exercise_reference, which
-- itself discriminates legacy-vs-canonical internally. No column ever holds
-- a raw canonical exercise_id string directly — the reference entity is the
-- only place that string is stored outside canonical_exercise_import and
-- legacy_exercise_evaluation.
--
-- For `rutina_ejercicios.alternativas` (jsonb array, no DB-level item
-- schema): the additive convention is a new OPTIONAL `exercise_ref_id` key
-- (uuid, pointing at exercise_reference.id) alongside the existing
-- `ejercicio_id`/`nombre`/`equipo`/`motivo` keys each alternative object
-- already carries (confirmed in app.js's `usarAlternativa`/
-- `agregarAlternativaManual`). An alternative describing a canonical-only
-- exercise carries `exercise_ref_id` and OMITS `ejercicio_id` entirely
-- (never inventing one); an alternative describing a legacy exercise keeps
-- using `ejercicio_id` exactly as today, optionally alongside
-- `exercise_ref_id` once a corresponding reference row exists. This shape
-- cannot be enforced by a CHECK constraint — jsonb array elements have no
-- per-item schema at the Postgres level — so validating it is an
-- importer/application responsibility, documented here as a required future
-- guarantee (see "Invariants deferred to the importer/transaction" below),
-- not one this file can enforce in DDL.
--
-- The future Compatibility Engine resolves any exercise reference — whether
-- supplied as a bare `ejercicio_id`, or as `exercise_ref_id` pointing at
-- exercise_reference — through this same entity/pattern, so it never needs
-- to special-case which table or column supplied the identity.
--
-- These statements are NOT executed by this file and are NOT in scope for
-- GA-001 to apply. They require their own task, their own review, and
-- human approval before any ALTER TABLE runs against a real database.
-- ============================================================================

-- ============================================================================
-- R1-R4 locking analysis (fifth adversarial review round, mandatory
-- concurrent-validation section). No local PostgreSQL instance was available
-- in this environment (verified: no `psql`, `pg_ctl`, or `docker` on PATH) and
-- nothing was run against Supabase, per instructions — this is an explicit,
-- reasoned two-session walkthrough of what row lock each statement acquires,
-- not an assumption of correctness under READ COMMITTED visibility alone.
--
-- R1: snapshot child mutation (Tx A) BEGINS FIRST, vs. snapshot finalization
-- (Tx B) started after.
--   Tx A (e.g. DELETE FROM canonical_exercise_import WHERE id = ...):
--     canonical_exercise_import_immutable fires, calling
--     forbid_mutation_of_completed_snapshot_children(), whose first action is
--     `SELECT status FROM canonical_import_snapshot WHERE id = old.snapshot_id
--     FOR UPDATE`. This acquires an exclusive row lock on that snapshot
--     header row. status is still 'building' at this point, so the delete is
--     allowed to proceed within Tx A (not yet committed).
--   Tx B (finalize_canonical_import_snapshot(p_snapshot_id)):
--     issues `SELECT status ... WHERE id = p_snapshot_id FOR UPDATE`. Because
--     Tx A already holds the row lock on that exact row, Tx B BLOCKS here —
--     it cannot proceed until Tx A commits or rolls back.
--   Resolution: Tx A commits (or rolls back). Only then does Tx B's FOR
--     UPDATE succeed, reading the NOW-COMMITTED state (the delete already
--     applied). validate_snapshot_completion()'s record_count check therefore
--     compares against the post-delete count, not a stale pre-delete one.
--     Invariant preserved: a snapshot can never become complete with a
--     record_count that silently disagrees with its actual, fully-settled
--     child rows.
--
-- R2: snapshot finalization (Tx B) BEGINS FIRST, vs. a child mutation (Tx A)
-- started after.
--   Tx B: finalize_canonical_import_snapshot() takes `FOR UPDATE` on the
--     header row first, then (still inside the same transaction) the
--     `UPDATE ... SET status = 'complete'` re-uses that same held lock.
--   Tx A: attempts a child DELETE; forbid_mutation_of_completed_snapshot_
--     children()'s `FOR UPDATE` on the same header row BLOCKS, because Tx B
--     already holds it.
--   Resolution: if Tx B commits (snapshot now 'complete'), Tx A's FOR UPDATE
--     unblocks, re-reads status as 'complete' (fresh, post-commit), and the
--     function raises — the delete is rejected. If Tx B rolls back instead
--     (e.g. record_count mismatch), Tx A unblocks and sees status still
--     'building', so its delete proceeds normally. Either way, no delete can
--     ever land against a snapshot that is (or is becoming) complete without
--     the delete having a fair, serialized chance to be evaluated against the
--     true final state. Invariant preserved: no interleaving where a
--     completed snapshot's child set silently shrinks after the fact.
--
-- R3: candidate mutation (Tx A) BEGINS FIRST, vs. evaluation finalization
-- (Tx B) started after.
--   Tx A (e.g. DELETE FROM legacy_exercise_evaluation_candidate WHERE id =
--     ...): legacy_exercise_evaluation_candidate_immutable fires, calling
--     forbid_mutation_of_finalized_evaluation_children(), whose first action
--     is `SELECT lifecycle_state FROM legacy_exercise_evaluation WHERE id =
--     old.evaluation_id FOR UPDATE` — an exclusive lock on the parent
--     evaluation row. lifecycle_state is still 'draft', so the delete is
--     allowed to proceed within Tx A (uncommitted).
--   Tx B (finalize_legacy_exercise_evaluation(p_evaluation_id)): issues
--     `SELECT lifecycle_state ... WHERE id = p_evaluation_id FOR UPDATE` on
--     the SAME row Tx A already locked. Tx B BLOCKS until Tx A commits or
--     rolls back.
--   Resolution: once Tx A commits, Tx B's lock succeeds and reads the
--     post-delete candidate set. validate_evaluation_finalization()'s
--     ambiguous->needs->=2-candidates check (see the fix above) therefore
--     counts against the true, settled candidate set, not a stale one.
--     Invariant preserved: an evaluation can never finalize as ambiguous with
--     evidence that a concurrent, earlier-started transaction has already
--     removed.
--
-- R4: evaluation finalization (Tx B) BEGINS FIRST, vs. a candidate mutation
-- (Tx A) started after.
--   Tx B: finalize_legacy_exercise_evaluation() takes `FOR UPDATE` on the
--     evaluation row first; the subsequent `UPDATE ... SET lifecycle_state =
--     'final'` re-uses that held lock.
--   Tx A: attempts a candidate DELETE/UPDATE; forbid_mutation_of_finalized_
--     evaluation_children()'s `FOR UPDATE` on the same evaluation row BLOCKS.
--   Resolution: if Tx B commits (evaluation now 'final'), Tx A unblocks,
--     re-reads lifecycle_state as 'final' (fresh, post-commit), and the
--     function raises — the mutation is rejected, so a finalized evaluation's
--     candidate evidence can never be altered out from under it after the
--     fact. If Tx B rolls back, Tx A unblocks with lifecycle_state still
--     'draft' and proceeds normally. Invariant preserved.
--
-- Why `FOR UPDATE` (exclusive) rather than a weaker mode (`FOR SHARE`/`FOR NO
-- KEY UPDATE`) on the parent row in all four cases: the finalize functions
-- already take `FOR UPDATE` (unchanged from revision 3/4), and PostgreSQL row
-- locks only provide the described serialization when BOTH sides contend for
-- a MUTUALLY EXCLUSIVE mode on the SAME row — a child mutation taking a
-- weaker, compatible lock would be granted immediately even while finalize
-- holds `FOR UPDATE`, reopening exactly this race. Import/evaluation
-- mutation is a low-frequency, human/agent-reviewed operation in this
-- design (not a hot path), so the small amount of extra serialization this
-- introduces between concurrent child mutations on the SAME parent is an
-- acceptable, deliberate trade-off for correctness, not an oversight.
-- ============================================================================

-- ============================================================================
-- Invariants enforced in PostgreSQL by this design vs. deferred to the
-- future importer/transaction (requested explicitly by the second review):
--
-- ENFORCED IN POSTGRES (this file, as designed):
--   - a canonical_import_snapshot can only be INSERTed with status=building
--     (BEFORE INSERT check in validate_snapshot_completion) — COMPLETE can
--     never be supplied on INSERT, only reached via the gated UPDATE below.
--   - raw_export_sha256 and taxonomy_fingerprint are mandatory
--     (NOT NULL check).
--   - content_fingerprint is a GENERATED column (Postgres computes it, not
--     the importer) with a UNIQUE constraint — same content always resolves
--     to the same snapshot row.
--   - the building -> complete transition is gated by a BEFORE INSERT OR
--     UPDATE trigger (validate_snapshot_completion / canonical_import_
--     snapshot_validate_completion) that fires on EVERY insert/update
--     attempting it, not only calls through
--     finalize_canonical_import_snapshot(): record_count is validated
--     against actually-imported canonical_exercise_import rows, a
--     canonical_import_raw_artifact row is required to exist, the exact
--     required taxonomy set (gec1_required_taxonomy_names()) must be
--     present with no missing/extra file, and the declared
--     taxonomy_fingerprint is recomputed from canonical_import_raw_taxonomy
--     and compared. A snapshot cannot reach complete by any INSERT/UPDATE
--     path that skips these checks, and only building -> complete is
--     accepted (not failed -> complete). `completed_at` is unconditionally
--     set to `clock_timestamp()` at that moment — a caller-supplied value is
--     silently overridden, never honored (revision 6).
--   - a complete snapshot's header, its canonical_exercise_import children,
--     its canonical_import_raw_artifact row, and its
--     canonical_import_raw_taxonomy rows all cannot be updated or deleted,
--     and no row can be reparented into or out of a complete snapshot
--     (trigger-enforced, checking both the old and new snapshot_id on
--     UPDATE, each acquiring `FOR UPDATE` on the header row so this cannot
--     race against a concurrent finalization — see "R1-R4 locking analysis"
--     above).
--   - an incomplete snapshot cannot be referenced by
--     legacy_exercise_evaluation or exercise_reference (each has its own
--     direct trigger calling require_complete_snapshot_for_crosswalk()).
--     legacy_exercise_evaluation_candidate has no such trigger of its own;
--     it is protected INDIRECTLY, via the composite FK tying its
--     evaluated_snapshot_id to its parent evaluation's own (already-gated)
--     evaluated_snapshot_id (see the corrected comment above
--     require_complete_snapshot_for_crosswalk(), revision 6).
--   - canonical_exercise_import's projected exercise_id/status columns must
--     be present (not merely equal-if-present — an absent payload key
--     evaluates the naive equality CHECK to NULL, which PostgreSQL treats as
--     satisfied, not violated; fixed in revision 6 by requiring `is not
--     null` explicitly) and match the payload's own values (CHECK
--     constraint); exercise_id must also be non-blank (CHECK). payload's
--     schema_version (present, matching the parent snapshot's
--     library_schema_version) and payload.names.en (present, non-blank) are
--     additionally enforced by a BEFORE INSERT OR UPDATE trigger
--     (validate_canonical_exercise_import_payload(), revision 6), since a
--     cross-table comparison cannot be a same-row CHECK constraint.
--   - legacy_exercise_evaluation is an append-only evaluation/revision ledger,
--     not a mutable row per legacy id: an evaluation can only be INSERTed as
--     draft (BEFORE INSERT check), the draft->final transition is gated by a
--     trigger requiring an `ambiguous` evaluation to have at least TWO
--     candidates (revision 6 — matches this document's own definition of
--     ambiguous as "more than one plausible candidate"; the prior gate only
--     required one), and a final row is fully immutable (UPDATE/DELETE both
--     forbidden by trigger) — a finalized decision cannot be silently
--     rewritten, closing the gap the prior mutable-crosswalk-row design left
--     open. matched/ambiguous evaluations must carry evaluated_by/notes that
--     are both non-null AND non-blank (CHECK constraint, tightened in
--     revision 6 — an empty string is not evidence) and matched must carry a
--     target+confidence (CHECK constraint); the canonical target on both the
--     evaluation and its candidates must actually exist in the evaluated
--     snapshot's own imported payload (composite FK). `finalized_at` is
--     unconditionally set to `clock_timestamp()` at the draft->final
--     transition — a caller-supplied value is silently overridden, never
--     honored (revision 6); combined with the row becoming immutable the
--     instant it is final, the client can never control or later alter this
--     timestamp.
--   - candidate rank must be positive and unique per evaluation (CHECK +
--     UNIQUE), candidates must be linked to the evaluation they belong to
--     under the exact snapshot that evaluation itself was evaluated against
--     (composite FK on (evaluation_id, evaluated_snapshot_id) — this is what
--     makes a candidate silently pointing at the wrong snapshot a structural
--     FK violation, not a trusted invariant), and candidate rows become
--     immutable/append-only the moment their parent evaluation finalizes
--     (trigger-enforced, `FOR UPDATE`-locked against the parent row so this
--     cannot race against a concurrent finalization — see "R1-R4 locking
--     analysis" above) — while still freely editable during drafting.
--   - "current/latest accepted evaluation" per legacy id is a derived view
--     (legacy_exercise_current_evaluation), never a mutated pointer — so
--     creating a new evaluation never touches a prior finalized one.
--     "Never evaluated" (legacy_only), "a draft evaluation exists but has not
--     finalized yet" (draft_in_progress), and "finalized with an outcome"
--     (matched/ambiguous/unmatched) are three distinct, non-collapsing states
--     in legacy_exercise_crosswalk_status (revision 6 — the prior view showed
--     a legacy id with only a draft row identically to one never touched at
--     all).
--   - exercise_reference rows are discriminated (exactly one of
--     legacy/canonical identity per row, CHECK constraint) and deduplicated
--     per legacy/canonical id (partial unique indexes).
--
-- DEFERRED TO THE IMPORTER / TRANSACTION (cannot be guaranteed by DDL alone,
-- stated explicitly rather than silently assumed):
--   - that `raw_export_sha256` was actually computed over the ORIGINAL raw
--     file bytes at source_commit, before any JSON parsing/reformatting —
--     Postgres has no way to independently obtain those original bytes to
--     verify this once content is stored as jsonb (which re-serializes and
--     can change whitespace/key order).
--   - that `raw_export_uri` / `raw_export_raw_taxonomy.raw_uri`, when used
--     instead of an inline payload, actually remain durably reachable and
--     unchanged — Postgres cannot dereference or re-check an external URI.
--   - that the importer inserts every canonical_exercise_import row for a
--     snapshot, and every canonical_import_raw_taxonomy row, BEFORE calling
--     finalize_canonical_import_snapshot() — the function validates counts
--     and the taxonomy fingerprint at that point, but cannot force the
--     importer to have attempted a complete import in the first place.
--   - that a `content_fingerprint` collision on retry is actually
--     handled as "same content, reuse the row" (`ON CONFLICT ... DO
--     NOTHING` + lookup) by the importer, rather than surfacing as an
--     unhandled unique-violation error.
--   - that `rutina_ejercicios.alternativas` JSON array elements follow the
--     `exercise_ref_id`/`ejercicio_id` convention documented above — jsonb
--     array items have no per-element schema Postgres can check.
--   - that a `source='canonical'` `exercise_reference` row without an
--     `evaluated_snapshot_id` (skipping the canonical-target FK check) is
--     only created when the future Compatibility Engine has some other
--     verified basis for trusting that canonical_exercise_id.
-- ============================================================================

-- ============================================================================
-- Explicitly NOT included in this design (out of scope for GA-001):
--   - RLS policies / grants for any of the above tables;
--   - any trigger that makes a MATCHING DECISION (auto-promotes candidates
--     or auto-resolves ambiguity) — every trigger this design includes is
--     either a lifecycle-transition validation gate, an immutability guard,
--     or a completeness/referential check, never a decision. (Revision 5
--     removed the prior copy-on-write audit-log trigger/table entirely — the
--     append-only evaluation ledger itself is now the historical record, so a
--     separate audit log of mutations to a mutable row is no longer needed.)
--   - any FK from canonical_exercise_import/exercise_reference to an
--     external table for canonical identity in general (canonical data has
--     no local table of record beyond GymApp's own pinned snapshots; the
--     Library is the source of truth) — the composite FKs this design does
--     add only check consistency against GymApp's own copy of a specific
--     evaluated snapshot;
--   - population of any row in any of these tables;
--   - the ALTER TABLE statements in "Future additive columns" above;
--   - any change whatsoever to public.ejercicios, public.rutina_ejercicios,
--     public.series_registradas, or public.ejercicio_imagenes.
-- ============================================================================
