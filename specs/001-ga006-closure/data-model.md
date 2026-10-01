# Phase 1 Data Model: Close Out GA-006

No schema changes are introduced by this feature. This document describes the one existing entity whose
*interpretation* (not structure) is affected, plus the two entities already shipped by GA-006 that this
feature validates rather than builds.

## Perfil medical-context field (existing, unchanged structure)

- **Table.column**: `perfiles.condiciones_medicas` (existing text column, no migration)
- **Current consumers**: two, with diverging interpretation before this feature:
  1. Calistenia (GA-006): UI label "Lesiones, molestias o limitaciones que quieras que GymApp tenga en
     cuenta"; passed to Context Engine as a restriction with no `avoidTags`; reported to the user as "not
     automatically evaluable."
  2. Fuerza/Core/Cardio Edge Functions (`generate-routine`, `regenerate-day`): tool-schema description
     tells the Claude API this is a "condición médica real" (a real medical condition) — unchanged since
     before GA-006.
- **Change in this feature (FR-006)**: consumer 2's description text is reworded to acknowledge the field
  may contain softer phrasing while still instructing conservative treatment. No column, type, or
  constraint changes. No data migration.

## Calistenia session (existing, GA-006 — validated, not modified)

- **Lifecycle**: prepared → active → completed, held in `session-slots.mjs`, persisted to
  `localStorage` (`gymapp2.activeSession.v1`), never written to Supabase training history.
- **Relevant fields for this feature's acceptance testing**: the applied-restrictions list and
  unverifiable-restrictions list surfaced to the UI after generation (used to verify FR-001/FR-002 in the
  manual test).

## Physical restriction (existing, GA-006 — validated, not modified)

- **Represents**: a user-declared injury/limitation, optionally mapped to a `Gym-Exercise-Library` body
  region (hombro → `shoulder_girdle`, muñeca → `forearm_hand`, espalda baja → `posterior_core`, cadera →
  `hip_pelvis`, tobillo → `lower_leg_foot`; rodilla has no mapped region).
- **State**: hard exclusion when mapped; reported as unverifiable when not. No lifecycle beyond what's
  already documented in GA-006's task file — this feature does not add new restriction types.

## Integration branch (new artifact of this feature, not a data entity)

Not a data-model entity, but worth naming here since it is the concrete output of FR-007: a git branch
created from `main`, carrying `reengineering/gymapp-2-core`'s history with the 4 Edge Function files
restored to `main`'s versions. Tracked in `quickstart.md`, not in application data.
