# Exercise Integration Contract (GymApp ⇄ Gym-Exercise-Library)

Status: PROPOSED (design only — nothing in this document has been implemented or applied).

> **NOT PRODUCTION READY — DO NOT EXECUTE.** GA-001 is closed as the GymApp
> reengineering **design baseline**, not as a production-ready implementation.
> The companion SQL design (`supabase/design/exercise_identity_mapping.sql`)
> must not be applied to any database until HARD-001 through HARD-005 are
> resolved (HARD-001/HARD-002 are blockers before execution; HARD-003 blocks
> reliance on `canonical_exercise_current`; HARD-004/HARD-005 must be resolved
> during implementation hardening). See "Revision 7" in the `Result` section
> of `tasks/done/GA-001-exercise-integration-contract.md` for the full,
> binding list.

Revision note: this document was revised in response to two rounds of
REQUEST_CHANGES from independent review of `GA-001`. See the "Result"
section of `tasks/review/GA-001-exercise-integration-contract.md`
("Revision 2" and "Revision 3") for the point-by-point response to each
round. Facts re-verified are dated against `Gym-Exercise-Library` commit
`aaf55d8417dc9fd0aaa38ebf9be9016040dce9eb` (confirmed identical to
`origin/main` at the time of revision 2, working tree clean).

**Revision 6 summary (fifth adversarial review round, targeted fixes only —
no architecture change):** an independent adversarial review of revision 5
found `payload={}` could pass as a canonical import row (a `payload ->> 'x' =
column` CHECK is satisfied, not violated, when PostgreSQL evaluates it to
NULL because the key is absent), two unlocked race conditions between child
mutation and parent finalization (both for snapshots and for evaluations),
`evaluated_by=''`/`notes=''` passing as evidence, `finalized_at`/
`completed_at` being controllable by a caller-supplied value, `ambiguous`
finalizing with only one candidate (contradicting this document's own
definition), and a draft evaluation being indistinguishable from "never
evaluated." All were fixed in
`supabase/design/exercise_identity_mapping.sql`; see that file's header
banner and Revision 6 in `tasks/review/GA-001-exercise-integration-contract.md`
for the full list. This revision's changes to this document are the "Field
tiers" note on structural enforcement below and nothing else — the ownership
boundary, identifier semantics, taxonomy versioning, and contract/version
sections are unchanged.

**Revision 3 summary (second review round):** the snapshot design in
`supabase/design/exercise_identity_mapping.sql` was restructured so a
snapshot's identity is content-addressed and lifecycle-tracked
(`building`/`complete`, immutable once complete) rather than
attempt-timestamped; the raw canonical export and raw taxonomy files are now
stored (inline or via a durable reference), not just their hashes; the
crosswalk's referential integrity and evidence requirements were tightened;
and a concrete "future exercise reference" strategy (`exercise_reference`
entity) was chosen for exercises that may never have a legacy
`ejercicios` row. See "Taxonomy versioning", "Contract / version
identifier", "Detecting / importing a newer Library contract", and
`docs/LEGACY_EXERCISE_CROSSWALK.md`'s "Rules for future routine generation"
below, all updated accordingly.

