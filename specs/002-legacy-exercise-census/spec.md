# Feature Specification: Legacy Exercise Reference Census

**Feature Branch**: `002-legacy-exercise-census`

**Created**: 2026-10-02

**Status**: Draft

**Input**: User description: "Legacy exercise reference census (read-only). This is the 'next implementation step' explicitly defined in docs/LEGACY_EXERCISE_CROSSWALK.md's 'Migration sequence' step 2, as a prerequisite to the legacy-to-canonical crosswalk described in that document and docs/EXERCISE_INTEGRATION_CONTRACT.md — NOT the full crosswalk schema itself, which remains blocked (HARD-001 through HARD-005 unresolved, explicitly marked 'NOT PRODUCTION READY — DO NOT EXECUTE' in both documents). Produce a reproducible, read-only snapshot and ID census that becomes the well-defined input for a future candidate-matching step."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reproducible snapshot of the legacy exercise catalog (Priority: P1)

A developer (human or agent) who is about to start matching legacy exercises
against the canonical Gym-Exercise-Library needs a trustworthy, point-in-time
copy of the entire legacy `ejercicios` catalog, captured in a way that can be
regenerated and independently verified later — mirroring the pinning
discipline already used on the canonical (Library) side of this integration.

**Why this priority**: Without a pinned, reproducible snapshot, any later
matching work is built on a moving target — the legacy catalog could change
between when it was inspected and when it was actually used, and nobody could
prove what was looked at.

**Independent Test**: Run the census tool against the current database and
confirm the output snapshot file contains every row of `ejercicios` (matching
a direct `SELECT COUNT(*) FROM ejercicios` at the same point in time), along
with the exact query text and a timestamp/hash that lets a reviewer verify
the snapshot was not hand-edited.

**Acceptance Scenarios**:

1. **Given** the production `ejercicios` table has N rows, **When** the
   census tool runs, **Then** the produced snapshot file contains exactly N
   rows and records the read-only query used to produce it.
2. **Given** a snapshot file already exists from a prior run, **When** the
   census tool runs again with no underlying data changes, **Then** the new
   snapshot is content-identical to the prior one (same row data, a fresh
   timestamp/hash only reflecting the new run), so a reviewer can confirm
   nothing drifted.

---

### User Story 2 - Complete, deduplicated census of historically-referenced legacy IDs (Priority: P1)

A developer needs to know, with evidence rather than assumption, exactly
which legacy exercise IDs actually matter for the crosswalk — i.e. which ones
carry real historical weight because a user's routine, a logged set, or a
saved alternative already references them. The design documents flag that a
prior estimate (~76 IDs) undercounted this because it ignored IDs embedded
inside `rutina_ejercicios.alternativas` JSON entries.

**Why this priority**: The entire point of this feature is to replace an
unverified guess with a real, reproducible number before any matching work
begins — this is the evidence a future candidate-matching step depends on
being correct and complete.

**Independent Test**: Run the census tool and confirm it reports the
deduplicated union of IDs from all three sources (routine slots, logged
sets, embedded alternatives), with the total distinct count visibly larger
than or equal to the previously-recorded ~76-ID estimate (since that
estimate is known to have missed the third source).

**Acceptance Scenarios**:

1. **Given** a legacy exercise ID appears only in `rutina_ejercicios.ejercicio_id`,
   **When** the census runs, **Then** that ID appears in the output with its
   source correctly attributed to "routine slot."
2. **Given** a legacy exercise ID appears only inside a
   `rutina_ejercicios.alternativas` JSON array element and nowhere else,
   **When** the census runs, **Then** that ID still appears in the output,
   attributed to "embedded alternative" — this is the gap the prior estimate
   missed.
3. **Given** a legacy exercise ID appears in more than one of the three
   sources, **When** the census runs, **Then** the ID appears exactly once
   in the deduplicated list, with its reference count broken down by every
   source that contributed.

---

### User Story 3 - Evidence-based prioritization input (Priority: P2)

A developer deciding which legacy IDs to match against the canonical catalog
first needs a per-ID reference count, so the most-used exercises (the ones
most likely to affect real users if mismatched) can be prioritized over
rarely-used ones.

**Why this priority**: This is what makes the census actionable rather than
just descriptive — it directly feeds the "expand coverage incrementally,
prioritized by usage" step the design documents already call for.

**Independent Test**: Pick any legacy ID known to appear in multiple routine
slots and logged sets; confirm the census output's count for that ID matches
a manual count against the database for the same point in time.

**Acceptance Scenarios**:

1. **Given** the underlying data, **When** the census runs, **Then** every
   referenced legacy ID in the output has a non-zero total reference count
   and a visible breakdown by source (routine slot / logged set / embedded
   alternative).
2. **Given** the output is sorted or filterable by reference count,
   **When** a developer reviews it, **Then** they can identify the
   highest-impact legacy IDs without writing a new query themselves.

---

### Edge Cases

