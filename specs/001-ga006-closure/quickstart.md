# Quickstart: Validating GA-006 Closure

This is the runnable validation guide for this feature. It does not duplicate `data-model.md` or
`contracts/`; it links to them where relevant.

## Prerequisites

- Node.js available locally (for the automated suite).
- A checkout of `reengineering/gymapp-2-core` at or after commit `6c00dd1`.
- Access to the production GymApp (real account) for the manual browser pass.
- Push access to `Ohtli-Admin/gym-app` for preparing the integration branch (FR-007).

## 1. Re-run the automated suite (regression check for FR-006's wording change)

From the repository root:

```
node --test
```

Expected: 120/120 passing, unchanged from GA-006's own recorded result — the wording change in
`generate-routine/index.ts` and `regenerate-day/index.ts` must not touch `diagnostico.ts`/`reintentos.ts`
logic, so these suites must keep passing without modification. See
`contracts/condiciones-medicas-field-contract.md` for exactly what is and isn't allowed to change.

## 2. Manual browser test (FR-001–FR-005), directly against production

Performed by the product owner, per the FR-008 decision in `research.md`. Steps:

1. Open GymApp in a real browser, signed in to the real account.
2. With at least one injury declared in Perfil (e.g., hombro), go to Entrenamiento → Calistenia and
   generate a session. Confirm: the generated exercises exclude the mapped body region, and the UI states
   which restrictions were applied and which could not be verified. (FR-001, FR-002)
3. Navigate away from the session screen (e.g., to Perfil or Historial) and back. Confirm the prepared or
   active session is restored exactly as left — not regenerated, not lost. (FR-003)
4. Generate a Calistenia session two or three more times (on the same or different days). Confirm the
   exercise lists are not identical every time. (FR-004)
5. Generate at least one Fuerza, one Core, and one Cardio routine. Confirm behavior is unchanged from
   before this feature — same flow, same safety messaging as already in production. (FR-005)
6. Record a pass/fail verdict for each numbered scenario above in the GA-006 task file's final section.

## 3. Prepare the integration branch (FR-007) — does not merge to `main`

```
git fetch origin main reengineering/gymapp-2-core
git checkout -b integration/ga006-to-main origin/main
git merge origin/reengineering/gymapp-2-core
# resolve any merge conflicts normally, then restore the 4 safety-relevant files to main's versions:
git checkout origin/main -- supabase/functions/generate-routine/index.ts \
                            supabase/functions/generate-routine/diagnostico.ts \
                            supabase/functions/generate-routine/reintentos.ts \
                            supabase/functions/regenerate-day/index.ts
git status   # confirm only the intended restore is staged
git commit -m "chore: prepare integration branch — merge reengineering/gymapp-2-core, preserve main's Edge Function safety fix"
git push origin integration/ga006-to-main
```

Expected result: `integration/ga006-to-main` contains everything from `reengineering/gymapp-2-core`
(including GA-006 and this feature's own wording fix applied on top — see step 4) except that the 4 named
files are byte-identical to `main`'s current versions. Verify with:

```
git diff origin/main..integration/ga006-to-main -- supabase/functions/generate-routine/index.ts supabase/functions/generate-routine/diagnostico.ts supabase/functions/generate-routine/reintentos.ts supabase/functions/regenerate-day/index.ts
```

Expected: no output (zero diff) for `diagnostico.ts`/`reintentos.ts`/the merged `regenerate-day/index.ts`'s
validation logic. `generate-routine/index.ts` and `regenerate-day/index.ts` will show a diff limited to
the FR-006 wording change applied in step 4 below, nothing else.

**Note**: this branch is the artifact presented for human approval per FR-009/Constitution Principle II.
Nothing in this quickstart merges it into `main` or deploys it.

## 4. Apply the FR-006 wording fix

Edit the `condiciones_medicas` tool-schema description in `generate-routine/index.ts` and
`regenerate-day/index.ts` per `contracts/condiciones-medicas-field-contract.md`. Apply this on
`reengineering/gymapp-2-core` (or directly on `integration/ga006-to-main` after step 3, then back-port to
`reengineering/gymapp-2-core` — either order is acceptable, but both branches must end up with the same
wording).

## 5. Record the outcome

Update `tasks/review/GA-006-exercise-library-provider-v0.1.md` with the manual-test verdicts from step 2,
and move its `Status` out of `REVIEW` only once the product owner has recorded explicit approval, per
Success Criteria SC-001–SC-004 in `spec.md`.