This document defines how GymApp consumes canonical exercise identity and
objective exercise metadata from `Ohtli-Admin/Gym-Exercise-Library` ("the
Library"). It is produced by task `GA-001`. See
`docs/LEGACY_EXERCISE_CROSSWALK.md` for how legacy GymApp exercise IDs relate
to canonical IDs, and `supabase/design/exercise_identity_mapping.sql` for the
proposed (unapplied) storage layer.

## Evidence this document is based on

Inspected directly, in the sibling working copy at
`../Gym-Exercise-Library` (local clone, not GitHub API — see "Evidence gaps"
below):

- `schemas/exercise.schema.json` — the canonical exercise JSON Schema,
  `schema_version` const `"0.2"`.
- `output/gym-exercise-library/catalog.json` and
  `catalog/canonical/SRC-002/exercises.json` — byte-identical, 876 records.
  `scripts/build-app.js` confirms `catalog.json` is produced by copying
  `catalog/canonical/SRC-002/exercises.json` verbatim (`fs.copyFileSync`),
  after asserting the array has exactly 876 entries. **No wrapping manifest,
  export timestamp, or contract/version field exists at the top level today**
  — the export is a bare JSON array of exercise records.
- Every one of the 876 records currently has `status: "draft"` and
  `review.status: "review_required"` (verified by counting all records —
  zero are `approved`). Per `docs/PROJECT_STATE.md` in that repository,
  deduplication, variant resolution, and biomechanical enrichment are not
  yet done.
- `taxonomy/body-regions.json`, `taxonomy/muscles.json`,
  `taxonomy/joint-actions.json`, `taxonomy/movement-patterns.json`,
  `taxonomy/equipment.json`, `taxonomy/grips.json`,
  `taxonomy/body-positions.json`, `taxonomy/training-types.json`,
  `taxonomy/difficulty.json` — the controlled vocabularies that every
  `classification.*`/`setup.*` id-array in an exercise record references by
  ID (`exercise.schema.json`'s `idArray`/`nonEmptyIdArray` definitions are
  bare string-pattern arrays; they do not embed the vocabulary itself).
  **Each of these files is a bare JSON array (or, for `difficulty.json`, a
  bare object) with no top-level `version`, `hash`, or `generated_at`
  field.** This is the evidence behind "Taxonomy versioning" below.
- Corrected from the prior revision of this document: `media.primary_image`
  is **not** null for all 876 records. Programmatically re-checked: exactly
  2 of 876 records have a non-null `media.primary_image`
  (`src-002-cfd0746bbd0f73af`, `src-002-7c275f916ac75019`), both pointing at
  `/assets/exercises/<exercise_id>/primary.png`, which exists on disk for at
  least one of them
  (`assets/exercises/src-002-7c275f916ac75019/primary.png`). Every other
  `media.*` field (`video_path`, `preview_path`, `start_image`, `end_image`,
  `anatomy_image`, `muscle_map_path`) remains null across all 876 records;
  `media.animation_status` also has non-null values on some records. GymApp
  must not assume media is universally absent — only that coverage is
  currently sparse (2 of 876 for the one populated field) and must not be
  relied on for production UX yet.
- `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`, `docs/DECISIONS.md`,
  `AGENTS.md` in that repository, and this repo's `docs/CURRENT_STATE_RECONCILIATION.md`
  and `docs/REENGINEERING_DECISION_FRAME.md`.
- GymApp's actual current consumption of `ejercicios`: `supabase/functions/generate-routine/index.ts`
  selects exactly `id, nombre, grupo_muscular, equipo, nivel, contraindicaciones`
  from `ejercicios` and uses `equipo` for equipment filtering, `grupo_muscular`
  for muscle-group text filtering, and `contraindicaciones` for injury exclusion.
  `app.js` reads `ejercicios(nombre, grupo_muscular)` via the `rutina_ejercicios`
  join, and separately queries `ejercicios` by name substring when the user
  manually adds an alternative exercise.
- `supabase/baseline/schema_snapshot.sql` — `ejercicios.id` and
  `rutina_ejercicios.ejercicio_id` / `series_registradas.ejercicio_id` are all
  `text`, not `uuid`. This matters: canonical `exercise_id` values (e.g.
  `src-002-903b8fd1f633976e`) are also strings, so no type coercion is needed
  for either side of a mapping.

### Evidence gaps (not inspected, not fabricated)

- No GitHub API access was available in this session (`gh` CLI not
  installed); the Library was inspected via its local sibling working copy
  instead. For this revision, `git status --short` in
  `../Gym-Exercise-Library` reported a clean working tree, and
  `git rev-parse HEAD` (`aaf55d8417dc9fd0aaa38ebf9be9016040dce9eb`) matched
  `git rev-parse origin/main` exactly — so the local copy is confirmed
  identical to `origin/main` as of this revision's timestamp, resolving the
  prior revision's "pending decision" on this point. A future agent should
  re-verify this each time, since the local copy can drift again after this
  check.
- No published Library release, tag, or CHANGELOG was found. `package.json`
  version (`0.1.0`) versions the local catalog-browser app, not the
  catalog export.
- No historical example of a Library schema migration (e.g. `0.1` → `0.2`)
  was available to inspect, so "how a version bump behaves in practice" is
  a proposal, not a verified precedent.

## Ownership boundary

Consistent with `AGENTS.md` and `docs/REENGINEERING_DECISION_FRAME.md`:

**Gym-Exercise-Library owns** (objective, user-independent): canonical
exercise identity (`exercise_id`), names/aliases, anatomical classification,
movement patterns/joint actions, equipment requirements, training-domain
classification, difficulty metadata, biomechanics, canonicalization/variant
relationships, media and media provenance, source provenance.

**GymApp owns** (user-dependent, application-specific): which canonical
exercises a given user may safely be shown right now (compatibility
interpretation), profile/preferences/goals/context, physical
constraints/rehabilitation lifecycle, routine planning/generation/execution,
substitutions, history/progress.

**Consequence for this contract:** the Library schema, as it exists today,
has no `contraindicaciones`-equivalent field. Safety exclusion is therefore a
GymApp-side interpretation of objective Library attributes
(`biomechanics.constraints`, `classification.joint_actions`,
`classification.movement_patterns`, `classification.primary_muscles`) against
a user's declared physical constraints. GymApp's own design must not depend
on the Library ever publishing a "safe/unsafe" flag — that is a statement
about what GymApp will build its compatibility layer to *not* require, not a
directive to the Library team about what it "must never contain." Whether
`Gym-Exercise-Library` ever adds such a field is that repository's own
product decision, outside `AGENTS.md`'s GymApp-side scope and outside what
this contract can bind. (Corrected from the prior revision of this document,
which stated this as a normative "should not gain one" claim about the
Library — that overstepped what a consumer contract can assert about a
producer it does not own.)

## Canonical exercise identifier semantics

### Confirmed (verified directly against `exercise.schema.json` / the Library repo)

- The canonical identifier is `exercise_id`, a string matching
  `^[a-z0-9][a-z0-9_-]*$` (per `exercise.schema.json`), e.g.
  `src-002-903b8fd1f633976e`.
- `exercise_id` is minted by the Library; GymApp never generates or edits
  values in this namespace.
- `status` is an enum (`draft`, `review_required`, `approved`, `deprecated`)
  on the *same* record object — a `status` transition is not represented
  anywhere in the schema as a different `exercise_id`, so at minimum the
  schema does not model status transitions as identity changes.
- `exercise_id` is opaque to GymApp by this contract's own choice: GymApp
  must not parse it for meaning (e.g. must not assume the `src-002-` prefix
  is permanent or meaningful for routing logic), regardless of what the
  Library intends. Provenance (which source contributed a record) is carried
  in the record's own `provenance` array, not the ID.
- GymApp's own legacy identifiers (`ejercicios.id`, text) live in a disjoint
  namespace and are never mixed with `exercise_id` values in the same column.
  See `docs/LEGACY_EXERCISE_CROSSWALK.md`.

### Proposed / GymApp-side policy (NOT a confirmed upstream guarantee)

Corrected from the prior revision of this document, which asserted
`exercise_id` "is stable once a record exists" and that a Library-side
rename "is a new identity, not an edit" as if these were confirmed facts.
Neither is documented anywhere in the Library repository as inspected at
commit `aaf55d8417dc9fd0aaa38ebf9be9016040dce9eb`
(`docs/DECISIONS.md`, `docs/ARCHITECTURE.md`, `docs/PROJECT_STATE.md`,
`docs/ROADMAP.md`, `schemas/exercise.schema.json` — none of them make an
explicit permanence/no-reuse/rename-is-new-identity guarantee about
`exercise_id`). GymApp does not control `Gym-Exercise-Library` and cannot
invent upstream semantics that repository has not stated.

Given that gap, this is what GymApp adopts as its own operating policy,
clearly labeled as GymApp's assumption pending upstream confirmation, not as
fact:

- GymApp will *treat* `exercise_id` as intended-stable for as long as no
  evidence contradicts that (i.e. GymApp will not proactively design around
  the possibility of ID reuse), because the alternative (never trusting any
  canonical ID) makes any crosswalk pointless.
- GymApp will *not* assume it can detect a Library-side rename automatically
  the day it happens. Detection is only possible in the terms this design
  can actually observe: comparing two `canonical_import_snapshot`s (see the
  SQL design) and noticing an `exercise_id` present in one and absent from
  the next (see "Removal / deprecation detection" in the SQL design) — this
  looks identical whether the Library removed the exercise, deprecated it
  under this same ID, or "renamed" it in a way the Library itself considers
  a new ID. GymApp cannot distinguish these cases from the outside.
- **Succession, not identity-merging:** when a human/agent believes a
  newer canonical record replaces one GymApp previously matched, this is
  recorded as a `superseded_by_exercise_id` pointer on a **new**
  `legacy_exercise_evaluation` row (see the SQL design) — a GymApp-local,
  manually-asserted claim, not a Library-confirmed identity relationship,
  and not a hard foreign key (GymApp cannot validate a claim about Library
  internals it does not own). This never merges, deletes, or rewrites the
  prior evaluation; both remain as independently retrievable rows in the
  append-only `legacy_exercise_evaluation` ledger.
- If `Gym-Exercise-Library` ever documents an explicit stability/rename
  policy, this section must be revised to cite it directly and the
  "Proposed" heading above should be replaced with "Confirmed."
- This is a requirement GymApp places on **its own design**, not a change
  request to the Library team. If GymApp later wants the Library to commit
  to an explicit identity-stability policy, that is a separate, explicit
  ask to that repository's owners — not something this document can decide
  unilaterally on the Library's behalf.

## Taxonomy versioning

**BLOCKER in the prior revision of this document, addressed here:** every
`classification.*` and `setup.*` field this contract consumes
(`body_regions`, `primary_muscles`, `equipment_required`,
`equipment_optional`, etc.) is an array of opaque taxonomy IDs
(`exercise.schema.json`'s `idArray`), not self-describing values. Their
meaning ("what does `pectoralis_major_clavicular` mean") lives entirely in
`taxonomy/*.json` in the Library repository — files that, as inspected, are
bare arrays/objects with **no version, hash, or `generated_at` field of
their own**. A contract that pins `exercise_id`/`source_commit` but not the
taxonomy content those IDs are meaningless without is incomplete: two
imports at different Library commits could both claim `schema_version:
"0.2"` while the *meaning* of a `primary_muscles` ID silently changed
between them (a taxonomy entry renamed, removed, or reparented).

**This contract's requirement (GymApp consumer-side, not a request to the
Library):** every GymApp import must capture, alongside `source_commit`, the
EXACT raw content (not just a hash) of every `taxonomy/*.json` file present
at that commit, bundled into the same content-addressed snapshot as the
exercise records themselves. **Revision 3 correction:** revision 2 only
required a hash+count summary (`canonical_import_snapshot.taxonomy_snapshot`
jsonb); a second review round correctly pointed out that a snapshot claiming
to be self-sufficient for interpreting its own exercise records must retain
the taxonomies themselves, not only a fingerprint of them. The SQL design
now has a dedicated `canonical_import_raw_taxonomy` table holding the exact
raw content (inline or a durable reference) of each `taxonomy/*.json` file,
one row per file per snapshot; `canonical_import_taxonomy_summary` is a
derived, read-only view over that table (never independently written, so it
cannot drift from the raw rows it summarizes). The snapshot header's
`taxonomy_fingerprint` column is a deterministic aggregate hash over these
raw rows' own hashes, and is cross-checked against them at the moment a
snapshot is finalized (see `finalize_canonical_import_snapshot()` in the
SQL design) — a header cannot claim a taxonomy fingerprint that its own raw
rows don't actually produce. GymApp satisfies this requirement itself; it
does not require any upstream change to do so, because file content can be
hashed and stored regardless of whether the Library publishes its own
version marker.

**Raw export, raw taxonomies, and the normalized projection are three
distinct things in this design**, per the second review's explicit request
not to conflate them:
- the **raw artifact** (`canonical_import_raw_artifact`) — the exported
  exercise array itself, inline or via a durable GymApp-controlled
  reference;
- **raw taxonomies** (`canonical_import_raw_taxonomy`) — the exact
  controlled-vocabulary files, inline or via a durable reference, one row
  per file;
- the **normalized/queryable projection** (`canonical_exercise_import`) —
  one row per exercise record, with the full record payload plus computed
  `field_completeness`, used for actual querying.

Because the raw artifact and raw taxonomies are retained durably inside
GymApp's own tables (not merely referenced by hash), GymApp never needs to
re-read `Gym-Exercise-Library`'s internal historical files to interpret an
already-imported snapshot.

**Capability/completeness representation:** because canonical records are
currently `draft`/`review_required` with widely varying field population
(`docs/SRC-002-CANONICAL-DRAFT-REPORT.md` in the Library repo: e.g. 610/876
records have equipment, 625/876 have body regions, 0/876 have movement
patterns), this contract requires each imported record to carry a computed
`field_completeness` summary (which of the tiered fields below are actually
populated) rather than GymApp inferring completeness by re-parsing the full
payload on every read. See `canonical_exercise_import.field_completeness` in
the SQL design.

**What this document does not do:** it does not ask
`Gym-Exercise-Library` to add versioning/hashing to `taxonomy/*.json`
itself. That would be a reasonable *request* to raise with that repository's
owners — a taxonomy-level `version`/`hash` field would let this pinning be
automated and shared across consumers — but it is a suggestion to a
producer GymApp does not control, not a requirement this contract can
impose on it. If GymApp wants to make that request formally, it belongs in
a separate, explicit communication to `Gym-Exercise-Library`'s maintainers,
not asserted here as if already agreed.

## Contract / version identifier

Two version concepts exist and must not be conflated:

1. **Record schema version** (`schema_version`, currently the const `"0.2"`)
   — describes the shape of one exercise record. This already exists
   upstream and is enforced by `exercise.schema.json`.
2. **GymApp consumer contract version** — does not exist upstream yet. This
   document defines it: `GEC-1` (GymApp Exercise Contract, revision 1),
   scoped to consuming `schema_version: "0.2"` records with the minimum
   field set defined below. GymApp code and the crosswalk/import tables
   (see the SQL design) must record which `GEC-*` version they were built
   against, not just the raw `schema_version` string, because GymApp may
   choose to ignore fields it isn't ready to consume yet even if the
   Library adds them non-breakingly.

Because the Library currently exports a bare array with no manifest, GymApp
cannot yet detect "which export/date/count is this" automatically from the
export file alone.

**GymApp's own consumer-side requirement** (satisfied entirely within
GymApp's own import process, without any upstream change): every import
must be pinned as an explicit `canonical_import_snapshot` (see the SQL
design) recording the operator-verified `source_commit`, the observed
`record_count`, and the raw taxonomy content described above. **Revision 3:**
the snapshot's identity is now content-addressed (a `content_fingerprint`
generated by Postgres itself from `raw_export_sha256` and
`taxonomy_fingerprint`, unique) rather than merely timestamped per attempt —
re-pinning the exact same content resolves to the same snapshot row instead
of minting a new one, and the snapshot only becomes immutable and usable by
the crosswalk once it reaches `status = 'complete'` (validated by
`finalize_canonical_import_snapshot()`, which checks `record_count` and the
taxonomy fingerprint against what was actually stored before allowing that
transition). An operator (human or explicitly authorized agent) is
responsible for recording the Library's git commit SHA at the moment a
snapshot is copied into GymApp's import layer — this is a manual, reviewed
step, not an automatic one, until/unless something changes upstream.

