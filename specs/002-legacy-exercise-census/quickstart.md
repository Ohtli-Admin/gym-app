# Quickstart: Validating the Legacy Exercise Reference Census

This is a validation guide, not implementation code — see `tasks.md` (once
generated) for the actual build steps, and `data-model.md` for the exact
output shapes referenced below.

## Prerequisites

- Node.js available (already required by every other `tools/*.mjs` script
  in this repo).
- `npm install` run once at the repo root, after this feature adds
  `package.json` with `@supabase/supabase-js` (see `research.md` Decision 1).
- Two environment variables set in your shell, **never committed**:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  (Same values the Edge Functions already use in Supabase's own secret
  store — pull them from the Supabase dashboard's project settings, not
  from any file in this repo.)

## Step 1 — Run the census

```bash
node tools/census-legacy-exercises.mjs
```

Expected: the script prints a short summary to stdout (row count, total
distinct referenced IDs) and writes:
- `tools/generated/legacy-exercise-census/snapshot.json`
- `tools/generated/legacy-exercise-census/census.json`

## Step 2 — Sanity-check the snapshot (User Story 1)

```bash
# Compare against a direct count (requires psql or the Supabase SQL editor)
# SELECT COUNT(*) FROM ejercicios;
```

Confirm the number matches `snapshot.json`'s `row_count` field, and that
`row_count === rows.length` in the file itself.

## Step 3 — Confirm reproducibility (User Story 1, Scenario 2 / SC-002)

```bash
node tools/census-legacy-exercises.mjs
```

Run it a second time with no data changes in between. Confirm:
- `snapshot.json`'s `content_sha256` is identical across both runs.
- `census.json`'s `content_sha256` is identical across both runs.
- Only `generated_at` in each file differs.

## Step 4 — Confirm the embedded-alternatives gap is closed (User Story 2, Scenario 2)

Pick any legacy exercise ID you know appears inside a saved "alternativa"
in the app (e.g. via "Ver alternativas" in a past session) but was never
itself chosen as a routine slot or logged set. Confirm:
- It appears in `census.json`'s `entries`.
- Its `embedded_alternative_count` is > 0.
- Its `routine_slot_count` and `logged_set_count` are both 0 for that ID,
  if it genuinely never appeared as either.

## Step 5 — Confirm the total beats the prior estimate (SC-001)

Confirm `census.json`'s `total_distinct_ids` is greater than or equal to
the previously-recorded ~76-ID estimate from
`docs/LEGACY_EXERCISE_CROSSWALK.md` (that estimate is known to have missed
the embedded-alternatives source, so a strictly-equal result would itself
be suspicious and worth double-checking against Step 4).

## Step 6 — Confirm zero writes occurred (SC-003)

Before running the census, note current row counts for `ejercicios`,
`rutina_ejercicios`, and `series_registradas`. After running it (any
number of times), confirm all three counts are unchanged.

## Step 7 — Confirm no regression to existing behavior (SC-004)

```bash
node --test $(find . -name "*.test.mjs" -not -path "./node_modules/*")
```

Confirm the full existing suite still passes with no new failures, and
that `generate-routine`/`regenerate-day`/`app.js` were not touched by this
feature's diff.
