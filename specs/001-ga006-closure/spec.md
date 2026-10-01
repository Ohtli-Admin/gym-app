# Feature Specification: Close Out GA-006 (Exercise Library Provider)

**Feature Branch**: `001-ga006-closure`

**Created**: 2026-10-01

**Status**: Draft

**Input**: User description: "Close out GA-006 (Gym Exercise Library Provider v0.1), already implemented
and committed on `reengineering/gymapp-2-core` (commit 0e56bd5, task file
`tasks/review/GA-006-exercise-library-provider-v0.1.md`) but not yet accepted or merged. GA-006 added a
Calistenia training mode running a deterministic Context → Compatibility → Planner pipeline against the
real Gym-Exercise-Library catalog, with no LLM involved in exercise selection — the safety pattern
required by the constitution's Principle IV. It maps declared injuries to Library body regions as hard
exclusions, fixed a session-persistence bug, added variety and a prescription policy. 120/120 tests pass.
Fuerza/Core/Cardio are untouched and out of scope. The task's own status is REVIEW with one unchecked
criterion: manual browser acceptance by the user. A second real risk: the Perfil field
`perfiles.condiciones_medicas` was relabelled for Calistenia but Fuerza/Core/Cardio's Edge Functions still
read it unchanged and describe it to the LLM as a real medical condition — a cross-contamination risk
between two safety models sharing one field."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Product owner validates Calistenia in a real browser (Priority: P1)

