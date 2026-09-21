# Legacy Exercise Crosswalk (design)

Status: PROPOSED (design only — no mapping data has been populated, no SQL
has been applied). Companion to `docs/EXERCISE_INTEGRATION_CONTRACT.md` and
`supabase/design/exercise_identity_mapping.sql`.

> **NOT PRODUCTION READY — DO NOT EXECUTE.** GA-001 is closed as the GymApp
> reengineering **design baseline**, not as a production-ready implementation.
> The companion SQL design (`supabase/design/exercise_identity_mapping.sql`)
> must not be applied to any database until HARD-001 through HARD-005 are
> resolved (HARD-001/HARD-002 are blockers before execution; HARD-003 blocks
> reliance on `canonical_exercise_current`; HARD-004/HARD-005 must be resolved
> during implementation hardening). See "Revision 7" in the `Result` section
> of `tasks/done/GA-001-exercise-integration-contract.md` for the full,
> binding list.

Revision note: this document was revised in response to independent review
of `GA-001`. See the "Result" section of
`tasks/review/GA-001-exercise-integration-contract.md` for the point-by-point
response to each round. Revision 3 tightened crosswalk referential
integrity/evidence requirements and replaced the naive additive-columns
proposal for future routine generation with a concrete `exercise_reference`
entity strategy (see "Rules for future routine generation" below) that can
represent an exercise with no legacy `ejercicios` row at all. **Revision 5**
(structural refactor, not a local patch) replaced the mutable
single-row-per-legacy-id crosswalk (`legacy_exercise_crosswalk` +
`legacy_exercise_crosswalk_history`, an audit log of mutations) with a
genuine append-only evaluation/revision ledger
(`legacy_exercise_evaluation` / `legacy_exercise_evaluation_candidate`) —
a fourth adversarial review round found that a finalized `matched` decision
could still be silently rewritten by a plain `UPDATE` under the prior design
(the audit log only recorded that a rewrite happened; it did not prevent
it). See "Representation in the SQL design" below for the updated mapping.
**Revision 6** (fifth adversarial review round, targeted SQL fixes, no
architecture change) tightened `ambiguous` to require at least two
candidates (this document's own definition already said "more than one" —
the SQL under-enforced it), corrected the empty-string evidence gap,
corrected `finalized_at` to be fully server-controlled, closed two race
conditions (candidate mutation vs. evaluation finalization) via row locking,
and distinguished a draft-in-progress evaluation from a legacy ID that has
never been evaluated at all. See "Statuses", "Confidence / evidence
expectations", "Representation in the SQL design", and "Ambiguity" below for
the updated text, and the SQL file's own Revision 6 header banner for the
full list including the two snapshot-side (non-crosswalk) fixes.

## Purpose

Define how a legacy GymApp exercise ID (`ejercicios.id`, `text`) relates to a
canonical `exercise_id` from `Gym-Exercise-Library`, without ever rewriting
the legacy ID in place in `rutina_ejercicios` or `series_registradas`.

## Verified baseline this design must satisfy

- `ejercicios`: 1,464 rows (`docs/CURRENT_STATE_RECONCILIATION.md`).
- Only 65 distinct exercise IDs appear in the `rutina_ejercicios.ejercicio_id`
  *column*, and 11 distinct IDs appear in the `series_registradas.ejercicio_id`
  column (same source; the two sets may overlap but were not confirmed
  identical). These are IDs with real historical weight, but this count is
  known to be incomplete: it does not include legacy IDs embedded inside
  `rutina_ejercicios.alternativas` JSON entries, which also carry historical
  weight. See "Migration sequence" below for why the corrected next step
  captures the exact union before any candidate matching begins, instead of
  treating this 65+11 figure as the complete input set.
- `ejercicios.id`, `rutina_ejercicios.ejercicio_id`, and
  `series_registradas.ejercicio_id` are all `text`
  (`supabase/baseline/schema_snapshot.sql`), matching canonical
  `exercise_id`'s string type — no type conversion is needed, only namespace
  separation (see below).
- 0 of the 1,464 legacy rows have non-empty `contraindicaciones` — there is
  no existing safety metadata to preserve or migrate; nothing is lost by
  representing legacy contraindications as always-unmatched-to-canonical in
  that dimension.
