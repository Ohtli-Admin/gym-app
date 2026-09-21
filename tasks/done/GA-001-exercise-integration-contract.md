# [GA-001] Define canonical exercise integration contract

- **Status:** DONE — DESIGN BASELINE / IMPLEMENTATION HARDENING REQUIRED
- **Agent/Owner:** Claude Code (claude-sonnet-5)

## Objective

Define the versioned consumer contract by which GymApp will consume canonical exercise identity and objective exercise metadata from `Ohtli-Admin/Gym-Exercise-Library`, and define the legacy-to-canonical identity mapping needed to preserve existing GymApp history.

This task must produce an implementable contract and mapping design. It must not migrate production data.

## Context

Read before starting:

- `AGENTS.md`
- `docs/CURRENT_STATE_RECONCILIATION.md`
- `docs/REENGINEERING_DECISION_FRAME.md`
- `docs/CLAUDE_WEB_HANDOFF.md`

Verified baseline facts:

- GymApp production currently has 1,464 legacy `ejercicios` rows.
- Existing `rutina_ejercicios` and `series_registradas` reference legacy exercise IDs.
- Only a subset of legacy IDs has historical use, so historical references must remain resolvable.
- The current legacy catalog has mixed taxonomies and no populated exercise-level contraindication data.
- Gym-Exercise-Library is a separate repository and is the canonical owner of objective exercise identity, taxonomy, provenance and media.
- Gym-Exercise-Library currently exposes a canonical catalog/export; GymApp must consume a stable versioned contract rather than depend on that repository's internal directory layout.

## Scope

1. Inspect the current GymApp schema and all code paths that read/write `ejercicios`, `rutina_ejercicios.ejercicio_id`, `series_registradas.ejercicio_id`, and `ejercicio_imagenes`.
2. Inspect the current consumer-facing canonical export/model in `Ohtli-Admin/Gym-Exercise-Library`. If that repository is not locally available, use GitHub read access if available; otherwise mark the exact evidence that could not be inspected and do not invent it.
3. Create `docs/EXERCISE_INTEGRATION_CONTRACT.md` defining:
   - ownership boundary between Gym-Exercise-Library and GymApp;
   - canonical exercise identifier semantics;
   - contract/version identifier;
   - minimum fields GymApp needs from the Library for the first integration slice;
   - which fields remain GymApp-owned;
   - compatibility/backward-compatibility expectations;
   - how GymApp detects/imports a newer Library contract;
   - behavior for canonical records that are removed/deprecated/renamed;
   - media reference semantics without coupling GymApp to Library internals.
4. Create `docs/LEGACY_EXERCISE_CROSSWALK.md` defining:
   - mapping semantics from a legacy GymApp exercise ID to a canonical Library ID;
   - statuses at minimum: `matched`, `ambiguous`, `unmatched`, `legacy_only`;
   - confidence/evidence expectations;
   - rules for historical records;
   - rules for future routine generation;
   - handling of one-to-many/many-to-one ambiguity;
   - a migration sequence that never rewrites historical identity in place.
5. Create a proposed, non-production SQL design at `supabase/design/exercise_identity_mapping.sql` for the mapping/import layer. It must be explicitly marked DESIGN ONLY / DO NOT APPLY. Prefer additive tables/columns and preserve all existing legacy data.
6. Document the exact first implementation step that should follow GA-001.

## Out of scope

- Applying any SQL to Supabase.
- Deploying Edge Functions.
- Modifying `app.js`, `index.html`, `styles.css`, or production behavior.
- Replacing or deleting `public.ejercicios`.
- Rewriting IDs in `rutina_ejercicios` or `series_registradas`.
- Populating the full crosswalk.
- Refactoring the routine generator.
- Building the compatibility engine.
- UI/UX redesign.
- Media generation or media migration.
- Inventing medical/safety rules.

## Acceptance criteria

- [x] The Gym-Exercise-Library → GymApp ownership boundary is explicit and consistent with `AGENTS.md`.
- [x] A versioned consumer contract is specified without direct dependency on Library repository internals.
- [x] The minimum canonical exercise fields required by GymApp are enumerated and justified.
- [x] Legacy IDs remain valid and resolvable for all historical GymApp records.
- [x] Mapping statuses and ambiguity rules are explicit.
- [x] The proposed SQL is additive, reversible at design level, and clearly marked as not executable against production yet.
- [x] No production system, application behavior, or existing database file is modified.
- [x] The design supports incremental migration: historically referenced legacy IDs can be mapped before the entire 1,464-row legacy catalog.
- [x] The next implementation task is concrete enough to be created without another architecture-discovery round.
- [x] The task result records inspected evidence, unresolved questions, files changed, and validation performed.

## Allowed files/areas

- `docs/EXERCISE_INTEGRATION_CONTRACT.md` (new)
- `docs/LEGACY_EXERCISE_CROSSWALK.md` (new)
- `supabase/design/exercise_identity_mapping.sql` (new)
- this task file, only to update status/owner/result

Existing source/application files may be read but not modified.

## Dependencies

- Reconciled baseline documentation already present in this branch.
- Shared agent rules in `AGENTS.md`.
- Read access to Gym-Exercise-Library is desirable for exact contract inspection. If unavailable, do not fabricate details; record the blocker/evidence gap.

## Required validations

- Verify branch and clean/expected working tree before work.
- Cross-check every proposed legacy FK/column/table reference against the current captured GymApp schema.
- Cross-check every claimed canonical field against the actual current Gym-Exercise-Library consumer export/model when accessible.
- Review the final diff for scope compliance.
- No production validation/deployment is required or permitted.

## Result

### Revision 2 — response to independent review (REQUEST_CHANGES)

An independent review (Codex) returned `REQUEST_CHANGES` on revision 1 of
this task's deliverables: 2 BLOCKER, 6 MAJOR, 2 MINOR findings, plus three
"además" items. All were addressed by revising the three deliverable files
in place (`docs/EXERCISE_INTEGRATION_CONTRACT.md`,
`docs/LEGACY_EXERCISE_CROSSWALK.md`,
`supabase/design/exercise_identity_mapping.sql`); this task file's status
remains `REVIEW` per instructions, no SQL was executed, no application file
was touched, nothing was committed or pushed, and GA-002 was not created.

1. **BLOCKER — taxonomies consumed without versioning:** added a "Taxonomy
   versioning" section to the contract doc and a new
   `canonical_import_snapshot.taxonomy_snapshot` jsonb column (sha256 +
   record count per `taxonomy/*.json` file) plus
   `canonical_exercise_import.field_completeness` to the SQL design. Verified
   directly that `taxonomy/*.json` in `Gym-Exercise-Library` are bare, unversioned
   JSON arrays (checked all 9 files) — this is why GymApp must pin them itself.
2. **BLOCKER — `canonical_exercise_import` was not a coherent snapshot:**
   redesigned the SQL as a two-level structure: an immutable
   `canonical_import_snapshot` header (required `source_commit`, `record_count`,
   `taxonomy_snapshot`) that every `canonical_exercise_import` row now has a
   mandatory FK to, with a `unique (snapshot_id, exercise_id)` constraint for
   idempotency, plus a documented removal/deprecation-detection query that
   diffs two snapshots.
3. **MAJOR — `exercise_id` permanence asserted without upstream evidence:**
   the contract doc's identifier-semantics section is now split into
   "Confirmed" (verified directly against `exercise.schema.json`) and
   "Proposed / GymApp-side policy" (explicitly labeled as GymApp's own
   assumption pending upstream confirmation, not fact). Grepped
   `Gym-Exercise-Library`'s `docs/DECISIONS.md`, `ARCHITECTURE.md`,
   `PROJECT_STATE.md`, `ROADMAP.md` for any stability/rename/permanence
   guarantee — found none. Added `superseded_by_exercise_id` (free text, not
   a FK) on `legacy_exercise_crosswalk` for GymApp-local succession claims
   instead of asserting Library-side rename semantics.
4. **MAJOR — no additive path for future routines/alternatives/series to
   reference canonical identity:** added a "Future additive columns" section
   to the SQL design (proposed, unapplied `ALTER TABLE ... ADD COLUMN
   canonical_exercise_id` on `rutina_ejercicios`/`series_registradas`, both
   nullable, existing legacy columns untouched) and documented an additive
   `canonical_exercise_id` key convention for `rutina_ejercicios.alternativas`
   JSON entries (verified the existing key shape against `app.js`'s
   `usarAlternativa`/`agregarAlternativaManual` and the LLM output schema in
   `generate-routine/index.ts`, which has no `additionalProperties: false`
   on alternative items, so adding a key is safe).
5. **MAJOR — crosswalk invariants not coherently represented in SQL:** added
   an explicit "Representation in the SQL design (invariant → column/table)"
   table to the crosswalk doc; added `evaluated_snapshot_id` (FK, enforced
   NOT NULL for every status except `legacy_only` via a new CHECK
   constraint) to both the crosswalk and candidates tables; added
   `legacy_exercise_crosswalk_history` populated by a pure audit-logging
   trigger (not a business-logic trigger, so it doesn't conflict with the
   existing "no auto-promotion" exclusion); documented a cross-table
   reconciliation query for the one invariant (ambiguous rows should have
   candidates) that Postgres CHECK constraints cannot express.