**Corrected from the prior revision of this document:** that revision
stated "this contract requires the Library to eventually publish a
manifest" and specified its exact field names/shape
(`contract_schema_version`/`generated_at`/`record_count`/`source_commit`) as
if GymApp were entitled to dictate that to the Library repository. GymApp is
a consumer of `Gym-Exercise-Library`, not its owner, and `AGENTS.md` does
not give this contract authority over that repository's design. The
distinction that matters:

- **What GymApp requires of itself:** a way to know which snapshot (commit +
  taxonomy content + record count) it is looking at, at import time. GymApp
  meets this requirement unilaterally via `canonical_import_snapshot`,
  regardless of what the Library ever does.
- **What GymApp might request of the Library** (a separate conversation,
  not decided or imposed here): if `Gym-Exercise-Library` chooses to publish
  its own manifest/version marker, GymApp's manual pin-and-verify step could
  become an automated comparison instead. GymApp does not prescribe that
  manifest's exact shape to the Library team — the Library owns its own
  export format, per the ownership boundary above — and this document does
  not claim upstream agreement to add one.

## Field tiers

**Corrected from the prior revision of this document:** that revision
listed fields in a single "minimum fields" table that quietly mixed what
GymApp's *current* code paths actually need, what a *future* compatibility
engine will need, and "reserved" fields, with no separation between the
minimal identity/matching contract and everything else. Review flagged this
as insufficiently separated. Four tiers, kept explicitly distinct:

### 1. Minimum identity/matching contract (required for any
`legacy_exercise_evaluation` row to exist at all)

| Field | Why minimum |
|---|---|
| `exercise_id` | Canonical identity; required for any mapping row to exist. |
| `status` | GymApp must not treat `draft`/`review_required` records as equivalent in trust to `approved` ones once `approved` records exist. Today (all-draft) this gates the whole first slice to "staging only." |
| `names.en`, `names.es` | Needed to even display a human-readable candidate during matching/review; `es` may be `null` (verified on sampled records), so display logic must fall back to `en`. |

**Structural enforcement (revision 6):** all three of the above are now
enforced by `supabase/design/exercise_identity_mapping.sql`, not merely
declared here — `exercise_id`/`status` presence-and-match by CHECK
constraints on `canonical_exercise_import` (fixed in revision 6 to reject a
payload missing the key, not just a payload with a *different* value), and
`payload.schema_version` (present, matching the parent snapshot's
`library_schema_version`) plus `payload.names.en` (present, non-blank; `names.es`
deliberately not required, per the row above) by a dedicated trigger,
`validate_canonical_exercise_import_payload()`, since the schema-version
match is a cross-table comparison a same-row CHECK cannot express.

### 2. Optional capability fields (populate GymApp's current
`generate-routine`/`app.js` consumption if/when GymApp starts reading them;
not required for a crosswalk row to exist, and may be null/empty per
"Field tiers" above)