- The canonical catalog currently has 876 records, all `status: draft` /
  `review.status: review_required` (see the integration contract's evidence
  section). This means **no legacy ID can currently reach `matched` with
  high confidence against a mature canonical record** — the crosswalk design
  must still work correctly when the best available canonical candidate is
  itself provisional.

## Mapping semantics

**Revision 5:** a legacy exercise's relationship to the canonical catalog is
recorded as an **append-only ledger of evaluations/revisions**
(`legacy_exercise_evaluation`), not as a single mutable row per legacy ID.
Each evaluation row expresses: "as of `finalized_at`, under contract version
`gec_contract_version`, evidence suggests legacy `ejercicios.id` X
corresponds to canonical `exercise_id` Y with confidence Z" — it is a claim
tied to a specific evaluation attempt, not an identity merge and not a
mutable field on a shared parent row. The legacy ID keeps existing and keeps
being the value stored in `rutina_ejercicios`/`series_registradas` forever,
regardless of crosswalk state.

A legacy `ejercicios.id` may accumulate **many** evaluation rows over time —
one per (re)evaluation. Once an evaluation is finalized, it is immutable; a
reevaluation is always a **new** evaluation row, never a rewrite of a prior
one. The "current" evaluation for a legacy ID is derived (the most recently
finalized one — see `legacy_exercise_current_evaluation` in the SQL design),
not a stored pointer. Ambiguity (one legacy ID plausibly matching multiple
canonical candidates within a single evaluation) is represented separately
as **candidate** rows (1:N per evaluation) — see "Ambiguity" below.

## Statuses (minimum set, per task scope)

Each `legacy_exercise_evaluation` row declares one of:

- `matched` — a single canonical `exercise_id` is confidently identified as
  the same exercise. `canonical_exercise_id` is set; no open candidates
  required.
- `ambiguous` — more than one canonical candidate is plausible and no
  candidate is confidently better than the others. `canonical_exercise_id`
  on the evaluation row is `NULL`; candidates are listed in the candidates
  table, and **at least two** must exist before the evaluation can finalize
  (revision 6 — the SQL previously only required one, which contradicted
  this section's own "more than one" definition; a single plausible
  candidate is a `matched`-or-`unmatched` call, not an ambiguity).
