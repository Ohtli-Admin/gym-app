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
- Check `ESTADO.md`, `tasks/`, `specs/*/tasks.md`, open pull requests and
  recent branches before starting work to avoid duplicating another agent's
  in-progress task.
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

## Claude ↔ Codex relay with Spec Kit (owner decision, 2026-10-14)

Claude and Codex are interchangeable: both specify, plan, implement, test and close work under the same rules in this file. Claude is the default by the owner's preference; when Claude is unavailable (for example, out of usage), Codex continues exactly where it left off. No work waits for a particular model. This section replaces any earlier split of roles by model.

**Spec Kit designs the work** (`speckit-*` skills in `.claude/skills` and `.agents/skills`):
1. New feature: `speckit-specify` → `speckit-clarify` (required) → `speckit-plan` → `speckit-checklist` (when it touches security, data, AI or payments) → `speckit-tasks` → `speckit-analyze` (required; no CRITICAL findings) → `speckit-implement`, one user story per pull request → `speckit-converge` before calling the feature done.
2. The owner approves the spec and the plan (one pull request or comment). After that, tasks, analyze and implement run without asking, except for what this section marks as risky.
3. A feature already in flight is not re-specified. Follow its `tasks.md`; `speckit-converge` appends whatever is missing.
4. Tasks in `tasks.md` belong to whoever picks them up. Older model tags such as `[CODEX …]` no longer restrict who does them.
5. Small fixes and chores without a spec: a task file in `tasks/` (flow in `tasks/README.md`, skill `cierre-de-tarea`), with the same relay rules.

**Relay** (Spec Kit extension `relevo` in `.specify/extensions/relevo/`; it runs by itself as a hook):
- Before `specify` and `implement`: `speckit-relevo-retomar` reads `ESTADO.md` and open pull requests, then continues the task in progress or takes the next one under "Sigue".
- After every Spec Kit command, and always before ending your turn even if the task is unfinished: `speckit-relevo-cerrar` (check off `tasks.md`, the **Relevo** block in the pull request, `ESTADO.md`, commit and push). Nothing stays only on the machine.
- For "where did we leave off?": `speckit-relevo-estado`.
- Work outside Spec Kit follows the same rules by hand.

**Risk does not depend on the model.** Merging to `main`, deploying, and any change to the production Supabase project (schema, RLS, Edge Functions, data migrations), as listed under "Source of truth", wait for the owner's explicit "yes", whichever agent is working.

**Cross review:** when both are available, the pull request is reviewed by the agent that did not write it (`@codex review` on GitHub, or Claude).

**Replies:** at most 8 lines: result, verification (command and real output), risks, and what you need from the owner.

## Anti-waste rules (all agents)

These apply alongside the rules above. When another rule in this file asks for more (reading context, running tests, reporting), that rule wins; reading what this file requires does not count as research.

- Deliver exactly what was requested. Do not research unless asked.
- Do not expand scope, do opportunistic refactors, or redesign architecture unless the deliverable requires it.
- Do not modify files unrelated to the task.
- If the request has no "done" criterion, propose one in a single line and continue.
- Use the minimum tests that prove the change works; once they pass, stop. No extra test rounds.
- Before saying "done", show the verification result.
- Do not spawn subagents unless asked.
- Search (grep/glob) before opening whole files.
- Keep replies short: result first.