The product owner (the app's only real user) opens GymApp in a real browser against real Supabase data,
generates a Calistenia session, and confirms the already-built safety behavior works as documented:
declared injuries visibly exclude the right exercises, uncertainty is stated honestly where coverage is
incomplete, a prepared/active session survives leaving and returning to the screen, and repeated
generation produces varied sessions rather than the same nine exercises every time.

**Why this priority**: This is the only unchecked acceptance criterion blocking GA-006 from moving out of
REVIEW. Nothing else in this spec can be truthfully marked done until a real human confirms the real
behavior, because every other validation so far (120/120 automated tests) is self-reported by the agent
that wrote the code.

**Independent Test**: Can be fully tested by the product owner generating and interacting with at least
one Calistenia session end to end in a browser, without needing the Perfil-field fix or the merge
decision to exist yet.

**Acceptance Scenarios**:

1. **Given** a profile with at least one declared injury (e.g., shoulder), **When** the product owner
   generates a Calistenia session, **Then** the resulting exercises visibly exclude the mapped body
   region and the UI states which restrictions were applied and which could not be verified.
2. **Given** a prepared or in-progress Calistenia session, **When** the product owner navigates away to
   another screen and back, **Then** the session is restored exactly as left (not regenerated, not lost).
3. **Given** the product owner generates a Calistenia session multiple times on different occasions,
   **When** comparing the resulting exercise lists, **Then** the lists are not identical every time.
4. **Given** the product owner also exercises Fuerza, Core, and Cardio generation during the same
   session, **When** comparing behavior to before GA-006 existed, **Then** nothing regresses.

---

### User Story 2 - Resolve the shared Perfil-field safety risk (Priority: P1)

The product owner decides, with the risk stated plainly, how to resolve the fact that one profile field
now means two different things to two different safety systems: a soft, UI-relabelled note for
Calistenia, and an unchanged "real medical condition" instruction fed to the LLM for Fuerza/Core/Cardio.

**Why this priority**: This is a safety-relevant gap discovered during this review, not a cosmetic one —
it directly concerns the user's own documented shoulder and lower-back conditions, and silently leaving it
ambiguous would repeat the kind of unreviewed safety decision this whole reconciliation effort exists to
stop.

**Independent Test**: Can be tested independently of User Story 1 by inspecting the Edge Function prompt
text and the Perfil UI copy together and confirming they now describe the same field consistently (or
that a documented, explicit decision to leave them as-is with a stated mitigation has been recorded).

**Acceptance Scenarios**:

1. **Given** the current mismatch between the Calistenia-facing label and the Fuerza/Core/Cardio
   Edge Function's description of the same field, **When** this feature is closed, **Then** either (a) the
   Edge Function prompt text has been updated so both consumers describe the field consistently, or (b)
   the product owner has explicitly accepted the mismatch with a documented mitigation recorded in the
   task file — ambiguity is not an acceptable end state.

---

### User Story 3 - Reach an explicit merge/deploy decision (Priority: P2)

The product owner is presented with a clear, scoped recommendation for what exactly would move from
`reengineering/gymapp-2-core` into `main` (and, separately, what if anything would be deployed to
production), including the known risk that this branch's Edge Function code predates the
`grupos_excluidos` safety fix already live in production, and gives (or withholds) explicit approval
before anything is merged or deployed.

**Why this priority**: Required by the constitution's Principle II (human approval boundary) and
Principle I (branch discipline) — no agent may merge to `main` or deploy to production without this
explicit step, regardless of how complete the underlying work is.

**Independent Test**: Can be tested independently by reviewing the merge/deploy recommendation document
and confirming it names exactly what would change in `main` and in production, and that no merge or
deploy has occurred without a recorded approval.

**Acceptance Scenarios**:

1. **Given** a written recommendation of what should merge (e.g., GA-006's files and the constitution/
   Spec Kit tooling, explicitly excluding the stale Edge Function versions already superseded in
   production), **When** the product owner reviews it, **Then** they record an explicit approval or
   rejection before any merge or deploy action is taken.

### Edge Cases

- What happens if the product owner's manual browser test (User Story 1) surfaces a behavior that
  contradicts what the task file claims (e.g., a restriction that doesn't actually exclude the exercise
  it claims to)? → Treated as a blocking finding: GA-006 cannot be marked accepted until resolved or
  explicitly accepted as a documented limitation.
- What happens if resolving the Perfil-field risk (User Story 2) requires touching the Fuerza/Core/Cardio
  Edge Functions, which are explicitly out of scope for GA-006 itself? → The fix is scoped narrowly to the
  prompt text / field description only; it must not change the deterministic validation logic
  (`grupos_excluidos`, `validarRutina`) already live in those Edge Functions.
- What happens to Core and Cardio Calistenia-style candidates, given the Library currently returns zero
  for both? → Out of scope for this feature; already reported honestly by the existing UI as "no
  exercises available," which is accepted current behavior, not a defect to fix here.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product owner MUST be able to generate at least one Calistenia session against real
  Supabase data in a real browser and observe the declared-injury exclusion behavior directly.
- **FR-002**: The system MUST report, after each Calistenia generation, which restrictions were applied
  and which could not be verified against the catalog, in user-facing language (not developer language).
- **FR-003**: A prepared or active Calistenia session MUST survive navigating to another screen and back
  without being silently regenerated or lost.
- **FR-004**: Repeated Calistenia generation MUST produce varied exercise selection across sessions rather
  than a fixed, identical list every time.
- **FR-005**: Fuerza, Core, and Cardio generation MUST continue to behave exactly as they did before
  GA-006, with no observable regression.
- **FR-006**: The Fuerza/Core/Cardio Edge Function prompt text MUST be updated to describe
  `condiciones_medicas` consistently with its new Calistenia-facing label, so the same field is not
  interpreted as "soft note" in one generation path and "real medical condition" in another. *(Resolved:
  Option A — fix now.)*
- **FR-007**: The merge into `main` MUST NOT regress `main`'s current Fuerza/Core/Cardio Edge Function
  code (which already includes the `grupos_excluidos` safety validation live in production). The
  recommended mechanism is: merge `reengineering/gymapp-2-core` into a fresh integration branch created
  from current `main`, then immediately restore the 4 Edge Function files
  (`generate-routine/index.ts`, `generate-routine/diagnostico.ts`, `generate-routine/reintentos.ts`,
  `regenerate-day/index.ts`) to `main`'s current versions before anything is proposed for merge approval.
  This avoids both a full-branch regression and a hand-built cherry-picked subset. *(Resolved: merge +
  targeted restore of the 4 Edge Function files.)*
- **FR-008**: The manual browser test in User Story 1 MUST be performed directly against the production
  Supabase project (the product owner's real, only account). *(Resolved: Option A — test in production.)*
- **FR-009**: No merge to `main` and no deploy to production (frontend or Supabase) MUST occur as part of
  closing this feature without an explicit, recorded approval from the product owner, per the
  constitution's Principle II.
- **FR-010**: Existing training history (sets, weights, completed routines) MUST remain unaffected by any
  work done to close this feature, per the constitution's Principle IV.

### Key Entities

- **Calistenia session**: A prepared or active bodyweight training session generated by the deterministic
  pipeline; has a lifecycle (prepared → active → completed) persisted across navigation.
- **Physical restriction**: A user-declared injury or limitation, mapped (where possible) to a Library
  body region and used as a hard exclusion during Calistenia generation; may be "unverifiable" if the
  catalog has no matching region.
- **Perfil medical-context field** (`perfiles.condiciones_medicas`): A single stored field currently
  interpreted two different ways by two different generation paths — the subject of User Story 2.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The product owner completes a real-browser manual test of Calistenia and records a pass/fail
  verdict for each acceptance scenario in User Story 1.
- **SC-002**: The Perfil-field risk has a recorded, explicit resolution (fixed or explicitly accepted) —
  zero ambiguity remains about which behavior is intended.
- **SC-003**: A merge/deploy recommendation exists in writing and an explicit approval or rejection is
  recorded before any merge or deploy action is taken.
- **SC-004**: Zero regressions are reported in Fuerza, Core, or Cardio generation after this feature is
  closed.

## Assumptions

- The product owner is the sole real user of GymApp, so "manual browser acceptance" means their own
  acceptance, not a broader user-acceptance-testing process.
- The 120/120 automated test results already recorded in the GA-006 task file are trusted as accurate and
  do not need to be independently re-run as part of this feature, only extended if new code changes result
  from User Story 2.
- This feature's scope ends at reaching an explicit merge/deploy decision (User Story 3); executing an
  approved merge or deploy is a follow-up action gated on that approval, not a requirement this spec's
  completion depends on.
- Gym-Exercise-Library integration for Core/Cardio, the GA-001 crosswalk SQL, and any new training
  modality remain explicitly out of scope, per the original request.
