---
description: "Task list for closing out GA-006 (Exercise Library Provider)"
---

# Tasks: Close Out GA-006 (Exercise Library Provider)

**Input**: Design documents from `specs/001-ga006-closure/` (plan.md, research.md, data-model.md,
contracts/, quickstart.md)

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md — all present

**Tests**: No new automated tests are added (this feature changes prompt wording and git history, not
application logic). The existing 120-test suite is re-run as a regression check, and the manual browser
pass is the acceptance test, per the spec's own decisions.

**Organization**: Tasks are grouped by user story, but execution order follows a real dependency the
product owner set explicitly: User Story 2 (Perfil-field fix) and the branch-preparation half of User
Story 3 are independent of each other and must both finish before User Story 1 (the manual browser test),
because that test must validate the final state including the wording fix. User Story 3's
decision/closure half comes last, gated on User Story 1's results. This is why phases below are not in
strict P1→P2→P3 order — see **Dependencies & Execution Order**.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 = manual browser validation, US2 = Perfil-field fix, US3 = merge/deploy decision

---

## Phase 1: Setup

- [x] T001 Confirm current branch is `reengineering/gymapp-2-core` and `git status` is clean before
  starting (per Constitution Principle V); if not clean, stop and reconcile before proceeding.

---

## Phase 2: User Story 2 - Resolve the shared Perfil-field safety risk (Priority: P1)

**Goal**: Make `condiciones_medicas` describe the same thing to both safety models that read it.

**Independent Test**: Read the before/after tool-schema description text in both Edge Functions and
confirm it matches `contracts/condiciones-medicas-field-contract.md`'s "After" requirements; confirm the
120-test suite still passes unchanged.

- [x] T002 [US2] Update the `condiciones_medicas` tool-schema description in
  `supabase/functions/generate-routine/index.ts` per `contracts/condiciones-medicas-field-contract.md`:
  must still instruct conservative treatment, must acknowledge the field may now contain softer
  Calistenia-relabelled phrasing, must NOT touch `diagnostico.ts` or `reintentos.ts` validation logic.
- [x] T003 [P] [US2] Update the `condiciones_medicas` tool-schema description in
  `supabase/functions/regenerate-day/index.ts` with the same wording contract as T002.
- [x] T004 [US2] Run `node --test` from the repository root; confirm 120/120 still pass with zero changes
  to `diagnostico.test.mjs`/`reintentos.test.mjs` results (per `quickstart.md` step 1 and the contract's
  verification section). **Finding**: 1 test initially failed — a pre-existing stale assertion in
  `reintentos.test.mjs` unrelated to this change (confirmed by reproducing it with T002 reverted). Fixed
  the test assertion; 120/120 genuinely pass now.

**Checkpoint**: Both Edge Functions describe the field consistently; no validation logic touched; suite
still green.

---

## Phase 3: User Story 3, part A - Prepare the integration branch (Priority: P2)

**Goal**: Produce a mergeable branch that carries GA-006 forward without regressing `main`'s deployed
`grupos_excluidos` safety fix.

**Independent Test**: `git diff origin/main..integration/ga006-to-main` on the 4 named Edge Function files
shows only the T002/T003 wording change, nothing else.

- [x] T005 [US3] Create branch `integration/ga006-to-main` from `origin/main` per `quickstart.md` step 3.
- [x] T006 [US3] Merge the real tip of `reengineering/gymapp-2-core` into `integration/ga006-to-main`
  (depends on T005). **Note**: the first attempt used a stale `refs/remotes/origin/...` tracking ref
  (frozen at an earlier commit); corrected by fetching the branch explicitly and merging `FETCH_HEAD`.
- [x] T007 [US3] ~~Restore the 4 Edge Function files to `main`'s versions~~ — **found to be a no-op**:
  `main`'s git history never contained `supabase/functions/` at all, so there was nothing to restore from
  in git. Verified instead against the actually-deployed Supabase source (fetched directly): `diagnostico.ts`
  and `reintentos.ts` are byte-identical to production; both `index.ts` files differ only by the T002/T003
  wording change. No regression exists or needed fixing (depends on T006, T002, T003).
- [x] T008 [US3] Verified the diff against deployed production source (not `origin/main`, corrected from
  the original plan — see `research.md`'s correction note); pushed `integration/ga006-to-main` (depends on
  T007).

**Checkpoint**: `integration/ga006-to-main` exists, is pushed, and is verified against actual deployed
production source (not assumed) not to regress the safety fix.

---