6. **MAJOR — GA-002 could not yet be the candidate generator:** retracted
   the "Proposed next implementation task" below and replaced it in the
   crosswalk doc's "Migration sequence" with a read-only legacy
   reference-snapshot-and-census task. Confirmed the original ~76-ID count
   only covered the `ejercicio_id` *column* on `rutina_ejercicios`/
   `series_registradas` and did not include IDs embedded in
   `rutina_ejercicios.alternativas` JSON entries (confirmed this JSON shape
   exists and carries `ejercicio_id` per alternative via `app.js`). No live
   database access exists in this session, so the exact size of that gap is
   not fabricated — the new proposed task exists specifically to measure it.
7. **MAJOR — field tiers not separated:** replaced the single "minimum
   fields" table in the contract doc with four explicit tiers: minimum
   identity/matching contract, optional capability fields, future
   Compatibility Engine requirements, and the always-stored raw payload for
   audit.
8. **MAJOR — FK validation overclaimed:** corrected both this Result section
   (see "Validations performed" below) and the SQL design's header comment
   to state precisely that `supabase/baseline/schema_snapshot.sql` — the
   artifact this task actually diffed against — contains no PK/UNIQUE/FK/
   index definitions (confirmed by re-reading the file; its own trailing
   comment says so explicitly), so the proposed FK to `ejercicios(id)` rests
   on a prose claim in `docs/CURRENT_STATE_RECONCILIATION.md`, not on a
   structural artifact, and must be independently re-verified before this
   SQL is ever applied.
9. **MINOR — "all media null" was wrong:** re-ran the check
   programmatically against `output/gym-exercise-library/catalog.json`;
   confirmed 2 of 876 records have non-null `media.primary_image`
   (`src-002-cfd0746bbd0f73af`, `src-002-7c275f916ac75019`), one of which
   has a corresponding file on disk at
   `assets/exercises/src-002-7c275f916ac75019/primary.png`. Corrected in
   both the contract doc's evidence section and its "Media reference
   semantics" section (which still said "all sampled media fields are
   currently null" after the evidence section's earlier draft was fixed).
