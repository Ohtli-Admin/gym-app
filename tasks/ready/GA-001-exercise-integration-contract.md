# [GA-001] Define canonical exercise integration contract

- **Status:** READY
- **Agent/Owner:** unassigned

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

- [ ] The Gym-Exercise-Library → GymApp ownership boundary is explicit and consistent with `AGENTS.md`.
- [ ] A versioned consumer contract is specified without direct dependency on Library repository internals.
- [ ] The minimum canonical exercise fields required by GymApp are enumerated and justified.
- [ ] Legacy IDs remain valid and resolvable for all historical GymApp records.
- [ ] Mapping statuses and ambiguity rules are explicit.
- [ ] The proposed SQL is additive, reversible at design level, and clearly marked as not executable against production yet.
- [ ] No production system, application behavior, or existing database file is modified.
- [ ] The design supports incremental migration: historically referenced legacy IDs can be mapped before the entire 1,464-row legacy catalog.
- [ ] The next implementation task is concrete enough to be created without another architecture-discovery round.
- [ ] The task result records inspected evidence, unresolved questions, files changed, and validation performed.

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

Not started.