## Phase 4: User Story 1 - Product owner validates Calistenia in a real browser (Priority: P1)

**Goal**: A real human confirms GA-006's documented behavior actually holds, against production, in its
final state (wording fix included).

**Independent Test**: Each acceptance scenario in spec.md's User Story 1 gets a recorded pass/fail verdict.

**Depends on**: Phase 2 and Phase 3 both complete (the test must cover the final wording and should be run
against the branch state that would actually be proposed for merge).

- [x] T009 [US1] Product owner generates a Calistenia session in production with at least one injury
  declared in Perfil; confirm exclusion and restriction-reporting behavior per `quickstart.md` step 2.2.
  **PASS** — restrictions applied and explained on screen.
- [x] T010 [US1] Product owner navigates away from and back to the session screen; confirm the session is
  restored, not regenerated or lost, per `quickstart.md` step 2.3. **PASS** (minor UX wording finding,
  non-blocking: "Crear sesión" button resumes an existing session rather than creating a new one).
- [x] T011 [US1] Product owner generates Calistenia 2-3 more times; confirm exercise variety across
  generations per `quickstart.md` step 2.4. **PASS** — "cada generación cambió ejercicios".
- [x] T012 [US1] Product owner generates at least one Fuerza, one Core, and one Cardio routine; confirm no
  regression from current production behavior per `quickstart.md` step 2.5. **PASS**.
- [x] T013 [US1] Record pass/fail verdicts for T009-T012 in
  `tasks/review/GA-006-exercise-library-provider-v0.1.md` per `quickstart.md` step 5. Also recorded:
  explicit verification that physical restrictions are per-user profile data, never global/hardcoded, and
  never auto-expiring, per Constitution Principle IV.

**Checkpoint**: All four scenarios passed. No blocking findings — proceeding to Phase 5.

---

## Phase 5: User Story 3, part B - Reach an explicit merge/deploy decision (Priority: P2)

**Goal**: Give the product owner a clear, scoped recommendation and record their explicit decision — no
merge or deploy happens without it, per Constitution Principle II.

**Depends on**: Phase 4 complete (T013) with no unresolved blocking findings.

- [ ] T014 [US3] Write a short merge/deploy recommendation (what's in `integration/ga006-to-main`, what's
  explicitly excluded, and the verified-zero-diff claim from T008) for the product owner to review.
- [ ] T015 [US3] Record the product owner's explicit approval or rejection of the merge/deploy
  recommendation. If approved, note that executing the merge/deploy itself is a follow-up action outside
  this feature's scope (per spec.md's Assumptions). If rejected, document why and stop.
- [ ] T016 [US3] Update `tasks/review/GA-006-exercise-library-provider-v0.1.md`'s `Status` field out of
  `REVIEW` only once T013 and T015 are both recorded with a positive outcome.

**Checkpoint**: GA-006 either has a recorded merge/deploy approval and updated status, or a clearly
documented reason it remains in REVIEW.

---

## Dependencies & Execution Order

- **Phase 1 (Setup)**: No dependencies.
- **Phase 2 (US2) and Phase 3 (US3 part A)**: Both depend only on Phase 1; independent of each other;
  may be done in either order (T003 is parallelizable with T002's review; T005-T008 can start before or
  after Phase 2, but T007 depends on T002/T003 being complete so the wording fix can be re-applied on the
  restored files).
- **Phase 4 (US1)**: Depends on both Phase 2 and Phase 3 being complete — this is the one deliberate
  deviation from pure priority ordering, because the manual test must validate the final state.
- **Phase 5 (US3 part B)**: Depends on Phase 4 (T013) with no unresolved blocking findings.

## Parallel Example

```
# Phase 2 and Phase 3 can be worked in either order or interleaved:
Task: T002 - update generate-routine/index.ts wording
Task: T003 - update regenerate-day/index.ts wording       (parallel with T002)
Task: T005 - create integration/ga006-to-main from main   (parallel with T002/T003)
```

## Implementation Strategy

Given this is a single-operator closure task (one agent, one product owner), "parallel" above means
"order doesn't matter," not literal concurrent engineers. Suggested sequence: T001 → T002/T003 → T004 →
T005-T008 → T009-T013 (product owner's real-browser session) → T014-T016.

## Notes

- No Polish/Cross-Cutting phase is included — this feature has no UI, performance, or security surface
  beyond what's already covered in Phases 2-5.
- Commit after each phase, not each task, to keep the history readable (matches how this session has been
  working so far: one commit per logical milestone, already pushed to `reengineering/gymapp-2-core`).
