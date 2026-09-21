# AGENTS.md — Shared rules for agents working on GymApp

This file defines the rules that apply to **any** agent (Claude Code, OpenAI
Codex, ChatGPT, or any future automation) that reads, plans, or writes code in
this repository. If an instruction elsewhere conflicts with this file, this
file wins unless a human explicitly overrides it for a specific task.

## Source of truth

- **GitHub is the source of truth** for code, Edge Functions, and
  documentation. The deployed Supabase project is a runtime target, not a
  design reference — deployed state that disagrees with GitHub is a finding
  to record, not something to silently trust or silently fix.
- `main` is never modified directly. Every implementation task happens on a
  dedicated branch.
- No agent merges to `main`, deploys to production, or modifies the
  production Supabase project without explicit human approval. This includes
  schema changes, Edge Function deploys, RLS policy changes, and data
  migrations.

## Catalog and domain ownership

- `Gym-Exercise-Library` (a separate repository) is the canonical system for
  objective exercise identity, metadata, taxonomy, provenance, and media.
  GymApp does not duplicate or fork that authority.
- GymApp owns users, profile, goals, context, constraints, rehabilitation,
  plans, history, and personalization.
- Do not remove or replace legacy GymApp exercise IDs
  (`ejercicios`, `rutina_ejercicios`, `series_registradas`, etc.) until a
  verified crosswalk to canonical `Gym-Exercise-Library` IDs exists. Legacy
  IDs are load-bearing for historical routines and logged sets.

## Safety and AI-generation boundaries

- An LLM may select or compose a routine **only** from an already-filtered
  set of allowed candidates. It does not decide safety on its own.
- Physical safety/compatibility validation must be deterministic and run
  outside the LLM (in code), never trusted to prompt text alone.
- GymApp does not diagnose medical conditions and does not infer recovery.
  A time-bounded physical restriction never disappears automatically because
  a date passed — resolving, extending, or modifying it requires an explicit
  user action.
- Training history (sets, weights, completed routines) must be preserved,
  not overwritten or silently discarded by migrations or refactors.

## Process rules

- Before starting any task: check the current branch and `git status`. Do
  not build on unexpected uncommitted state without understanding it first.
- Non-trivial changes require tests, or an explicit written explanation of
  why a test is not applicable.
- Check `tasks/` and recent branches/commits before starting work to avoid
  duplicating another agent's in-progress task.
- Never commit secrets, API keys, or Supabase service-role credentials to
  Git, in code, docs, or task files.
- If completing a task would require breaking any rule in this file, stop
  and request an explicit human decision instead of proceeding.

## Current architecture

This file intentionally does not duplicate architecture details. Read these
before making design or implementation decisions:

- `docs/CLAUDE_WEB_HANDOFF.md` — historical product/architecture context;
  not a spec for future work.
- `docs/CURRENT_STATE_RECONCILIATION.md` — verified state of the deployed
  Supabase project, schema, catalog, and frontend/backend behavior.
- `docs/REENGINEERING_DECISION_FRAME.md` — what the next architecture must
  preserve, replace, separate, and introduce; defines the
  GymApp / Gym-Exercise-Library boundary and the first implementation slice.

When in doubt about scope or architecture, these three documents govern —
not assumptions carried over from chat history or memory.