| Field | Replaces / maps to legacy |
|---|---|
| `classification.body_regions`, `classification.primary_muscles` | `ejercicios.grupo_muscular` (a single mixed-taxonomy string; canonical replaces it with controlled, multi-value arrays). |
| `setup.equipment_required`, `setup.equipment_optional` | `ejercicios.equipo` (a single mixed-language string). |
| `difficulty.overall` | `ejercicios.nivel`. Note: GymApp currently hard-codes `nivel = 'intermedio'` client-side (a GymApp bug already recorded in `docs/CURRENT_STATE_RECONCILIATION.md`), not a Library problem. |

### 3. Future Compatibility Engine requirements (not required by anything
GA-001 builds; recorded so a future task does not have to re-discover them)

| Field | Why future, not now |
|---|---|
| `biomechanics.constraints`, `classification.joint_actions` | No legacy equivalent (`contraindicaciones` is currently always empty). Needed only once the compatibility engine (`docs/REENGINEERING_DECISION_FRAME.md`) exists to replace that never-populated field. |
| `media.primary_image`, `media.video_path`, and the rest of `media.*` | Coverage is currently sparse (2 of 876 records have a non-null `primary_image`; every other media field is null across all 876). GymApp must not assume media presence for any canonical record today, and no consumer reads these fields yet. |

