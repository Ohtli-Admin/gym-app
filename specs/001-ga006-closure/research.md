# Phase 0 Research: Close Out GA-006

All three open questions from the spec were resolved directly by the product owner on 2026-10-01; this
file records the decision, rationale, and rejected alternatives for each, plus one supporting technical
finding.

## Decision 1: Perfil-field wording (FR-006)

**Decision**: Update the tool-schema description of `condiciones_medicas` inside
`generate-routine/index.ts` and `regenerate-day/index.ts` so it explicitly acknowledges the field may now
contain softer, Calistenia-relabelled phrasing ("lesiones, molestias o limitaciones"), while instructing
the model to still treat any stated restriction conservatively. The deterministic validation logic
(`grupos_excluidos`, `validarRutina`, `validarDia`) is unchanged — only the natural-language framing given
to the LLM changes.

**Rationale**: The field is shared by two safety models that now imply different levels of severity to the
same user-facing label. Leaving the Edge Function prompt unchanged risks the model silently under-reacting
to genuinely serious input phrased more casually because of the new label. Fixing the wording is a small,
reviewable, non-structural change that closes the gap without touching validation code (Constitution
Principle IV: only the LLM-facing description changes, never the deterministic check itself).

**Alternatives considered**:
- *Leave as-is with documented acceptance*: rejected by the product owner — the risk directly concerns
  their own real injuries (shoulder, lower back), so an explicit fix was preferred over an accepted gap.
- *Split into two separate profile fields*: would be the structurally cleaner long-term fix, but requires
  a schema change and touches both generation paths' data model — larger than this feature's scope.
  Deferred as a possible future task, not part of this closure.

## Decision 2: Merge preparation strategy (FR-007)

**Decision**: Prepare a new integration branch created from current `main`, merge
`reengineering/gymapp-2-core` into it, then restore exactly 4 files to `main`'s current versions:
`supabase/functions/generate-routine/index.ts`, `generate-routine/diagnostico.ts`,
`generate-routine/reintentos.ts`, and `regenerate-day/index.ts`. This branch becomes the actual
merge candidate presented for human approval; this plan does not execute the merge to `main` itself.

**Rationale**: `main`/production already contains a newer version of those 4 files (the `grupos_excluidos`
deterministic-safety fix, deployed 2026-09-26) than `reengineering/gymapp-2-core` does (last touched
2026-09-20, before that fix existed). A full-branch merge would silently regress production's safety
behavior. A hand-built cherry-picked subset was rejected by the product owner as too much manual
overhead. Merge-then-restore gets both: everything else from the reengineering branch (GA-002 through
GA-006, the constitution, Spec Kit tooling) comes across intact, and the 4 safety-relevant files are
guaranteed byte-identical to what's already safely running in production — verified by diff, not by
re-review of logic.

**Alternatives considered**:
- *Merge the whole branch as-is*: rejected — known regression risk, confirmed by commit-date comparison
  (reengineering branch's Edge Function commits predate the `grupos_excluidos` deploy).
- *Hand-pick a cherry-picked subset of commits/files*: rejected by the product owner as too effortful and
  error-prone to assemble manually.
- *Port `grupos_excluidos` onto the reengineering branch's Edge Function files instead of restoring
  `main`'s*: rejected — this would re-derive logic that already exists and is already verified in
  production; restoring the proven files is strictly safer than re-implementing them.

## Decision 3: Manual test environment (FR-008)

**Decision**: The product owner performs the manual browser test directly against the production Supabase
project, using their real account.

**Rationale**: Product owner's explicit choice. GymApp is single-user personal software; there is no
separate staging Supabase project, and standing one up is out of scope for this feature.

**Alternatives considered**:
- *Test against an isolated preview/branch Supabase environment first*: safer in the abstract, but adds
  setup overhead disproportionate to a single-user app, and was declined by the product owner.

## Supporting finding: no automated regression gate exists

There is no CI pipeline (confirmed: no `.github/workflows` anywhere in the repository) and no automated
end-to-end/browser test. FR-005 ("Fuerza, Core, and Cardio generation MUST continue to behave exactly as
they did before") can only be verified manually, as part of the same browser session covering FR-001–004.
`quickstart.md` documents this as a single combined manual test pass rather than separate automated gates,
because no other mechanism exists in this project today — introducing CI/E2E tooling is explicitly out of
scope for this feature.