10. **MINOR — "additive only" / `updated_at` semantics overstated:**
    corrected the SQL file's header banner to state precisely what
    "additive" does and does not mean (new tables and proposed-but-unapplied
    new columns; does NOT mean privilege-free, since `CREATE EXTENSION` is a
    database-global operation, not scoped to this file's new objects), and
    added an explicit comment on `legacy_exercise_crosswalk.updated_at`
    stating it has no trigger in this design and is not auto-maintained on
    UPDATE.

Additional items from the review, addressed inline above rather than as
separate line items: the normative claim that the Library "should not" gain
a contraindication-equivalent field was reframed as GymApp's own design
stance, not a directive to the Library team (item 3's section, "Ownership
boundary"); the exact manifest field-name proposal was reframed from "this
contract requires the Library to eventually publish" to "GymApp's own
consumer-side requirement, satisfied unilaterally; a possible future request
to the Library, not decided or imposed here" (contract doc, "Contract /
version identifier"); consumer requirements vs. producer requests are now
distinguished explicitly wherever this document makes a claim about
`Gym-Exercise-Library`'s future behavior.

**Disagreement with one review point, for the record:** none. Every BLOCKER/
MAJOR/MINOR point held up against direct re-inspection of the evidence
(the taxonomy files, the schema snapshot's own disclaimer, the catalog.json
media fields, and the absence of any stability guarantee in the Library's
docs were all independently reproduced during this revision, not merely
taken on faith from the review).

### Revision 3 — response to second independent review (REQUEST_CHANGES)

A second independent review round returned `REQUEST_CHANGES` again,
identifying exactly four required structural changes (plus any
inconsistency directly caused by them). All four were addressed by revising
`supabase/design/exercise_identity_mapping.sql` (substantially restructured)
and both `docs/EXERCISE_INTEGRATION_CONTRACT.md` and
`docs/LEGACY_EXERCISE_CROSSWALK.md` (targeted sections updated for
coherence with the new SQL). This task file's status remains `REVIEW` per
instructions, no SQL was executed, no application file was touched, nothing
was committed or pushed, and GA-002 was not created.

1. **Snapshot reproducible and immutable.** `canonical_import_snapshot`
   redesigned around content identity instead of attempt identity:
   - `raw_export_sha256` and a new `taxonomy_fingerprint` are both mandatory
     (`not null`);
   - a new `content_fingerprint` column is Postgres-**generated** (via
     `digest()`, using pgcrypto, already enabled) from those two columns and
     is `unique` — identical content always resolves to the same row; the
     importer must look up-or-insert by this fingerprint, not blindly
     insert per attempt;
   - a `status` lifecycle (`building` / `complete` / `failed`) replaces the
     implicit "always immediately usable" assumption;
   - `finalize_canonical_import_snapshot(p_snapshot_id)` is the only path
     from `building` to `complete`; it validates `record_count` against
     actually-imported `canonical_exercise_import` rows AND recomputes the
     taxonomy fingerprint from `canonical_import_raw_taxonomy` and compares
     it to the declared one, raising on any mismatch;
   - two triggers (`canonical_import_snapshot_immutable`,
     `canonical_exercise_import_immutable`) forbid `UPDATE`/`DELETE` on a
     `complete` snapshot's header and on its `canonical_exercise_import`
     children, and forbid inserting further children into it;
   - a shared trigger function, `require_complete_snapshot_for_crosswalk()`,
     is attached to `legacy_exercise_crosswalk`,
     `legacy_exercise_crosswalk_candidates`, and the new
     `exercise_reference` table, rejecting any reference to a
     non-`complete` snapshot — an incomplete snapshot cannot be used for
     crosswalk/compatibility, enforced, not just documented;
   - `canonical_exercise_import_exercise_id_matches_payload` /
     `..._status_matches_payload` CHECK constraints keep the projected
     columns consistent with `payload`;
   - `is_current` is **removed**; currency is now derived via the new
     `canonical_exercise_current` view (latest row per `exercise_id` among
     `complete` snapshots), never a mutable stored flag;
   - removal detection is now `canonical_removed_exercise_ids(prev, new)`,
     a function that refuses to run unless both snapshots are `complete`
     (previously a documented ad hoc query with no such guard).
2. **Raw export + taxonomies.** Added `canonical_import_raw_artifact`
   (the raw exported array, inline or via a durable GymApp-controlled
   reference — its hash lives once, on the header, to avoid drift) and
   `canonical_import_raw_taxonomy` (exact raw content of every
   `taxonomy/*.json` file, one row per file per snapshot, inline or via a
   durable reference — not just a hash+count summary as in revision 2).
   `canonical_import_taxonomy_summary` is now a derived view over the raw
   taxonomy table (never independently written, so it cannot drift).
   Distinguished explicitly in both the SQL comments and the contract doc:
   raw artifact vs. raw taxonomies vs. the normalized/queryable projection
   (`canonical_exercise_import`, unchanged in role). Documented explicitly
   that this means GymApp never needs to re-read
   `Gym-Exercise-Library`'s internal historical files to interpret an
   already-imported snapshot.
3. **Crosswalk.** `legacy_exercise_crosswalk_evidence_required_check` now
   requires `matched_by`/`matched_at`/`notes` for **both** `matched` and
   `ambiguous` (revision 2 only documented this for `ambiguous`, never
   enforced it). `canonical_exercise_id` on both
   `legacy_exercise_crosswalk` and `legacy_exercise_crosswalk_candidates` is
   now a real composite FK into `canonical_exercise_import
   (snapshot_id, exercise_id)` — a candidate/target must actually exist in
   the payload GymApp imported under that evaluated snapshot, not an
   arbitrary string. A new composite FK ties every candidate row to a
   `legacy_exercise_crosswalk` row evaluated under the *same* snapshot
   (`legacy_exercise_crosswalk_candidates_crosswalk_fk`), replacing an
   independently-set column with no cross-table check. `rank` is now
   required positive (`> 0`) and unique per `(legacy_ejercicio_id,
   evaluated_snapshot_id)` (previously defaulted to `0` for every row, no
   uniqueness). `legacy_exercise_crosswalk` now forbids `DELETE` by trigger
   (a decision is superseded by a new, audited `UPDATE`, never removed);
   `legacy_exercise_crosswalk_history` now forbids both `UPDATE` and
   `DELETE` by trigger, making it genuinely append-only rather than
   append-only by convention. Chose the append-only-by-trigger alternative
   over auditing `DELETE`, since forbidding it outright is stronger and
   simpler than logging an operation the design otherwise has no legitimate
   use for.
4. **Future exercise reference (critical).** Retracted the prior revision's
   naive proposal (a bare nullable `canonical_exercise_id` column next to
   `ejercicio_id text not null`), which could not actually satisfy
   canonical-only exercises without either inventing a legacy row or
   leaving `ejercicio_id` required. **Chosen strategy: a local indirection
   entity, `public.exercise_reference`**, discriminated by `source`
   (`legacy` | `canonical`) with a CHECK enforcing exactly one of
   `legacy_ejercicio_id` / `canonical_exercise_id` per row, deduplicated per
   id via partial unique indexes, and requiring a `complete` evaluated
   snapshot (via the shared trigger) whenever a snapshot is pinned for a
   canonical reference. Chosen over inline discriminated columns repeated
   on every consuming table because it centralizes the invariant once and
   gives the future Compatibility Engine a single join target regardless of
   which namespace a reference came from. Covers, as required:
   - **(A) historical records:** `rutina_ejercicios.ejercicio_id` /
     `series_registradas.ejercicio_id` are untouched for every existing
     row — nothing about historical resolution changes.
   - **(B) new records during transition:** may keep using bare
     `ejercicio_id` for a legacy reference (no `exercise_reference` row
     required), or set a new nullable `exercise_ref_id` column pointing at
     an `exercise_reference` row of either source — never mixing a raw
     canonical string into a legacy-typed column or vice versa.
   - **(C) canonical-only exercises:** an `exercise_reference` row with
     `source = 'canonical'`, `ejercicio_id` left `NULL`. This requires
     proposing (not applying) `ALTER TABLE ... ALTER COLUMN ejercicio_id
     DROP NOT NULL` on both `rutina_ejercicios` and `series_registradas` —
     explicitly flagged in the SQL file's header and inline comments as the
     **one** proposal in the file that is not purely additive in the strict
     sense, together with a new CHECK requiring every row to carry at least
     one identity path. No legacy row is invented for any canonical-only
     exercise.
   - **(D) `alternativas` JSON:** a new optional `exercise_ref_id` key per
     alternative object, alongside the existing `ejercicio_id`/`nombre`/
     `equipo`/`motivo` keys; cannot be enforced by CHECK (no per-item jsonb
     schema in Postgres), documented as a required importer/application
     guarantee instead.
   - **(E) future Compatibility Engine:** resolves any reference — bare
     `ejercicio_id` or `exercise_ref_id` — through the same entity/pattern,
     without special-casing which table/column supplied the identity.
   No historical ID is rewritten anywhere in this design.

**Disagreement with any review point, for the record:** none. All four
points were addressable within the existing design's structure without
contradicting anything already resolved in revision 2; nothing flagged as
resolved in revision 2 was reopened except where these four points
required touching the same tables (e.g. `canonical_exercise_import`'s
`is_current` column, which point 1 explicitly required removing).

**Invariants enforced in PostgreSQL vs. deferred to the importer/
transaction** (recorded once, in full, in the SQL file's own closing
section "Invariants enforced in PostgreSQL by this design vs. deferred to
the future importer/transaction" — not restated here to avoid the two
documents drifting apart). In short: content hashing, snapshot
finalization/immutability, incomplete-snapshot rejection, referential
integrity of crosswalk/candidate targets, evidence requirements, and
append-only enforcement are all enforced in Postgres by this design;
whether a hash was computed over the *original* raw bytes before storage,
whether an external URI stays reachable, whether an importer actually
attempts a complete import before finalizing, and whether `alternativas`
JSON entries follow the documented convention are all necessarily importer/
application responsibilities that DDL alone cannot guarantee.

### Files modified (revision 3)

- `supabase/design/exercise_identity_mapping.sql` — substantially
  restructured (see above).
- `docs/EXERCISE_INTEGRATION_CONTRACT.md` — targeted section updates
  ("Taxonomy versioning", "Contract / version identifier", "Detecting /
  importing a newer Library contract", "Removed / deprecated / renamed
  canonical records", plus the revision note at the top).
- `docs/LEGACY_EXERCISE_CROSSWALK.md` — targeted section updates
  ("Representation in the SQL design", "Rules for future routine
  generation", "Migration sequence" step 6, plus the revision note at the
  top).
- This task file (`Result` section only).

No other file was read for new evidence in this revision; the four
required changes were structural/design corrections to already-inspected
material, not new fact-finding.

### Summary

Produced the versioned GymApp ⇄ Gym-Exercise-Library consumer contract, the
legacy-to-canonical crosswalk design, and a non-production additive SQL
design for the mapping/import layer. No production system, application file
(`app.js`/`index.html`/`styles.css`), or existing Supabase artifact was
modified. No data was migrated or applied.

### Files created

- `docs/EXERCISE_INTEGRATION_CONTRACT.md`
- `docs/LEGACY_EXERCISE_CROSSWALK.md`
- `supabase/design/exercise_identity_mapping.sql`

### Files modified

- `tasks/ready/GA-001-exercise-integration-contract.md` → moved (`git mv`) to
  `tasks/in_progress/` then `tasks/review/`, with status/owner/result fields
  updated. No other change to this file's content.

### Evidence inspected

GymApp repo (this working tree):
- `AGENTS.md`, `docs/CURRENT_STATE_RECONCILIATION.md`,
  `docs/REENGINEERING_DECISION_FRAME.md`, `docs/CLAUDE_WEB_HANDOFF.md`.
- `supabase/baseline/schema_snapshot.sql` — confirmed `ejercicios.id`,
  `rutina_ejercicios.ejercicio_id`, `series_registradas.ejercicio_id` are all
  `text`.
- `supabase/functions/generate-routine/index.ts` — confirmed the exact
  `ejercicios` columns currently read (`id, nombre, grupo_muscular, equipo,
  nivel, contraindicaciones`) and how each is used (equipment filter, muscle
  filter, contraindication exclusion).
- `app.js` — confirmed `rutina_ejercicios` joins `ejercicios(nombre,
  grupo_muscular)` and a manual-alternative search queries `ejercicios` by
  name.
- `tasks/README.md`, `tasks/TEMPLATE.md`, `.agents/skills/gymapp-development/SKILL.md`.

Gym-Exercise-Library repo (sibling local working copy at
`../Gym-Exercise-Library`; **not** GitHub API — no `gh` CLI was available in
this environment, so this is the local checkout, treated as current-state
evidence rather than fabricated):
- `README.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`,
  `docs/DECISIONS.md`.
- `schemas/exercise.schema.json` (full schema read; `schema_version` const
  `"0.2"`).
- `output/gym-exercise-library/catalog.json` and
  `catalog/canonical/SRC-002/exercises.json` — confirmed identical (876
  records), and confirmed via `scripts/build-app.js` that the former is a
  verbatim copy of the latter with no manifest/version wrapper.
- Programmatically checked all 876 records: `status` is `draft` for all
  876; `review.status` is `review_required` for all 876; `schema_version` is
  `"0.2"` for all 876. Read one full sample record in detail.
- `package.json` (`version: 0.1.0`, versions the local app, not the export).

**Revision 2 additions (in response to review):**
- `taxonomy/body-regions.json`, `taxonomy/muscles.json`,
  `taxonomy/joint-actions.json`, `taxonomy/movement-patterns.json`,
  `taxonomy/equipment.json`, `taxonomy/grips.json`,
  `taxonomy/body-positions.json`, `taxonomy/training-types.json`,
  `taxonomy/difficulty.json` — confirmed each is a bare JSON array/object
  with no top-level version/hash field.
- `docs/ROADMAP.md`, `docs/SRC-002-CANONICAL-DRAFT-REPORT.md` — grepped for
  any exercise_id stability/rename/permanence guarantee (found none); read
  the field-population counts used in the contract doc's "Taxonomy
  versioning" section.
- `catalog/canonical/README.md` — confirmed it says nothing about
  `exercise_id` stability.
- Programmatically re-checked `media.primary_image` across all 876 records
  (found 2 non-null) and confirmed a corresponding file exists on disk at
  `assets/exercises/src-002-7c275f916ac75019/primary.png`.
- `git log -1`, `git status --short`, `git remote -v`, `git rev-parse HEAD`
  vs. `git rev-parse origin/main` in `../Gym-Exercise-Library` — confirmed a
  clean working tree at commit `aaf55d8417dc9fd0aaa38ebf9be9016040dce9eb`,
  matching `origin/main` exactly.
- `app.js` — re-read `usarAlternativa`/`agregarAlternativaManual` in detail
  to confirm the exact `alternativas` JSON shape (`ejercicio_id`, `nombre`,
  `equipo`/`motivo`) before proposing an additive key convention for it.
- `supabase/functions/generate-routine/index.ts` — re-read the LLM output
  JSON Schema's `alternativas` item definition; confirmed it has no
  `additionalProperties: false`, so an additive key is safe to propose.
- `docs/CURRENT_STATE_RECONCILIATION.md` — re-read in full; confirmed it
  claims (in prose, from Supabase's own introspection, not from
  `schema_snapshot.sql`) that production foreign keys already point at
  `ejercicios`, which is the basis for the corrected FK caveat below.

### Validations performed

- Confirmed clean working tree and correct branch (`setup/agent-workspace`)
  before starting; confirmed no other task was in `tasks/in_progress/`.
- Cross-checked every table/column named in
  `supabase/design/exercise_identity_mapping.sql`
  (`public.ejercicios.id`) against `supabase/baseline/schema_snapshot.sql` to
  confirm the column and its type actually exist and match (`text`).
  **Corrected in revision 2:** the original wording of this bullet ("confirm
  the FK target ... actually exist and match") overclaimed. Re-reading
  `schema_snapshot.sql` confirms it captures no PRIMARY KEY, UNIQUE, FOREIGN
  KEY, or index definitions at all (its own trailing comment says so). This
  validation confirmed column existence/type only, not that `ejercicios.id`
  is a valid FK target — that rests on prose in
  `docs/CURRENT_STATE_RECONCILIATION.md`, not on a structural artifact this
  task could diff against. See the SQL design's updated header comment for
  the full caveat and what an operator must independently re-verify before
  applying this design.
- Cross-checked every canonical field named in the contract document against
  `schemas/exercise.schema.json` and a live sample from
  `output/gym-exercise-library/catalog.json`, rather than assuming field
  names.
- Re-read the final diff (three new files) against the task's declared
  scope and "Allowed files/areas" — confirmed no existing source/application
  file was modified, only read.
- No automated test suite exists for documentation/design-only changes in
  this repo; validation here is evidence cross-checking as above, not code
  execution. This is consistent with `AGENTS.md` ("Non-trivial changes
  require tests, or an explicit written explanation of why a test is not
  applicable") — nothing here is executable code.
- Did not run any SQL against any database, local or production, per scope.
- **Revision 2:** re-read the full diff of all three deliverable files
  against this task's declared "Allowed files/areas" again after applying
  the review's requested changes — confirmed no existing source/application
  file was touched, no SQL was executed, nothing was committed.

### Risks

- ~~The Gym-Exercise-Library evidence came from a local sibling working
  copy, not `git fetch`/GitHub API... Recommend a human confirm
  `Gym-Exercise-Library`'s working tree is clean/pushed before treating this
  contract as final.~~ **Resolved in revision 2:** re-checked directly —
  `git status --short` reports a clean tree and `git rev-parse HEAD` matches
  `git rev-parse origin/main` exactly (`aaf55d8417dc9fd0aaa38ebf9be9016040dce9eb`)
  as of this revision. This can drift again after this check, so a future
  agent should re-verify rather than assume it stays true.
- ~~The contract commits GymApp to expecting a future manifest... If
  `Gym-Exercise-Library` never adds it, GymApp's import step stays
  manual/commit-pinned indefinitely.~~ **Corrected in revision 2:** the
  contract no longer frames this as something the Library is expected/
  required to add. GymApp's own `canonical_import_snapshot` satisfies the
  pinning requirement unilaterally regardless of upstream action; whether to
  ask the Library for a manifest is listed as an open, undecided question
  below, not an assumption baked into the design.
- Every canonical record is currently `draft`/`review_required` with low
  confidence; the contract explicitly gates any production-facing use of
  canonical data behind that maturing (see "Compatibility / backward-
  compatibility expectations" in the contract doc). If a future task skips
  that gate, it would violate this design, not this task itself.
- No RLS policies or grants are defined for the design tables; the SQL file
  explicitly calls this out as excluded from GA-001's scope.
- **New in revision 2:** the proposed FK from `legacy_exercise_crosswalk`
  to `public.ejercicios(id)` (and the equivalent FK in
  `legacy_exercise_crosswalk_candidates`) has not been structurally verified
  against a captured schema artifact with PK/UNIQUE/FK/index definitions —
  none exists in this repository. Before this SQL is ever applied, an
  operator must independently confirm `ejercicios.id` actually carries a
  PRIMARY KEY or UNIQUE constraint in the target database.
- **New in revision 2:** `legacy_exercise_crosswalk.updated_at` has no
  maintenance trigger in this design; any future apply-and-use of this table
  must either add one or ensure every UPDATE statement sets it explicitly,
  or the column will silently go stale.
- **New in revision 2:** the exact set of legacy exercise IDs with
  historical weight is now known to be larger than the previously-reported
  65+11 (it excludes IDs embedded in `rutina_ejercicios.alternativas` JSON),
  and its true size is unknown without live database access. This is why
  the proposed next task (below) is a census, not a candidate generator.

### Pending decisions (need explicit human approval before proceeding)

1. Whether to actually apply `supabase/design/exercise_identity_mapping.sql`
   to a non-production/staging Supabase environment (never production
   without approval, per `AGENTS.md`) — and, before that, whether an
   operator has independently confirmed `ejercicios.id` carries a PK/UNIQUE
   constraint in the target database (see "Risks" above).
2. Whether GymApp should formally request that `Gym-Exercise-Library` add
   its own manifest/version marker for `taxonomy/*.json` and/or the exercise
   export, or whether GymApp should rely solely on its own commit-pinning
   and content-hashing (`canonical_import_snapshot`) indefinitely. Revision
   2 deliberately does not decide this or propose an exact manifest shape
   to the Library team — see "Contract / version identifier" in the
   contract doc.
3. ~~Confirmation that `Gym-Exercise-Library`'s local working copy used for
   this task's evidence matches its intended remote state.~~ **Resolved in
   revision 2** — see "Risks" above.
4. Whether to formally request that `Gym-Exercise-Library` document an
   explicit `exercise_id` stability/rename policy (no such guarantee exists
   in that repository's docs today, confirmed by direct inspection). Until
   that happens, GymApp's crosswalk succession design
   (`superseded_by_exercise_id`) is GymApp's own unverified assumption, not
   a confirmed contract.

### Proposed next implementation task (concrete; corrected in revision 2)

**Retracted:** revision 1 proposed GA-002 as an offline candidate generator
against "the ~76 legacy exercise IDs with real historical usage." Review
correctly identified that this count and its input set were never captured
as a reproducible artifact, and specifically excluded legacy IDs embedded in
`rutina_ejercicios.alternativas` JSON entries. GA-002 is **not created** by
this revision, per instructions.

**Proposed instead — a task to capture, when a human decides to create it:**

**GA-002 (proposed name/number, not created) — Legacy reference snapshot
and historically-referenced ID census (read-only, no DB writes, no
matching).**

- Objective: capture a versioned, reproducible snapshot of the full legacy
  `ejercicios` table (1,464 rows) and compute the exact, deduplicated union
  of every legacy exercise ID referenced anywhere with historical weight:
  `rutina_ejercicios.ejercicio_id`, `series_registradas.ejercicio_id`, and
  every `ejercicio_id` embedded inside every `rutina_ejercicios.alternativas`
  JSON array element — with a per-ID reference-count breakdown by source.
- Output: a timestamped/hashed snapshot file plus a census file listing the
  deduplicated ID union, mirroring the reproducibility discipline
  `canonical_import_snapshot` applies to the canonical side.
- Scope: read-only queries only. No writes to any table, no matching/
  heuristics, no application code changes.
- This becomes the prerequisite input for the actual candidate generator
  (matching against a pinned `canonical_import_snapshot`), which would be a
  later task (proposed as GA-003, not created), sequenced strictly after
  this census exists.
- See `docs/LEGACY_EXERCISE_CROSSWALK.md`, "Migration sequence," for the
  full rationale — this document does not restate it to avoid drift.

### Revision 4 — targeted fix for a third independent review (directed re-verification)

A third independent review (Codex) ran a directed verification against
`supabase/design/exercise_identity_mapping.sql` only, structured as 4 tests.
Result: TEST 1 FAIL, TEST 2 FAIL, TEST 3 FAIL, TEST 4 PASS (TEST 4 —
`exercise_reference` strategy — is closed and was explicitly out of scope
for this revision). Three concrete defect groups were corrected, exclusively
in the SQL design file; no doc, task scope, or architecture was reopened.

1. **TEST 1 (snapshot immutability) — 3 defects fixed:**
   - (A) `status = 'complete'` was reachable via a plain `UPDATE`, bypassing
     `finalize_canonical_import_snapshot()`'s validation entirely. Fixed by
     moving all completion validation into a new `BEFORE UPDATE` trigger
     (`canonical_import_snapshot_validate_completion` /
     `validate_snapshot_completion()`) on `canonical_import_snapshot`
     itself, which fires on **every** update attempting the
     `building -> complete` transition, not only calls through the
     function. `finalize_canonical_import_snapshot()` is now a thin,
     documented entry point with no validation logic of its own.
   - (B) `forbid_mutation_of_completed_snapshot_children()` used
     `coalesce(new.snapshot_id, old.snapshot_id)`, which on `UPDATE` always
     resolved to the target snapshot, so a `canonical_exercise_import` row
     could be reparented **out of** a complete snapshot into a `building`
     one undetected. Fixed to check `OLD.snapshot_id` and `NEW.snapshot_id`
     independently and unconditionally.
   - (C) Immutability previously covered only the header and
     `canonical_exercise_import`, not `canonical_import_raw_artifact` /
     `canonical_import_raw_taxonomy`. The same (fixed) trigger function is
     now also attached to both tables.
2. **TEST 2 (raw export + taxonomies) — 4 defects fixed:** the same new
   `validate_snapshot_completion()` trigger now also (A) requires exactly
   one `canonical_import_raw_artifact` row to exist before completion, and
   (B) requires the exact required taxonomy-file set to be present — no
   silent missing/extra file — via a new
   `gec1_required_taxonomy_names()` function. That required set (9 files)
   was re-verified directly against the sibling `Gym-Exercise-Library`
   working copy in this revision (`find ../Gym-Exercise-Library/taxonomy
   -type f`: `body-positions`, `body-regions`, `difficulty`, `equipment`,
   `grips`, `joint-actions`, `movement-patterns`, `muscles`,
   `training-types` — 9 files, no subdirectories), matching what revision 2
   had already identified; nothing was invented. (C) `taxonomy_fingerprint`
   is now only accepted at completion once the exact required set is
   confirmed present, so it can no longer merely reflect "whatever rows
   happen to exist." (D) Fixed by the same immutability-trigger extension
   as TEST 1 item C above.
3. **TEST 3 (crosswalk candidates) — 1 defect fixed:** `legacy_exercise_
   crosswalk_candidates` had no `UPDATE`/`DELETE` guard at all. Chosen fix
   (the review's stated preference): made candidate rows append-only/
   immutable via two new forbidding triggers
   (`forbid_candidate_mutation()`), rather than adding a second audit-log
   table. A reevaluation is represented as a new decision — a new
   `evaluated_snapshot_id` on the parent `legacy_exercise_crosswalk` row,
   which (via the existing composite FK) necessarily requires new candidate
   rows; prior candidates, tied to the prior snapshot, are never touched.

**Bug caught and fixed during this same revision, before any handoff:** the
first draft of the TEST 1/B fix referenced `OLD`/`NEW` fields unconditionally
inside the shared trigger function, which is also attached `BEFORE INSERT`
and `BEFORE DELETE`. In PL/pgSQL, `OLD` is unassigned on `INSERT` and `NEW`
is unassigned on `DELETE`; accessing a field of an unassigned trigger record
raises a runtime error. Caught by re-reading the trigger's own attachment
(`before insert or update or delete`) against the field-access pattern, and
fixed by branching explicitly on `TG_OP` before touching either record,
instead of relying on implicit short-circuit evaluation.

**No SQL was executed** (per instructions); correctness of the fix was
verified by a full manual re-read of the file, not by running it against a
database.

**This revision's own directed verification** (mirroring the three
questions the review posed):
- TEST 1: Can `status = 'complete'` be reached by any path without passing
  `finalize`'s validations? No — `validate_snapshot_completion()` is a
  table-level trigger, not a function-level check, so it fires regardless
  of caller. Can any component be modified after `complete`? No — header,
  `canonical_exercise_import`, `canonical_import_raw_artifact`, and
  `canonical_import_raw_taxonomy` are all trigger-guarded, in both
  directions of `UPDATE ... SET snapshot_id = ...`.
- TEST 2: Can a snapshot complete without a raw artifact? No — count-of-1
  check in the trigger. Missing a required taxonomy? No — exact-set-equality
  check against `gec1_required_taxonomy_names()`. Can raw/taxonomies be
  modified/deleted after complete? No — same immutability trigger as TEST 1.
- TEST 3: Can candidates be modified/deleted to make historical evidence
  disappear? No — both operations unconditionally raise.

### Files modified (revision 4)

- `supabase/design/exercise_identity_mapping.sql` — targeted defect fixes
  only (see above); no other file changed.

### Revision 5 — structural refactor (adversarial design review, not another local patch)

A directive explicitly rejected further local patching: "GA-001 has gone
through four review/fix cycles. The problem is now the method: local fixes
have repeatedly introduced or exposed another invalid state. Your job is to
make the GA-001 SQL design internally coherent as a whole," authorizing
refactoring `supabase/design/exercise_identity_mapping.sql` itself, while
explicitly forbidding any change to application code, production, GA-002, or
the already-approved `exercise_reference` architecture (its table
definition, constraints, and triggers are byte-for-byte unchanged; only
three stale prose comments inside its block that named the old crosswalk
table were corrected to name the new one).

**Two structural defects found by self-directed adversarial review before
any fix, tracing every one of 22 required attack scenarios against the
revision-4 SQL:**

1. **S1 (INSERT-as-COMPLETE bypass):** `validate_snapshot_completion()` was
   attached `BEFORE UPDATE` only. A direct `INSERT INTO
   canonical_import_snapshot (..., status, completed_at, record_count) VALUES
   (..., 'complete', now(), 0, ...)` bypassed every completion check
   (record count, raw artifact presence, taxonomy completeness/fingerprint)
   entirely, violating invariants 1–2 ("a snapshot is inserted only as
   BUILDING; COMPLETE cannot be supplied on INSERT").
2. **C3/C4 (mutable crosswalk decision — the core issue the directive
   anticipated):** `legacy_exercise_crosswalk` was one mutable row per legacy
   ID; only `DELETE` was forbidden. A plain `UPDATE` on an already-`matched`
   row (changing `canonical_exercise_id`, `confidence`, or `notes`) was
   **not** structurally blocked — a copy-on-write trigger
   (`legacy_exercise_crosswalk_audit`) recorded that a rewrite happened, but
   nothing prevented the rewrite itself. This directly violates "once
   finalized, its semantic decision cannot be silently rewritten," and its
   candidates table (`legacy_exercise_crosswalk_candidates`) was
   unconditionally immutable forever rather than immutable only *after*
   finalization, making it impossible to correct a draft evaluation before
   deciding it.

**Fix, not a patch:** (1) `validate_snapshot_completion()` is now also
`BEFORE INSERT`, rejecting any status other than `building` on insert.
(2) The entire crosswalk was refactored from a mutable-row-plus-audit-log
model into a genuine append-only evaluation/revision ledger:
`legacy_exercise_crosswalk`, `legacy_exercise_crosswalk_candidates`, and
`legacy_exercise_crosswalk_history` were **removed** and replaced by
`legacy_exercise_evaluation` (one row per (re)evaluation, `draft`/`final`
lifecycle mirroring `canonical_import_snapshot`'s `building`/`complete`
pattern, immutable once `final`) and `legacy_exercise_evaluation_candidate`
(belongs to exactly one evaluation via FK, freely editable while its parent
is `draft`, immutable once its parent finalizes). `legacy_only` is no longer
a stored status on a permanent row; it is the derived absence of any
evaluation row, surfaced by two new views,
`legacy_exercise_current_evaluation` (most recently finalized evaluation per
legacy ID — the "current decision" mechanism, requirement 6) and
`legacy_exercise_crosswalk_status` (reconstructs the original
matched/ambiguous/unmatched/legacy_only vocabulary as a read model). Full
rationale is recorded as a block comment in the SQL file immediately above
"3. legacy_exercise_evaluation". `docs/LEGACY_EXERCISE_CROSSWALK.md` and
`docs/EXERCISE_INTEGRATION_CONTRACT.md` were updated wherever they named the
removed tables/columns, so no deliverable drifts from the SQL it describes.

**Adversarial test matrix** (S1–S12: snapshot; C1–C10: crosswalk/evaluation).
Every PASS below was re-derived by reading the actual constraint/function/
trigger in `supabase/design/exercise_identity_mapping.sql`, not assumed:

| # | Result | Constraint/function/trigger |
|---|---|---|
| S1 | PASS | `validate_snapshot_completion()`, now `BEFORE INSERT OR UPDATE` (trigger `canonical_import_snapshot_validate_completion`): on `INSERT`, rejects any `status <> 'building'` outright |
| S2 | PASS | `validate_snapshot_completion()`: `v_raw_artifact_count <> 1` raises even when `record_count` matches 0 actual rows |
| S3 | PASS | `validate_snapshot_completion()`: `v_actual_taxonomy_names is distinct from` `gec1_required_taxonomy_names()` (9-element exact-set check) raises on 8 |
| S4 | PASS | `validate_snapshot_completion()`: recomputed `v_computed_taxonomy_fingerprint` compared to `new.taxonomy_fingerprint`, raises on mismatch |
| S5 | PASS | `validate_snapshot_completion()`: `v_actual_records <> new.record_count` raises |
| S6 | PASS | `forbid_mutation_of_completed_snapshot()` (trigger `canonical_import_snapshot_immutable`, `BEFORE UPDATE OR DELETE`): raises when `old.status = 'complete'`, for any `UPDATE` including notes-only |
| S7 | PASS | same trigger, `TG_OP = 'DELETE'` branch |
| S8 | PASS | `forbid_mutation_of_completed_snapshot_children()` (trigger `canonical_exercise_import_immutable`): checks `OLD.snapshot_id` and `NEW.snapshot_id` independently and unconditionally, so both in-place mutation and reparent-out-of-complete are rejected |
| S9 | PASS | same function, trigger `canonical_import_raw_artifact_immutable` |
| S10 | PASS | same function, trigger `canonical_import_raw_taxonomy_immutable` |
| S11 | PASS | `require_complete_snapshot_for_crosswalk()`, attached to `legacy_exercise_evaluation`, `legacy_exercise_evaluation_candidate`, and `exercise_reference`: raises when the referenced snapshot's `status <> 'complete'` |
| S12 | PASS | `content_fingerprint` (generated column, `UNIQUE`) guarantees identical content resolves to the same header row; the required look-up-or-insert-then-branch-on-status sequence (skip all child work if found row is already `complete`, since children of a complete snapshot are trigger-immutable) is now spelled out explicitly in the header comment block above `canonical_import_snapshot`, closing the ambiguity a bare uniqueness constraint left open |
| C1 | PASS | `legacy_exercise_evaluation` insert (draft, evidence present, target null for `ambiguous`) + `legacy_exercise_evaluation_candidate` inserts referencing it succeed under normal constraints; no trigger blocks a draft evaluation from accumulating candidates |
| C2 | PASS | `finalize_legacy_exercise_evaluation()` issues the `draft -> final` `UPDATE`; `validate_evaluation_finalization()` finds ≥1 candidate for the ambiguous case and sets `finalized_at` |
| C3 | PASS | `forbid_mutation_of_finalized_evaluation()` (trigger `legacy_exercise_evaluation_immutable`, named to sort before `..._validate_finalization` so it fires first): raises on any `UPDATE`/`DELETE` where `old.lifecycle_state = 'final'` |
| C4 | PASS | `forbid_mutation_of_finalized_evaluation_children()` (trigger `legacy_exercise_evaluation_candidate_immutable`): raises on `UPDATE`/`DELETE` when the parent evaluation's `lifecycle_state = 'final'` |
| C5 | PASS | `legacy_exercise_evaluation` has no uniqueness constraint forcing one row per legacy ID; a new row for evaluation B is a plain, independent `INSERT` that touches nothing belonging to A |
| C6 | PASS | `legacy_exercise_evaluation_candidate_evaluation_fk`, a composite FK on `(evaluation_id, evaluated_snapshot_id)` into `legacy_exercise_evaluation (id, evaluated_snapshot_id)`: a candidate claiming `evaluation_id = B, evaluated_snapshot_id = A` requires a `(B, A)` row to exist, but B's own row is `(B, B)` — FK violation |
| C7 | PASS | `legacy_exercise_evaluation_canonical_target_fk` / `legacy_exercise_evaluation_candidate_target_fk`, composite FKs into `canonical_exercise_import (snapshot_id, exercise_id)`: a target absent from the evaluated snapshot's own payload violates the FK |
| C8 | PASS | `legacy_exercise_evaluation_evidence_required_check` (CHECK, blocks a row lacking `evaluated_by`/`notes` from existing at all, stronger than "cannot finalize") plus `validate_evaluation_finalization()`'s explicit `v_candidate_count = 0` raise for `ambiguous` on the `draft -> final` transition |
| C9 | PASS | `legacy_exercise_evaluation_matched_requires_target` + `legacy_exercise_evaluation_evidence_required_check` (CHECK constraints) make a `matched` row lacking a valid target/confidence/evidence impossible to insert, let alone finalize |
| C10 | PASS | `legacy_exercise_current_evaluation` (view) only changes which row is "current"; A's row, and its candidates (FK'd to A's own `id`), are never touched — plain `SELECT ... WHERE id = <A>` and its candidate join remain fully queryable |

All 22 PASS. No design contradiction requiring a human decision was found
this revision; both defects were resolvable within the existing design's
structure (extending an already-proven pattern — the snapshot lifecycle — to
the crosswalk, rather than inventing a new mechanism).

**Files modified (revision 5):**
- `supabase/design/exercise_identity_mapping.sql` — added the `BEFORE
  INSERT` branch to `validate_snapshot_completion()`; added explicit
  idempotent-import sequencing to the `canonical_import_snapshot` header
  comment (S12); removed `legacy_exercise_crosswalk`,
  `legacy_exercise_crosswalk_candidates`, `legacy_exercise_crosswalk_history`
  and their triggers/functions; added `legacy_exercise_evaluation`,
  `legacy_exercise_evaluation_candidate`,
  `legacy_exercise_current_evaluation`, `legacy_exercise_crosswalk_status`,
  and their triggers/functions; updated the file's header banner and closing
  "Invariants enforced" / "Explicitly NOT included" sections; corrected three
  stale comment references inside the untouched `exercise_reference` table
  definition. `exercise_reference`'s own columns, constraints, and triggers
  are unchanged.
- `docs/LEGACY_EXERCISE_CROSSWALK.md` — "Mapping semantics", "Statuses",
  confidence/evidence paragraph, "Representation in the SQL design" (table
  rewritten), "Rules for future routine generation" (one reference),
  "Ambiguity", and "Migration sequence" step 4 updated to name the new
  tables/columns; revision note at the top updated.
- `docs/EXERCISE_INTEGRATION_CONTRACT.md` — "Succession, not
  identity-merging" paragraph, the "Minimum identity/matching contract"
  heading, and the incomplete-snapshot-cannot-be-referenced bullet updated to
  name the new tables.
- This task file (`Result` section only, this entry).

No other file was read for new evidence in this revision; this was a
structural SQL-design correction plus keeping the two already-produced docs
coherent with it, not new fact-finding about the Library or the deployed
GymApp schema.

**No SQL was executed** (per instructions); correctness was verified by a
full manual re-read of the file against all 22 adversarial scenarios, not by
running it against a database.

### Revision 6 — targeted fixes for a fifth independent adversarial review (no architecture change)

A fifth independent adversarial review ran the same 22-scenario regression
matrix against revision 5 plus new attacks. Result: **21/22 PASS, C9 FAIL**,
plus **2 additional BLOCKER**, **1 additional MAJOR**, **2 MINOR**, and a
**documentation-consistency FAIL**. The review explicitly forbade another
redesign ("NO rediseñes otra vez el modelo... tu trabajo es corregir TODOS
los defectos reales") and explicitly forbade production/Supabase/deploy/
commit/push/GA-002/new features. All of that was honored: every fix below is
inside `supabase/design/exercise_identity_mapping.sql` (plus the two
companion docs for consistency); the snapshot + append-only-evaluation
architecture from revision 5 is unchanged; no SQL was executed against any
database; nothing was committed, pushed, or merged; GA-002 was not created;
this task file's status remains `REVIEW`.

**1. BLOCKER — contractual payload fields could be `NULL`/absent.**
Reproduced exactly as described: `payload ->> 'exercise_id' = exercise_id`
evaluates to `NULL` (not `FALSE`) when `payload` is missing the key (e.g.
`payload = '{}'`), and PostgreSQL treats a `NULL`-valued CHECK as satisfied,
not violated — a `canonical_exercise_import` row with `payload='{}'` and
valid `exercise_id`/`status` column values passed the old constraints
unmodified. Fixed:
- `canonical_exercise_import_exercise_id_matches_payload` and
  `..._status_matches_payload` now require `payload ->> 'x' is not null`
  before the equality, forcing a real boolean instead of `NULL` whenever the
  key is absent (this also correctly rejects `payload` being the JSON
  literal `null`, since `->>` on a non-object jsonb value also returns
  `NULL`);
- added `canonical_exercise_import_exercise_id_not_blank` (CHECK,
  `btrim(exercise_id) <> ''`) — exercise_id is an identity field, and an
  empty string is technically non-null but not a valid identity;
- added a new trigger, `validate_canonical_exercise_import_payload()`
  (`BEFORE INSERT OR UPDATE`), enforcing the two other Tier-1 fields this
  contract already declares
  (`docs/EXERCISE_INTEGRATION_CONTRACT.md`, "Field tiers" → "1. Minimum
  identity/matching contract") that cannot be same-row CHECK constraints:
  `payload.schema_version` must be present **and match the parent
  snapshot's own `library_schema_version`** (a cross-table comparison a
  CHECK constraint cannot express), and `payload.names.en` must be present
  and non-blank (`names.es` remains optional, per the contract). No new
  mandatory field was invented — both were already declared Tier-1
  requirements, just not yet structurally enforced.
- **Conceptual re-test:** `payload='{}'` with otherwise-valid projected
  columns → the `exercise_id`/`status` CHECKs now fail outright (their
  `is not null` guard is false) before the new trigger is even reached.
  FAILS as required (N1).

**2. BLOCKER — snapshot child mutation vs. finalization race (R1/R2).**
Reproduced exactly as described: `forbid_mutation_of_completed_snapshot_
children()`'s `SELECT status FROM canonical_import_snapshot WHERE id = ...`
had no `FOR UPDATE`, so it read the parent's status under plain MVCC
visibility with no lock — a concurrent `DELETE` on a child row (uncommitted)
and a concurrent `finalize_canonical_import_snapshot()` call could each
proceed against a view of the other that was stale by the time both
committed, producing a `complete` snapshot whose `record_count` silently
disagreed with its actual, fully-settled children. Fixed by adding `FOR
UPDATE` to both status-reading `SELECT`s inside that function, taking the
**same row lock** on the snapshot header that
`finalize_canonical_import_snapshot()` already takes — whichever transaction
reaches the header lock first now forces the other to wait until it commits
or rolls back, so the two can never interleave. Full two-session walkthrough
recorded as "R1-R4 locking analysis" in the SQL file (see below, item 4 of
this list, "Locking analysis performed").

**3. BLOCKER — evaluation candidate mutation vs. finalization race (R3/R4).**
Identical defect, same fix, in `forbid_mutation_of_finalized_evaluation_
children()`: its two `SELECT lifecycle_state FROM legacy_exercise_evaluation
WHERE id = ...` calls had no `FOR UPDATE`. Fixed by adding `FOR UPDATE`,
matching the lock `finalize_legacy_exercise_evaluation()` already takes on
the same row.

**4. C9 (the review's label) — empty-string evidence/reviewer.**
Reproduced exactly: `evaluated_by is not null and notes is not null` is
satisfied by `evaluated_by=''`/`notes=''` — a present-but-blank value is not
`NULL`. Fixed `legacy_exercise_evaluation_evidence_required_check` to
additionally require `btrim(evaluated_by) <> ''` and `btrim(notes) <> ''`.
This is presence-of-a-non-blank-string enforcement only, not semantic/human
validation of the evidence's content, per the review's explicit instruction
not to turn this into semantic validation.

**5. MAJOR — `finalized_at` controllable by the caller.**
Reproduced exactly: `new.finalized_at := coalesce(new.finalized_at, now())`
**respects** a caller-supplied value whenever one is given (only falling
back to `now()` when the caller left it `NULL`), so a caller could supply
`finalized_at = '2000-01-01'` on the draft→final transition and have it
accepted. Fixed to unconditionally overwrite with `new.finalized_at :=
clock_timestamp()`, ignoring/overriding whatever the caller supplied.
Combined with the row becoming fully immutable the instant it is `final`
(`legacy_exercise_evaluation_immutable`), the client can never set or later
alter this timestamp at any point. **Self-found defect of the identical
class, fixed in the same pass (not hidden, per instructions):**
`canonical_import_snapshot.completed_at` had the exact same
`coalesce(new.completed_at, now())` bug in `validate_snapshot_completion()`.
Fixed identically (`new.completed_at := clock_timestamp()`, unconditional).

**6. MINOR — `ambiguous` finalizing with only one candidate.**
`docs/LEGACY_EXERCISE_CROSSWALK.md`'s own "Statuses" section defines
`ambiguous` as "more than one canonical candidate is plausible," but its
"Statuses" prose and `validate_evaluation_finalization()`'s gate
(`v_candidate_count = 0`) both only required **at least one** — the SQL
under-enforced the document's own definition. No legitimate "ambiguous with
one candidate" semantics were found on re-reading the crosswalk document (it
consistently says "multiple"/"more than one" everywhere else), so per
instructions this was aligned to `>= 2`, not left as a documented exception.
Fixed the SQL gate to `v_candidate_count < 2` and corrected the "Statuses"
prose in the crosswalk doc, which had contradicted its own definition
("at least one must exist" → "at least two must exist").

**7. MINOR — `legacy_only` vs. draft-in-progress vs. never-evaluated.**
Reproduced exactly: `legacy_exercise_crosswalk_status` only joined against
`legacy_exercise_current_evaluation` (which only surfaces `final` rows), so
a legacy ID with an in-progress `draft` evaluation and zero finalized ones
showed as `legacy_only` — semantically indistinguishable from a legacy ID
nobody has ever evaluated. Fixed by adding a second join against any `draft`
row per legacy ID and a three-way `CASE`: a finalized evaluation's own
`match_status` takes priority; otherwise a draft evaluation (no final one
yet) yields `'draft_in_progress'`; otherwise `'legacy_only'`. Also added an
unconditional `has_draft_evaluation` boolean column so a **reevaluation** in
progress on top of an already-finalized legacy ID remains visible too (not
just the "never evaluated at all" case). Crosswalk doc's "Statuses" section
updated to document the three-state distinction.

**8. Documentation-consistency FAIL, corrected.** Line-by-line re-check of
both `docs/EXERCISE_INTEGRATION_CONTRACT.md` and
`docs/LEGACY_EXERCISE_CROSSWALK.md` against the corrected SQL found:
- the exact defect the review named: the comment above
  `require_complete_snapshot_for_crosswalk()` (and the crosswalk doc's
  "Representation in the SQL design" table) both claimed
  `legacy_exercise_evaluation_candidate` has a **direct** trigger calling
  that function, alongside `legacy_exercise_evaluation` and
  `exercise_reference`. Verified directly (grepped every `create trigger`
  in the SQL file): no such trigger exists on the candidate table. Its
  protection is **indirect**, via the composite FK
  (`legacy_exercise_evaluation_candidate_evaluation_fk`) that forces its
  `evaluated_snapshot_id` to equal its parent evaluation's own (already
  directly-gated) `evaluated_snapshot_id`. Corrected in both the SQL
  comment and the crosswalk doc's table;
- Tier-1 field enforcement (contract doc) updated to state it is now
  structural (CHECK + trigger), not merely declared;
- `finalized_at` wording (crosswalk doc, two places) updated to state it is
  fully server-controlled (`clock_timestamp()`, caller value ignored) and
  immutable once set;
- ambiguous candidate-count wording (crosswalk doc, two places: "Statuses"
  and the representation table) updated from "at least one" to "at least
  two";
- `legacy_only`/draft/never-evaluated wording (crosswalk doc, "Statuses")
  updated to document the three-state distinction;
- no other normative drift against the current ledger model was found on
  this re-check; no design history clearly labeled as history was removed.

**Locking analysis performed (R1-R4, mandatory per instructions).** No local
PostgreSQL was available in this environment — verified there is no `psql`,
`pg_ctl`, or `docker` on `PATH` in this session — and nothing was run
against Supabase, per instructions. Per the explicit fallback instruction
("realiza análisis transaccional explícito de dos sesiones y reporta esa
limitación"), a full two-session walkthrough for all four scenarios (R1:
child-mutation-first vs. finalize; R2: finalize-first vs. child-mutation; R3:
candidate-mutation-first vs. evaluation-finalize; R4: evaluation-finalize-first
vs. candidate-mutation) is recorded as a dedicated "R1-R4 locking analysis"
block comment near the end of `supabase/design/exercise_identity_mapping.sql`,
stating exactly which row lock each statement acquires, which side blocks,
and why the invariant survives either interleaving. This is reasoned static
analysis of the lock modes PostgreSQL documents for `SELECT ... FOR UPDATE`
and plain `UPDATE`, not an empirically-run test — that limitation is stated
explicitly rather than silently assumed away, exactly as revision 2 and 3 did
for the FK-target and Library-evidence gaps they could not directly verify
either.

**22-scenario regression (S1-S12, C1-C10), re-verified against the revision
6 SQL:**

All 22 remain PASS. None of the fixes above removed or weakened any
previously-passing guarantee — all changes either close a gap (BLOCKER/C9)
or add a new independent check (payload trigger, locking). One test's
*input* changes meaning, not its pass/fail outcome: **C2** ("finalize an
`ambiguous` evaluation with candidates present") must now supply **at least
two** candidate rows to reach a successful `final` transition, consistent
with fix #6 above; supplying only one (which revision 5's SQL would have
accepted) now correctly raises, which is the intended tightening, not a
regression.

**N1-N7 (new regression scenarios required by this review round):**

| # | Scenario | Expected | Result |
|---|---|---|---|
| N1 | `payload='{}'` → canonical row | FAIL | **FAIL as required** — `canonical_exercise_import_exercise_id_matches_payload`/`..._status_matches_payload` CHECKs reject it (their `is not null` guard evaluates false) |
| N2 | `evaluated_by=''`/`notes=''` → finalize matched | FAIL | **FAIL as required** — `legacy_exercise_evaluation_evidence_required_check` now rejects a blank value at INSERT time (before finalize is even reachable) via `btrim(...) <> ''` |
| N3 | `ambiguous` with 1 candidate → finalize | FAIL | **FAIL as required** — `validate_evaluation_finalization()`'s `v_candidate_count < 2` check raises |
| N4 | Caller supplies `finalized_at='2000-01-01'` | Cannot control current/latest | **Confirmed** — a draft row with a non-null `finalized_at` violates `legacy_exercise_evaluation_finalized_at_check` outright; a direct `final` INSERT is rejected by `validate_evaluation_finalization()`'s INSERT branch regardless of the supplied timestamp; and on the draft→final UPDATE path, `new.finalized_at := clock_timestamp()` unconditionally overwrites whatever the caller supplied |
| N5 | Draft evaluation exists, no final one | Not shown as never-evaluated/legacy_only | **Confirmed** — `legacy_exercise_crosswalk_status` now reports `'draft_in_progress'` for this case, distinct from `'legacy_only'` |
| N6 | Snapshot: concurrent child delete vs. finalize | Serialized, invariant preserved | **Confirmed by locking analysis** (R1/R2 — not empirically run; no local PostgreSQL available, stated as a limitation, not silently assumed) |
| N7 | Evaluation: concurrent candidate delete vs. finalize | Serialized, invariant preserved | **Confirmed by locking analysis** (R3/R4 — same limitation stated) |

**Disagreement with any review point, for the record:** none. Every
BLOCKER/MAJOR/MINOR/documentation-consistency point was reproduced directly
against the actual revision-5 SQL before being fixed (not taken on faith),
and none conflicted with anything revision 5 had already resolved — all
eight fixes are additive tightenings/corrections within the existing
snapshot + append-only-evaluation architecture, exactly as instructed
("NO rediseñes otra vez el modelo").

### Files modified (revision 6)

- `supabase/design/exercise_identity_mapping.sql` — targeted defect fixes
  only (see items 1-8 above), plus a new "R1-R4 locking analysis" block
  comment and an updated header banner / "Invariants enforced" closing
  section describing all of the above; no table's core architecture
  (snapshot lifecycle, append-only evaluation ledger, `exercise_reference`)
  was redesigned.
- `docs/EXERCISE_INTEGRATION_CONTRACT.md` — revision-6 note at the top, plus
  a "Structural enforcement" note under the Tier-1 field table (item 8
  above).
- `docs/LEGACY_EXERCISE_CROSSWALK.md` — revision-6 note at the top; "Statuses"
  (ambiguous ≥ 2, three-state legacy_only/draft_in_progress/finalized);
  "Confidence / evidence expectations" (btrim, server-controlled
  `finalized_at`); "Representation in the SQL design" table (indirect
  candidate protection, ambiguous ≥ 2, new locking row) (item 8 above).
- This task file (`Result` section only, this entry).

No other file was read for new evidence in this revision; this was a
targeted-defect-fix pass responding to a directed adversarial review of the
existing SQL design, not new fact-finding about the Library or the deployed
GymApp schema.

**No SQL was executed** against any database, local or production, per
instructions. Correctness was verified by a full manual re-read of every
changed constraint/trigger/view/function against all 22 regression
scenarios plus N1-N7, and by the explicit two-session locking analysis
described above (no local PostgreSQL was available to run it empirically —
stated as a limitation, not silently assumed away).

### Git status at end of task

Branch `setup/agent-workspace`. `tasks/review/GA-001-exercise-integration-contract.md`
remains in `tasks/review/` with status `REVIEW` (unchanged, per
instructions — GA-001 is not moved to `done`, no SQL was applied). No
application file was touched, nothing was committed, nothing was pushed. See
the top-level "Git status" / "Validations performed" report in this task's
chat response for the exact `git status --short` / `git diff --stat` output
at the end of this revision.

### Revision 7 — task closure: DESIGN BASELINE accepted, implementation hardening required (no further review/implementation performed)

This revision does not perform another implementation or review iteration.
It closes GA-001 on an explicit, human-directed basis: the design produced
across revisions 1–6 is accepted as the GymApp reengineering **design
baseline**, not as production-ready executable SQL.

**Final independent review result:** the fifth adversarial review round
(revision 6, above) is the last review this task received. Its outcome for
`supabase/design/exercise_identity_mapping.sql` as an executable artifact is
**REQUEST_CHANGES**. The architectural contract — the ownership boundary,
`GEC-1` versioning approach, the content-addressed/lifecycle-tracked
snapshot pattern, and the append-only evaluation ledger — is **accepted**
for continuation of GymApp reengineering. These are two different verdicts
about two different things and must not be conflated: the *shape* of the
design is accepted; the *SQL as written* is not cleared to run anywhere.

**Revision 6 remains the accepted design baseline.** No SQL, doc, or
architecture change is made in this revision beyond adding an explicit
NOT PRODUCTION READY / DO NOT EXECUTE notice (see "Files modified" below)
to the three deliverables and this closure entry to this task file.

**Implementation hardening requirements (HARD-001 through HARD-005).**
These are the final independent review's outstanding findings, recorded
here as explicit, binding requirements that MUST be resolved before
`supabase/design/exercise_identity_mapping.sql` may be applied to any
database. They are not waived, not hidden, and no claim is made anywhere in
this task or its deliverables that the SQL is production-ready.

- **HARD-001 (BLOCKER — before SQL execution).** Enforce GEC-1 JSON types
  and canonical `exercise_id` syntax. The design currently checks field
  *presence* (e.g. `payload ->> 'exercise_id' is not null`) and cross-row
  *equality* (payload vs. projected column), but does not enforce that
  `payload` fields conform to GEC-1's declared JSON *types*, nor that
  `exercise_id` values (wherever accepted — `canonical_exercise_import`,
  `legacy_exercise_evaluation`, `legacy_exercise_evaluation_candidate`,
  `exercise_reference`) match the canonical syntax documented in
  `docs/EXERCISE_INTEGRATION_CONTRACT.md` ("Canonical exercise identifier
  semantics": `^[a-z0-9][a-z0-9_-]*$`). Without this, a malformed or
  wrong-shaped value (e.g. `exercise_id` as a JSON number, or a string that
  does not match the canonical pattern) can pass every existing constraint.
- **HARD-002 (BLOCKER — before SQL execution).** Cryptographically bind
  stored raw export/taxonomy payloads, declared hashes, normalized records,
  taxonomy identity, and record counts. The current design computes
  `raw_export_sha256`/`taxonomy_fingerprint` and validates `record_count`
  and the taxonomy fingerprint at finalize time (`validate_snapshot_completion()`),
  but nothing in the schema itself cryptographically ties the *stored*
  `canonical_import_raw_artifact.raw_export_payload` bytes, the *stored*
  `canonical_import_raw_taxonomy.raw_payload` bytes, and the *normalized*
  `canonical_exercise_import.payload` rows into one another as a single
  verifiable chain — each piece is checked against the header's declared
  hash/count independently, but an operator cannot re-derive one artifact's
  hash from the others and confirm the whole chain is internally consistent
  without external tooling. This must be closed before any import produced
  by this design is treated as trustworthy audit evidence.
- **HARD-003 (before `canonical_exercise_current` is relied upon).**
  `canonical_exercise_current`'s ordering (`order by cei.exercise_id,
  s.imported_at desc, s.id desc`) uses `canonical_import_snapshot.imported_at`
  — a caller-supplied/`now()`-defaulted, import-attempt timestamp — as
  "currency" chronology. This must instead use server-controlled
  *completion* chronology (i.e. `completed_at`, which is already
  unconditionally server-set by `validate_snapshot_completion()` via
  `clock_timestamp()` and cannot be caller-influenced) so that "current" is
  not vulnerable to an operator recording an inaccurate or backdated
  `imported_at` on an otherwise-legitimate snapshot. No consumer of this
  view should be built against the existing `imported_at`-based ordering
  until this is fixed.
- **HARD-004 (during implementation hardening).** `evaluation
  gec_contract_version` must be present and consistent with its evaluated
  snapshot. `legacy_exercise_evaluation` references `evaluated_snapshot_id`
  and is gated to require a `complete` snapshot, but the evaluation does not
  itself carry (and cross-check) a `gec_contract_version` proving which
  `GEC-*` contract revision the evaluation was performed under, independent
  of whatever `canonical_import_snapshot.gec_contract_version` happens to
  say at query time. This must be added and enforced (e.g. by
  trigger/CHECK, mirroring `validate_canonical_exercise_import_payload()`'s
  cross-table pattern) before evaluations are treated as reproducible audit
  records across future `GEC-*` revisions.
- **HARD-005 (during implementation hardening).** Reconcile/enforce
  confidence semantics for non-matched statuses. The design's `confidence`
  vocabulary and rules (`docs/LEGACY_EXERCISE_CROSSWALK.md`, "Confidence /
  evidence expectations") are written primarily in terms of `matched`;
  `unmatched` and `ambiguous` evaluations' expected `confidence` values (per
  row and per candidate) are not fully reconciled with the enforced CHECK
  constraints (`legacy_exercise_evaluation_matched_requires_target`,
  the evidence-required check). This must be resolved — either by explicit
  per-status confidence rules enforced structurally, or by an explicit,
  documented decision that confidence does not apply to certain statuses —
  before this table is used to drive any downstream ranking/prioritization
  logic.

**Binding statements for this closure, restated explicitly per the closing
directive:**

- HARD-001 and HARD-002 are **BLOCKERS** before `supabase/design/exercise_identity_mapping.sql`
  is executed against any database, staging or production.
- HARD-003 must be resolved before `canonical_exercise_current` is relied
  upon by any consumer.
- HARD-004 and HARD-005 must be resolved during implementation hardening
  (i.e. before/alongside the task that actually applies this design), not
  deferred indefinitely.
- The current SQL **MUST NOT** be executed against Supabase, staging, or
  production, by any agent, under this closure.
- These findings are recorded in full here and in the three deliverables'
  new notices; none is waived, minimized, or hidden.
- No claim is made anywhere in this task or its deliverables that
  `supabase/design/exercise_identity_mapping.sql` is production-ready.
- **Revision 6 remains the accepted design baseline.**
- **Final review result:** `REQUEST_CHANGES` for the SQL as an executable
  implementation artifact; the architectural contract (ownership boundary,
  `GEC-1` contract, snapshot lifecycle, append-only evaluation ledger) is
  **accepted** for continuation of GymApp reengineering.

**Explicitly not done in this revision** (per the closing directive): no
attempt was made to fix HARD-001 through HARD-005; no further review was
run; no SQL was executed against any database; no application code was
modified; no production system was touched; nothing was merged; GA-002 was
not created/started.

### Files modified (revision 7)

- `supabase/design/exercise_identity_mapping.sql` — added a prominent NOT
  PRODUCTION READY / DO NOT EXECUTE notice at the top of the file,
  referencing HARD-001 through HARD-005. No table, constraint, trigger, or
  function definition was changed.
- `docs/EXERCISE_INTEGRATION_CONTRACT.md` — added the same notice near the
  top (below the existing "Status: PROPOSED" line). No other content
  changed.
- `docs/LEGACY_EXERCISE_CROSSWALK.md` — added the same notice near the top
  (below the existing "Status: PROPOSED" line). No other content changed.
- This task file — status line updated to `DONE — DESIGN BASELINE /
  IMPLEMENTATION HARDENING REQUIRED`; this closure entry added; moved
  (`git mv`) from `tasks/review/` to `tasks/done/`.

### Pending decisions (unchanged from revision 6, restated for closure)

Everything under "Pending decisions" above remains open and requires
explicit human approval before proceeding, in addition to HARD-001 through
HARD-005 above:

1. Whether to apply this design to a non-production/staging environment
   (never production without approval), and independent confirmation that
   `ejercicios.id` carries a PK/UNIQUE constraint in the target database.
2. Whether GymApp should formally request a Library-side manifest/version
   marker, or rely solely on its own commit-pinning/content-hashing.
3. Whether to formally request that `Gym-Exercise-Library` document an
   explicit `exercise_id` stability/rename policy.

GA-002 (the read-only legacy reference snapshot/census task proposed in
revision 3) remains proposed, not created.