- What happens when `rutina_ejercicios.alternativas` is `NULL` or an empty
  array for a row? The census must treat it as contributing zero embedded
  IDs for that row, not error out or skip the row's other data.
- What happens when a legacy ID appears in `alternativas` but no longer
  exists in `ejercicios` (e.g. a historical reference to since-removed data)?
  The census must still record the reference — it is about what is actually
  referenced, not about validating that every reference is currently
  resolvable. This gap itself is useful information for a future reviewer.
- What happens if the census is run twice in a row with no data changes?
  The row/reference counts must be identical between runs (see User Story 1,
  Scenario 2) — only the run timestamp/hash should differ.
- What happens if `ejercicios` has more or fewer rows than the ~1,464
  previously recorded in `docs/CURRENT_STATE_RECONCILIATION.md`? The census
  must report the actual current count, not assume or hard-code the prior
  figure — that figure was a point-in-time observation, not a fixed target.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The census MUST produce a snapshot of every row in the legacy
  `ejercicios` table, capturing the full row contents as they exist at the
  moment the snapshot is taken.
- **FR-002**: The snapshot output MUST record the exact read-only query used
  to produce it, so a reviewer can independently reproduce or verify it.
- **FR-003**: The snapshot output MUST be timestamped and content-addressed
  (e.g. a hash of its contents), so two runs over unchanged data can be
  confirmed identical and a run over changed data is visibly different.
- **FR-004**: The census MUST compute the deduplicated union of every legacy
  `ejercicio_id` referenced in `rutina_ejercicios.ejercicio_id`,
  `series_registradas.ejercicio_id`, and every `ejercicio_id` embedded inside
  any element of any `rutina_ejercicios.alternativas` JSON array.
- **FR-005**: For every legacy ID in that union, the census MUST report a
  reference count broken down by which of the three sources (routine slot,
  logged set, embedded alternative) contributed it, and the total count
  across all sources.
- **FR-006**: The census MUST NOT write, update, or delete any row in any
  table — it performs read-only (`SELECT`-only) queries exclusively.
- **FR-007**: The census MUST NOT introduce any new database schema, table,
  or column.
- **FR-008**: The census MUST NOT change the behavior of `generate-routine`,
  `regenerate-day`, or `app.js` in any way.
- **FR-009**: The census's output artifact(s) MUST be committed to the
  GymApp repository (not left as an ephemeral query result), so the census is
  reproducible by any future developer or agent without re-deriving it from
  scratch.
- **FR-010**: The tool that produces the census MUST be runnable again later
  (e.g. after the legacy catalog changes), producing an updated snapshot
  without manual, one-off query construction each time.

### Key Entities *(include if feature involves data)*

- **Legacy exercise snapshot**: A point-in-time, reproducible copy of the
  full `ejercicios` table, plus the query used to produce it and a
  timestamp/content hash. Read-only output artifact; not a new database
  table.
- **Legacy ID reference census**: The deduplicated list of legacy
  `ejercicio_id` values that are referenced anywhere with historical weight,
  each with a per-source reference count (routine slot / logged set /
  embedded alternative) and a total. Read-only output artifact; not a new
  database table.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can determine the exact, current, reproducible
  count of legacy exercise IDs that require crosswalk attention — replacing
  a previously unverified ~76-ID estimate — without writing any new SQL
  themselves.
- **SC-002**: Running the census twice against unchanged data produces
  identical row and reference-count data both times, demonstrating the
  output is a faithful, non-lossy reflection of the database rather than an
  approximation.
- **SC-003**: Zero rows are written, updated, or deleted in any table as a
  result of running the census, confirmed by comparing table row counts
  before and after the run.
- **SC-004**: The existing `generate-routine`, `regenerate-day`, and
  `app.js` behavior is unchanged after this feature is merged, confirmed by
  the existing automated test suite passing with no new failures.

## Assumptions

- This feature targets the production Supabase project
  (`ibjbbisbyygbuqemobir`) as a read-only data source, consistent with
  `AGENTS.md`'s rule that GitHub is the source of truth for code but the
  deployed database is the runtime target being inspected — no schema or
  data changes are made to it.
- The census tool is a standalone, offline script (not a new Edge Function
  and not part of the running application), consistent with the project's
  existing `tools/sync-exercise-library.mjs` pattern for similar read-only,
  reproducible-output tasks.
- "Historical weight" is defined exactly as the design documents define it:
  any reference in `rutina_ejercicios.ejercicio_id`,
  `series_registradas.ejercicio_id`, or embedded in
  `rutina_ejercicios.alternativas` — no other table or column is assumed to
  carry historical weight unless a future revision of the design documents
  says otherwise.
- This feature does not decide what happens to legacy IDs that turn out to
  have zero references anywhere (`legacy_only` in the design documents'
  vocabulary) — per the migration sequence, those may remain unmatched
  indefinitely without blocking anything, and no action is required for them
  by this feature.
- Candidate matching against the canonical Gym-Exercise-Library catalog,
  and any new database schema for recording match decisions, are explicitly
  out of scope for this feature and are left for a future feature once this
  census exists.