- `unmatched` — actively searched, no acceptable canonical candidate found
  (e.g. the movement doesn't exist yet in the 876-record canonical set).
  `canonical_exercise_id` is `NULL`.

`legacy_only` is **not** a status stored on an evaluation row. It is the
natural, derived state of a legacy ID that has **zero evaluation rows of any
kind** ("not yet evaluated," as opposed to `unmatched`, "evaluated, no match
exists (yet)") — surfaced by the `legacy_exercise_crosswalk_status` view in
the SQL design, which reconstructs the original four-value vocabulary as a
read model over the append-only ledger. Nothing needs to default a new row
to `legacy_only`; the absence of any evaluation row already means that.

**Revision 6 correction:** a legacy ID with a `draft` evaluation that has not
yet finalized is a **third**, distinct state — `draft_in_progress` — not
`legacy_only`. The prior version of `legacy_exercise_crosswalk_status` only
joined against finalized evaluations, so a draft-in-progress row
semantically vanished and looked identical to a legacy ID nobody has ever
looked at. The view now exposes `draft_in_progress` explicitly, plus a
`has_draft_evaluation` column that stays visible even when a final
evaluation already exists (a reevaluation in progress on top of a decided
legacy ID).

## Confidence / evidence expectations

- `confidence`: `low` / `medium` / `high`, mirroring the vocabulary the
  Library itself already uses for `review.confidence` in
  `exercise.schema.json`, so a human reviewing both systems doesn't have to
  learn two scales.
- `high` requires matching on more than name similarity: equipment
  (`ejercicios.equipo` vs `setup.equipment_required`/`equipment_optional`)
  and muscle group (`ejercicios.grupo_muscular` vs
  `classification.body_regions`/`primary_muscles`) must also agree, not just
  a name string match.
- `medium` is a strong name/equipment match without full muscle-group
  corroboration (expected to be common, since legacy `grupo_muscular` uses a
  mixed/inconsistent taxonomy per `docs/CURRENT_STATE_RECONCILIATION.md`).
- `low` is a plausible but weak match (name similarity only, or matched
  against a canonical record that is itself `status: draft` with
  `review.confidence: low` — confidence does not exceed the weaker of the
  two sides being compared).
- Every `matched` or `ambiguous` evaluation must record `notes` explaining
  the evidence (what was compared, not just "looks similar") and
  `evaluated_by` (human name/handle or agent identity) — enforced as
  non-null **and non-blank** (revision 6: an empty or whitespace-only string
  previously passed the "is not null" check, which is presence of a value in
  name only, not evidence). `finalized_at` is set automatically, by
  PostgreSQL itself (`clock_timestamp()`), the instant the evaluation locks;
  a caller-supplied `finalized_at` is silently overridden, never honored
  (revision 6 — the prior implementation respected a caller-supplied value
  whenever one was given), and the row becomes fully immutable at that same
  moment, so this timestamp can never be set or altered by a client at any
  point. Confidence without recorded evidence is not acceptable for
  `matched`.

## Representation in the SQL design (invariant → column/table)

**Explicit mapping, so this document and
`supabase/design/exercise_identity_mapping.sql` cannot drift apart
silently.** Revision 5 replaced the mutable-row-plus-audit-log design
(`legacy_exercise_crosswalk` / `legacy_exercise_crosswalk_candidates` /
`legacy_exercise_crosswalk_history`) with an append-only evaluation/revision
ledger, because a fourth adversarial review round demonstrated that a
finalized `matched` decision could still be silently rewritten by a plain
`UPDATE` under the prior design:

| Invariant (this document) | SQL representation |
|---|---|
| One row per (re)evaluation, not one mutable row per legacy ID | `legacy_exercise_evaluation` — a legacy ID may have many evaluation rows over time; a reevaluation is always a new row |
| Evidence for a match | `legacy_exercise_evaluation.notes` (free text: what was compared) |
| Who reviewed | `legacy_exercise_evaluation.evaluated_by`; `finalized_at` is set automatically, by PostgreSQL (`clock_timestamp()`), the instant the evaluation locks — never a caller-supplied value (revision 6) |
| Evidence required for `ambiguous`, not just `matched` | `legacy_exercise_evaluation_evidence_required_check` CHECK — `evaluated_by`/`notes` are required for both `matched` and `ambiguous`, and must be non-blank, not merely non-null (revision 6) |
| Candidates (1:N ambiguity) belong to exactly one evaluation | `legacy_exercise_evaluation_candidate.evaluation_id` (FK), not a mutable legacy parent |
| Ranking among candidates | `legacy_exercise_evaluation_candidate.rank`, required positive (`rank > 0`) and unique per `evaluation_id` |
| Which canonical snapshot was evaluated | `legacy_exercise_evaluation.evaluated_snapshot_id` / `legacy_exercise_evaluation_candidate.evaluated_snapshot_id`, both FKs to `canonical_import_snapshot`, `NOT NULL` on every evaluation row (there is no "legacy_only" evaluation row — see "Statuses" above). `legacy_exercise_evaluation` itself is gated **directly** by trigger (`require_complete_snapshot_for_crosswalk`) to reference a **complete** snapshot only; `legacy_exercise_evaluation_candidate` has no such trigger of its own — it is protected **indirectly**, because its composite FK (next row) forces its `evaluated_snapshot_id` to equal its already-gated parent evaluation's own value (corrected in revision 6 — the prior wording of this row implied a direct trigger on the candidate table, which does not exist) |
| Candidates must be linked to the same evaluated snapshot as their parent evaluation | `legacy_exercise_evaluation_candidate_evaluation_fk`, a composite FK on `(evaluation_id, evaluated_snapshot_id)` into `legacy_exercise_evaluation (id, evaluated_snapshot_id)` — a candidate cannot silently claim a different snapshot than its own parent evaluation |
| A claimed canonical target must actually exist in the evaluated snapshot's own imported payload | Composite FK `(evaluated_snapshot_id, canonical_exercise_id)` → `canonical_exercise_import (snapshot_id, exercise_id)`, on both `legacy_exercise_evaluation` and `legacy_exercise_evaluation_candidate` |
| History / auditability | The append-only ledger itself: every evaluation row that was ever finalized remains queryable forever, in full, with its own candidates and evidence. No separate audit-log table is needed (revision 5 removed `legacy_exercise_crosswalk_history`, whose copy-on-write trigger recorded that a mutation happened but never prevented it). |
| A finalized decision must not be silently overwritten | `legacy_exercise_evaluation_immutable` (trigger) forbids `UPDATE`/`DELETE` once `lifecycle_state = 'final'`; `legacy_exercise_evaluation_candidate_immutable` forbids the same on a finalized evaluation's candidates. Reevaluation is a new evaluation row (crosswalk requirements 1–2) |
| Ambiguous evaluations must have candidates before they can be treated as decided | `validate_evaluation_finalization()` (trigger) rejects the draft→final transition for an `ambiguous` evaluation with fewer than **two** candidate rows (revision 6; previously fewer than one) — a real, enforced gate, not a reconciliation query run after the fact (crosswalk requirement 8) |
| Candidate mutation cannot race a concurrent finalization (nor vice versa) | Both `forbid_mutation_of_finalized_evaluation_children()` (candidate side) and `finalize_legacy_exercise_evaluation()` (evaluation side) take a `FOR UPDATE` row lock on the same `legacy_exercise_evaluation` row before reading its lifecycle state, so the two can never interleave (revision 6 — see "R1-R4 locking analysis" in the SQL file) |
| "Current" evaluation per legacy ID, without mutating history | `legacy_exercise_current_evaluation` view — the most recently finalized evaluation per legacy ID, derived, never a stored pointer (crosswalk requirement 6) |
| Consistency per status (`matched` requires a target+confidence; every other status requires none) | `legacy_exercise_evaluation_matched_requires_target` CHECK constraint |
| Succession after Library deprecation/rename | `legacy_exercise_evaluation.superseded_by_exercise_id` (free-text pointer, not a FK — see "Canonical exercise identifier semantics" in the contract document for why this cannot be a verified Library-confirmed relationship) |

## Rules for historical records

- `rutina_ejercicios.ejercicio_id` and `series_registradas.ejercicio_id` are
  never rewritten to a canonical ID, ever — not even after a `matched` row
  exists with `high` confidence. Historical display resolves through
  `ejercicios` (unchanged) optionally enriched by joining the crosswalk for
  UI purposes (e.g. "this maps to canonical exercise Y, which now has a
  video") — enrichment, not replacement.
- If a matched canonical record is later marked `deprecated` by the Library,
  the crosswalk row is **not** deleted or reset to `unmatched`; it keeps
  recording history ("this legacy exercise was matched to X, which the
  Library has since deprecated"). `superseded_by_exercise_id` (a dedicated
  column, not just free text in `notes` — see the SQL design) can point at a
  replacement candidate for *future* work, but that is a manual follow-up, a
  GymApp-local claim, not something read automatically by anything, and not
  a confirmed Library-side relationship (see "Canonical exercise identifier
  semantics: confirmed vs proposed" in `docs/EXERCISE_INTEGRATION_CONTRACT.md`).

## Rules for future routine generation

- Until the compatibility engine described in
  `docs/REENGINEERING_DECISION_FRAME.md` exists, routine generation keeps
  using the legacy `ejercicios` catalog exactly as it does today — this task
  does not change `generate-routine`/`regenerate-day` behavior.
- Once that engine exists, **new** routines should be generated from
  canonical IDs directly (not routed through the crosswalk), because new
  routines have no historical-ID constraint. The crosswalk only matters for
  *interpreting or displaying* exercises that already exist in historical
  routines/sessions.
- **Chosen strategy for future exercise reference (revision 3, replacing a
  prior naive proposal):** a second review round correctly flagged that a
  bare, nullable `canonical_exercise_id` column alongside the existing
  `ejercicio_id text not null` column cannot represent a **canonical-only
  exercise** — one that has never existed in `public.ejercicios` and never
  will via an invented legacy row (explicitly forbidden) — because
  `ejercicio_id` would still be required on every row. The chosen fix is a
  local indirection **entity**, `public.exercise_reference` (see
  `supabase/design/exercise_identity_mapping.sql`), discriminated by a
  `source` column (`legacy` | `canonical`) with a CHECK enforcing exactly
  one of `legacy_ejercicio_id` / `canonical_exercise_id` is set per row —
  chosen over repeating that discriminated triple as inline columns on
  every consuming table, so the invariant lives in one place and the future
  Compatibility Engine gets a single join target regardless of which
  namespace a reference came from.

  This covers all four required cases:
  - **(A) historical records** continue resolving exactly their current
    legacy IDs: `rutina_ejercicios.ejercicio_id` /
    `series_registradas.ejercicio_id` are never touched or rewritten for any
    existing row.
  - **(B) new records during the transition** may reference legacy or
    canonical identity without mixing namespaces: a new row may keep simply
    setting `ejercicio_id` (as today, for a legacy exercise — no
    `exercise_reference` row required for this case), or may set a new,
    nullable `exercise_ref_id` column pointing at an `exercise_reference`
    row of either `source`. `exercise_ref_id` is always a UUID pointing at
    the reference entity; no column ever holds a raw canonical
    `exercise_id` string directly outside `canonical_exercise_import`,
    `legacy_exercise_evaluation`, and `exercise_reference` itself.
  - **(C) canonical-only exercises** are represented by an
    `exercise_reference` row with `source = 'canonical'` and
    `exercise_ref_id` set, with `ejercicio_id` left `NULL` — which requires
    proposing (not applying) `ALTER TABLE ... ALTER COLUMN ejercicio_id DROP
    NOT NULL` on `rutina_ejercicios`/`series_registradas`, the one part of
    this proposal that is not purely additive, explicitly flagged as such
    in the SQL design, together with a new CHECK requiring every row to
    carry at least one identity path (`ejercicio_id is not null or
    exercise_ref_id is not null`). No legacy row is ever invented.
  - **(D) the future Compatibility Engine** resolves any reference —
    whether a bare `ejercicio_id` or an `exercise_ref_id` — through the same
    entity/pattern, without special-casing which table or column supplied
    the identity.

  `rutina_ejercicios.alternativas` gets the equivalent treatment at the JSON
  level: a new, optional `exercise_ref_id` key inside each alternative
  object, alongside the existing `ejercicio_id`/`nombre`/`equipo`/`motivo`
  keys; a canonical-only alternative omits `ejercicio_id` entirely instead
  of inventing one. This cannot be enforced by a CHECK constraint (jsonb
  array elements have no per-item schema), so it is documented as a required
  importer/application-level guarantee, not a DB-enforced one — see
  "Future additive columns" and "Invariants deferred to the importer/
  transaction" in `supabase/design/exercise_identity_mapping.sql`.

  None of this is applied by GA-001; it is a design proposal for the task
  that builds the Compatibility Engine's write path.
- The crosswalk must never be used to silently substitute a canonical
  exercise for a legacy one inside an existing, already-generated routine
  without an explicit user-facing substitution action (GymApp already has a
  first-class "alternatives" concept in `rutina_ejercicios.alternativas`;
  any future canonical-backed substitution should go through that existing
  mechanism, not bypass it).

## Ambiguity (one-to-many / many-to-one)

- **One legacy ID, multiple canonical candidates** (e.g. a legacy "Press de
  banca" row could plausibly match several canonical bench-press variants):
  status `ambiguous` on the evaluation row; each candidate is a separate row
  in `legacy_exercise_evaluation_candidate` with its own `confidence`,
  `rank`, and `notes`. Resolution to `matched` requires a human or agent
  explicitly finalizing a **new** evaluation row with `match_status =
  'matched'` (the prior `ambiguous` evaluation and its candidates are never
  rewritten — they remain as history; the candidate rows are not
  auto-promoted).
- **Multiple legacy IDs, one canonical candidate** (e.g. several legacy rows
  that are effectively duplicates of the same movement): this is allowed —
  `canonical_exercise_id` is not unique across `legacy_exercise_evaluation`.
  Each legacy ID keeps its own independent evaluation history; there is no
  merge of the legacy IDs themselves, because each may carry distinct historical
  routine/session references that must stay resolvable independently.

## Migration sequence (never rewrites historical identity in place)

**MAJOR correction from the prior revision of this document:** step 2 below
previously proposed going straight to a candidate-matching tool against "the
~76 historically-referenced legacy IDs." Review correctly identified that
this count and its input set were never actually captured as a reproducible
artifact — the ~76 figure (65 distinct IDs in `rutina_ejercicios` + 11 in
`series_registradas`, overlap unconfirmed, per `docs/CURRENT_STATE_RECONCILIATION.md`)
counted only the `ejercicio_id` *column* on those two tables. It did **not**
account for legacy IDs embedded inside `rutina_ejercicios.alternativas`
(a `jsonb` array where each element carries its own `ejercicio_id` — see
`app.js`'s `usarAlternativa`/`agregarAlternativaManual` and
`generate-routine/index.ts`'s `alternativas` handling). Those embedded IDs
are also historically-referenced: a user may have already used "Ver
alternativas" to switch to one, or one may simply be displayed to a user
today, so a candidate generator that ignores them would produce an
incomplete crosswalk. No live database access exists in this session, so
the exact size of that additional set is genuinely unknown — this document
does not fabricate a number for it.

1. **Now (GA-001):** contract and crosswalk *design* only. No data touched.
2. **Next task (replaces the prior revision's candidate-generator
   proposal): a read-only legacy reference snapshot and ID census.**
   Before any matching happens, capture:
   - a versioned, reproducible snapshot of the full `ejercicios` table
     (1,464 rows), saved as a timestamped/hashed file, with the exact
     read-only query used recorded alongside it (mirroring
     `canonical_import_snapshot`'s pinning discipline on the canonical
     side, so both sides of the crosswalk are equally reproducible);
   - the exact, deduplicated union of every legacy `ejercicio_id`
     referenced anywhere with historical weight:
     `rutina_ejercicios.ejercicio_id`, `series_registradas.ejercicio_id`,
     **and every `ejercicio_id` embedded inside every
     `rutina_ejercicios.alternativas` JSON array element**;
   - a per-ID reference-count breakdown by source (routine slot vs. logged
     set vs. embedded alternative), so later prioritization is evidence-based
     rather than assumed.
   This step is read-only queries only: no writes to any table, no
   matching/heuristics yet, no application code changes. Its output is what
   makes the *following* candidate-generation step well-defined.
3. **Candidate generation** (now correctly sequenced after step 2, not
   instead of it): an offline, read-only tool proposes crosswalk candidates
   (not applying anything) for the exact ID union step 2 captured, using
   name + equipment + muscle-group heuristics against a specific, pinned
   `canonical_import_snapshot`. Output is a reviewable file, not a DB write.
4. **Human/agent review pass:** reviewed candidates get applied as a new
   `legacy_exercise_evaluation` row per legacy ID (draft, then finalized via
   `finalize_legacy_exercise_evaluation()`), with, for ambiguous cases, its
   own `legacy_exercise_evaluation_candidate` rows — additive only, never
   touching `ejercicios`, `rutina_ejercicios`, or `series_registradas`.
5. **Expand coverage incrementally** to the remaining legacy rows
   (`legacy_only` → `matched`/`ambiguous`/`unmatched`), prioritized by
   nothing more urgent than "does it appear in `rutina_ejercicios`,
   `series_registradas`, or an `alternativas` entry" — the remaining unused
   rows can stay `legacy_only` indefinitely without blocking anything.
6. **Only after** the compatibility engine and a `GEC-*` contract revision
   confirm canonical data is trustworthy enough (i.e. records reach
   `status: approved`, not just `draft`) does GymApp begin sourcing *new*
   routine candidates from canonical IDs directly, via the
   `exercise_reference` entity and `exercise_ref_id` columns proposed (not
   applied) in the SQL design — including, for the first time, exercises
   that have no legacy `ejercicios` row at all (see "Rules for future
   routine generation" above). This does not require finishing the
   crosswalk for legacy rows with no historical usage.
7. `ejercicios` is never dropped, replaced, or truncated at any step in this
   sequence. It remains the resolvable source for all historical
   `rutina_ejercicios`/`series_registradas` rows permanently, matching
   `AGENTS.md`'s "do not remove or replace legacy GymApp exercise IDs"
   rule.
