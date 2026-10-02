# Data Model: Legacy Exercise Reference Census

Both entities below are **generated output files**, not new database
tables — this feature introduces no schema (spec FR-007).

## Entity: Legacy Exercise Snapshot

File: `tools/generated/legacy-exercise-census/snapshot.json`

| Field | Type | Description |
|---|---|---|
| `generated_at` | string (ISO-8601) | Wall-clock time the snapshot was produced. Excluded from the content hash (see `research.md` Decision 4). |
| `source_query` | string | The exact, literal read-only query/select used to produce the row data, so a reviewer can reproduce it by hand. |
| `row_count` | integer | Number of rows in `rows` — must equal a direct `SELECT COUNT(*) FROM ejercicios` at the same instant. |
| `content_sha256` | string | SHA-256 hash of the canonicalized `rows` array (stable key order), excluding `generated_at`. Two runs over unchanged data MUST produce the same value. |
| `rows` | array of objects | Full row contents of every `ejercicios` row, field names unchanged from the table (`id`, `nombre`, `grupo_muscular`, `equipo`, `nivel`, `contraindicaciones`, and any other existing columns — the tool selects `*`, it does not hand-pick a subset, so a future consumer doesn't need to re-run the census just because a new column matters). |

**Validation rules**:
- `row_count` MUST equal `rows.length`.
- No row may be dropped, truncated, or summarized — this is a full,
  lossless snapshot (spec FR-001).

## Entity: Legacy ID Reference Census

File: `tools/generated/legacy-exercise-census/census.json`

| Field | Type | Description |
|---|---|---|
| `generated_at` | string (ISO-8601) | Wall-clock time the census was produced. |
| `content_sha256` | string | SHA-256 hash of the canonicalized `entries` array, excluding `generated_at`. |
| `total_distinct_ids` | integer | Count of `entries` — the headline "replaces the ~76 estimate" number (spec SC-001). |
| `entries` | array of `CensusEntry` | One entry per distinct legacy `ejercicio_id` found in any of the three sources. |

### `CensusEntry`

| Field | Type | Description |
|---|---|---|
| `ejercicio_id` | string | The legacy exercise ID (matches `ejercicios.id`'s type — `text`). Note: per spec Edge Cases, this ID is recorded even if it no longer exists in the current `ejercicios` table — the census reflects what is *referenced*, not what is currently resolvable. |
| `total_references` | integer | Sum of the three counts below. Always > 0 (an ID only appears here because it was found at least once — spec FR-005). |
| `routine_slot_count` | integer | Number of `rutina_ejercicios` rows where `ejercicio_id` equals this ID. |
| `logged_set_count` | integer | Number of `series_registradas` rows where `ejercicio_id` equals this ID. |
| `embedded_alternative_count` | integer | Number of times this ID appears inside any `rutina_ejercicios.alternativas` JSON array element, across all rows. |

**Validation rules**:
- `total_references` MUST equal
  `routine_slot_count + logged_set_count + embedded_alternative_count`.
- `entries` MUST be deduplicated by `ejercicio_id` — a given ID appears
  exactly once, with its counts summed across every source and every row
  that referenced it (spec User Story 2, Acceptance Scenario 3).
- An `ejercicio_id` with zero references anywhere does **not** appear in
  `entries` at all (this file is not a dump of all of `ejercicios` — that
  is what `snapshot.json` is for). Per spec Assumptions, such
  zero-reference ("`legacy_only`") IDs are out of scope for this feature
  entirely.
