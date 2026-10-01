<!--
Sync Impact Report
Version change: [TEMPLATE] → 1.0.0 (initial ratification)
Modified principles: n/a (first formal write — placeholders filled, no prior version existed)
Added sections: Core Principles I–V; Catalog & Domain Ownership detail folded into Principle III;
  Governance (amendment procedure, versioning policy, compliance review)
Removed sections: none
Source: translated verbatim in substance from this repo's AGENTS.md (read in full before drafting).
  AGENTS.md remains the canonical, detailed source — this file is Spec Kit's required format for
  the same rules, not a replacement or a new decision.
Follow-up TODOs: none — all placeholders resolved from AGENTS.md and the ratification date given.
-->

# GymApp Constitution

## Core Principles

### I. Source of Truth & Branch Discipline
GitHub is the source of truth for code, Edge Functions, and documentation. The
deployed Supabase project is a runtime target, not a design reference —
deployed state that disagrees with GitHub MUST be recorded as a finding, never
silently trusted or silently fixed. `main` is never modified directly; every
implementation task happens on a dedicated branch.

### II. Human Approval Boundary (NON-NEGOTIABLE)
No agent merges to `main`, deploys to production, or modifies the production
Supabase project without explicit human approval. This includes schema
changes, Edge Function deploys, RLS policy changes, and data migrations.
Rationale: this is a personal-safety-relevant medical/fitness app with a
single real user; production changes are irreversible against that user's
live data and training history, so they require a human in the loop every
time, with no exception for convenience or perceived urgency.

### III. Catalog and Domain Ownership Separation
`Gym-Exercise-Library` (a separate repository) is the canonical system for
objective exercise identity, metadata, taxonomy, provenance, and media.
GymApp does not duplicate or fork that authority. GymApp owns users, profile,
goals, context, constraints, rehabilitation, plans, history, and
personalization. Legacy GymApp exercise IDs (`ejercicios`, `rutina_ejercicios`,
`series_registradas`, etc.) MUST NOT be removed or replaced until a verified
crosswalk to canonical `Gym-Exercise-Library` IDs exists — legacy IDs are
load-bearing for historical routines and logged sets.

### IV. Deterministic Safety — the LLM Never Decides Safety (NON-NEGOTIABLE)
An LLM may select or compose a routine only from an already-filtered set of
allowed candidates; it does not decide safety on its own. Physical
safety/compatibility validation MUST be deterministic and run outside the
LLM, in code — never trusted to prompt text alone. GymApp does not diagnose
medical conditions and does not infer recovery: a time-bounded physical
restriction never disappears automatically because a date passed — resolving,
extending, or modifying it requires an explicit user action. Training history
(sets, weights, completed routines) MUST be preserved, never overwritten or
silently discarded by migrations or refactors.

### V. Process Discipline
Before starting any task: check the current branch and `git status`; do not
build on unexpected uncommitted state without understanding it first.
Non-trivial changes require tests, or an explicit written explanation of why a
test is not applicable. Check `tasks/` and recent branches/commits before
starting work to avoid duplicating another agent's in-progress task. Never
commit secrets, API keys, or Supabase service-role credentials to Git, in
code, docs, or task files. If completing a task would require breaking any
rule in this constitution or in `AGENTS.md`, stop and request an explicit
human decision instead of proceeding.

## Current Architecture References

This constitution intentionally does not duplicate architecture details.
Consult these before making design or implementation decisions, and prefer
them over assumptions carried over from chat history or memory:

- `docs/CLAUDE_WEB_HANDOFF.md` — historical product/architecture context; not
  a spec for future work.
- `docs/CURRENT_STATE_RECONCILIATION.md` — verified state of the deployed
  Supabase project, schema, catalog, and frontend/backend behavior.
- `docs/REENGINEERING_DECISION_FRAME.md` — what the next architecture must
  preserve, replace, separate, and introduce; defines the
  GymApp / `Gym-Exercise-Library` boundary and the first implementation slice.

## Relationship to AGENTS.md

`AGENTS.md` is the canonical, detailed statement of these same rules and
applies to any agent working in this repository (Claude Code, OpenAI Codex,
ChatGPT, or any future automation), regardless of which Spec Kit command or
tool is driving the work. This constitution exists to express the same rules
in Spec Kit's required format so Spec Kit's own workflow (`/speckit-plan`,
`/speckit-tasks`, `/speckit-analyze`, `/speckit-implement`) can check against
it mechanically. Where wording differs, both files must be brought back into
agreement — neither silently overrides the other.

## Governance

This constitution and `AGENTS.md` govern equally and must be kept in sync;
an amendment to one requires updating the other in the same change. The
constitution supersedes ad-hoc practice: any plan, task, or implementation
that conflicts with a principle above must either be revised to comply or
must stop and request an explicit human decision, per Principle V.

**Amendment procedure:** a change to any principle, or to the human-approval
boundary in particular, requires the human product owner's explicit
agreement before it is written back to this file and to `AGENTS.md`. Record
the change via this skill's Sync Impact Report, bump the version per the
policy below, and update `Last Amended`.

**Versioning policy (semantic):**
- MAJOR — backward-incompatible governance change, or removal/redefinition of
  a principle (e.g., loosening the human-approval boundary or the
  deterministic-safety requirement).
- MINOR — a new principle or materially expanded guidance added.
- PATCH — wording, clarification, or non-semantic correction.

**Compliance review:** every `/speckit-plan` and `/speckit-analyze` pass must
verify the plan does not violate a principle above; any violation found
during `/speckit-implement` must stop work and surface the conflict rather
than route around it.

**Version**: 1.0.0 | **Ratified**: 2026-10-01 | **Last Amended**: 2026-10-01