### 4. Raw snapshot for audit (always stored, regardless of tier)

GymApp stores the **full record payload**, unmodified, for every imported
record (`canonical_exercise_import.payload`, see the SQL design) — not a
hand-picked column subset. This means tiers 2 and 3 can be adopted later by
GymApp code without a re-import or a schema change; only tier 1 gates
whether a crosswalk row can exist, and `field_completeness` (see "Taxonomy
versioning" above) records which tier-1/tier-2 fields are actually populated
per record without needing to re-parse `payload` on every read.

Everything else in `exercise.schema.json` (grips, canonicalization/variant
fields, secondary/stabilizer muscles, full biomechanics) is likewise covered
by the raw payload and may be adopted into a named tier later without a
GymApp schema change.

## Fields that remain GymApp-owned (never sourced from the Library)

- Exercise **compatibility for a specific user** (allowed/excluded/
  conditional) — derived at GymApp's compatibility layer, not published by
  the Library.
- Any notion of "contraindication" as a first-class field — see "Ownership
  boundary" above.
- Difficulty as applied to a specific user (`perfiles.nivel`) — the
  Library's `difficulty.overall` describes the exercise, not the user.
- Historical association between a *routine/session* and an exercise
  (`rutina_ejercicios`, `series_registradas`) — these keep referencing
  GymApp's own legacy IDs; see the crosswalk document.

## Compatibility / backward-compatibility expectations

- Within `GEC-1` (i.e. while consuming `schema_version: "0.2"`), GymApp must
  tolerate: new optional fields being added, `null`/empty-array values for
  any field GymApp does not require (already true for most fields today),
  and existing `exercise_id`s changing `status` (including a currently
  `approved` record moving to `deprecated`). GymApp's own policy is to
  *treat* an `exercise_id` as not being reused for a different exercise —
  see "Proposed / GymApp-side policy" under "Canonical exercise identifier
  semantics" above for why this is GymApp's assumption, not a confirmed
  upstream guarantee.
- A change that removes a required field, changes a field's meaning, or
  changes `schema_version` to a new value (e.g. `"0.3"`) is a **breaking
  change** and requires a new `GEC-*` contract revision in this document
  plus explicit review of every consumer (`generate-routine`,
  `regenerate-day`, and any future compatibility engine) before GymApp
  imports records under it. GymApp must not auto-upgrade silently.
- Because every current record is `draft`/`review_required`, GymApp must
  not build production-facing behavior (e.g. driving real routine
  generation) directly from today's export. The first implementation slice
  after GA-001 (see below) is explicitly a staging/import exercise, not a
  cutover.

## Detecting / importing a newer Library contract

Given the evidence gap (no manifest today), the process is:

1. An operator (human or explicitly authorized agent) pins a specific
   `Gym-Exercise-Library` git commit SHA as the source of an import, and
   creates a `canonical_import_snapshot` header row in `status = 'building'`
   with the mandatory `raw_export_sha256` and `taxonomy_fingerprint`.
2. The full record array is copied as-is (no field stripping) into
   GymApp's import layer (`canonical_exercise_import` in the SQL design),
   tagged with that snapshot and the `GEC-*` version this document defines;
   the raw export and raw taxonomy files are stored in
   `canonical_import_raw_artifact` / `canonical_import_raw_taxonomy`.
3. The operator calls `finalize_canonical_import_snapshot()`, which
   validates `record_count` and the taxonomy fingerprint against what was
   actually stored and, only if they match, transitions the snapshot to
   `status = 'complete'`. **Revision 3 correction:** this replaces the
   revision 2 mechanism of a manually-flipped `is_current` boolean, which
   the second review round correctly flagged as not a reliable identity/
   currency mechanism. "Which import is current for a given `exercise_id`"
   is now derived — via the `canonical_exercise_current` view, computed from
   the most recently imported row among `complete` snapshots — never stored
   as a mutable flag. Records are never mutated in place inside GymApp's
   import layer, and once a snapshot is `complete`, neither its header nor
   its `canonical_exercise_import` rows can be updated or deleted (enforced
   by trigger); a new import always produces a new (or, for byte-identical
   content, the same, content-addressed) snapshot, so prior imports remain
   inspectable and reproducible.
4. An **incomplete** (`building` or `failed`) snapshot can never be
   referenced by `legacy_exercise_evaluation`,
   `legacy_exercise_evaluation_candidate`, or the future `exercise_reference`
   entity — enforced by trigger, not merely documented, per the second
   review's explicit requirement.
5. If `Gym-Exercise-Library` ever publishes its own manifest/version
   marker (see "Contract / version identifier" above — this is a possible
   future request to the Library team, not something this document assumes
   will happen), step 1 could become an automated comparison instead of a
   manual one; the manual pin-and-verify process remains valid as a
   fallback either way and is what GA-001 assumes.

## Removed / deprecated / renamed canonical records

- `status: "deprecated"` already exists in the Library schema. GymApp must
  treat a deprecated `exercise_id` as: excluded from *new* routine
  generation candidates, but still resolvable for any crosswalk/history row
  that already points to it (do not cascade-delete or null out references).
  This part is confirmed directly from `exercise.schema.json`'s `status`
  enum.
- What GymApp cannot confirm (see "Canonical exercise identifier semantics"
  above): whether a Library-side "rename" is guaranteed to mint a new
  `exercise_id` rather than reusing the old one, or whether the Library
  models split/merge relationships at all. If the Library's
  `canonicalization` fields (`variant_of`, `exercise_family`) are ever used
  to represent this, GymApp will read them as informational context, not as
  a relationship it can rely on to auto-resolve anything — GymApp does not
  invent semantics the Library has not documented, and does not assume the
  Library will use these fields for succession in particular.
- If an `exercise_id` GymApp previously imported disappears entirely from a
  newer snapshot (not just marked deprecated), GymApp's import layer keeps
  the last-known copy (imports are additive/append-only, per the SQL
  design's `canonical_exercise_import`) so crosswalk rows referencing it
  remain resolvable. **Revision 3:** this is now detected via
  `canonical_removed_exercise_ids(p_snapshot_prev, p_snapshot_new)`, a SQL
  function (not merely a documented ad hoc query) that refuses to run unless
  **both** snapshots are `complete` — removal detection is only meaningful
  between two fully-validated snapshots, per the second review's explicit
  requirement. GymApp treats a removal finding as something to flag for
  human review, not something to silently paper over and not something this
  document assumes is necessarily a Library-side mistake (it may be
  intentional cleanup GymApp simply has not seen documented yet).

## Media reference semantics

- Corrected from the prior revision of this document: media is not
  universally absent. 2 of 876 records have a non-null `media.primary_image`
  (see "Evidence this document is based on" above); every other media field
  remains null across all 876 records. Coverage is sparse enough that
  GymApp must not build production-facing media UX on today's snapshot, but
  the import layer must not assume every `media.*` value is null either —
  `field_completeness` (see "Taxonomy versioning" above) is how GymApp
  tracks this per record instead of relying on a blanket assumption.
- When media exists, GymApp must treat `media.*` values as **relative
  identifiers/paths owned by the Library**, resolved through a Library-
  published base location (e.g. a CDN prefix or release asset base URL) —
  never as a hard-coded assumption about the Library's internal repository
  layout (`animation-engine/`, `output/`, etc.), matching the existing
  principle in `docs/REENGINEERING_DECISION_FRAME.md` ("GymApp must consume
  a stable Gym-Exercise-Library contract... must not depend on the library
  repository's internal directory structure").
- GymApp does not copy Library media into its own storage as part of this
  contract; that is future scope, explicitly out of scope for GA-001.

## Next implementation step after GA-001

**Corrected from the prior revision of this document:** that revision
proposed the immediate next task as a legacy-to-canonical *candidate
generator*. Review correctly flagged that GymApp does not yet know the
exact, reproducible union of legacy IDs that need matching — including IDs
embedded inside `rutina_ejercicios.alternativas` JSON entries, which the
prior revision's ~76-ID count did not include (see
`docs/LEGACY_EXERCISE_CROSSWALK.md`, "Migration sequence"). Building a
candidate generator before that census exists risks matching against an
incomplete or non-reproducible input set. See
`docs/LEGACY_EXERCISE_CROSSWALK.md` for the corrected next step (a read-only
legacy reference snapshot/census task) and its rationale; this document does
not restate it to avoid the two documents drifting out of sync.
