---
name: gymapp-development
description: Standard procedure for implementing a GymApp task — Understand, Inspect, Plan, Implement, Validate, Review, Report — with GymApp-specific guardrails.
---

# GymApp development procedure

Use this procedure for any implementation task in the GymApp repository. It
assumes you have already read `AGENTS.md` and the relevant `docs/*.md`
architecture documents; this skill does not repeat that content.

## 1. Understand

- Read the task definition in full (see `tasks/README.md` for the task
  format) — objective, scope, out-of-scope, acceptance criteria, and allowed
  files/areas.
- If the task is ambiguous, under-specified, or would touch an area marked
  out-of-scope to accomplish its goal, stop and ask rather than guessing.

## 2. Inspect

- Check current branch and `git status` before making any change.
- Read the actual current code/schema for the area you're touching — do not
  rely solely on `docs/` summaries, which describe historical or reconciled
  state and may already be stale.
- Check `tasks/in_progress/` and recent commits/branches for overlapping
  work by another agent.

## 3. Plan

- Write a short plan: what will change, what won't, which files are
  touched, and how it will be validated.
- If the plan would require deploying, touching production Supabase,
  merging to `main`, deleting legacy data, or otherwise crossing a line in
  `AGENTS.md`, stop and request human approval before proceeding.

## 4. Implement

- Work on a dedicated branch — never directly on `main`.
- Make the smallest change that satisfies the acceptance criteria. Avoid
  opportunistic refactors of unrelated code (in particular, do not
  refactor `app.js` wholesale as a side effect of an unrelated task).
- Do not invent or assume exercise identity outside the approved catalog;
  do not weaken deterministic safety validation in favor of prompt-only
  logic.

## 5. Validate

- Run whatever automated checks exist for the area touched.
- If none exist, describe the manual validation performed (exact steps and
  observed result) or explain explicitly why validation isn't applicable.
- For anything touching safety/compatibility logic, restriction lifecycle,
  or legacy exercise IDs, validate against real current data/schema, not
  assumptions from the historical docs.

## 6. Review

- Re-read your own diff before reporting it done. Confirm it matches the
  task's declared scope and allowed files — nothing more.
- Confirm no secrets, API keys, or service-role credentials were introduced.

## 7. Report

Report, per `CLAUDE.md`:

- files modified,
- validations performed and their results,
- risks,
- pending decisions that need human approval.

Update the task file's status and result section (see `tasks/README.md`).

## Guardrails specific to GymApp

- Legacy exercise IDs (`ejercicios`, `rutina_ejercicios`,
  `series_registradas`) are never deleted or replaced in place without a
  verified crosswalk.
- `Gym-Exercise-Library` is consumed through an explicit contract, never by
  reading its repository internals directly.
- No medical diagnosis or inferred recovery logic. Restrictions have an
  explicit lifecycle and never auto-resolve by date.
- No production Supabase changes, no deploys, no merges to `main` — those
  require explicit human approval regardless of how confident the task
  output is.

## Done criteria

A task is done only when:

1. the acceptance criteria in the task file are met,
2. changes are confined to the allowed files/areas (or any exception is
   explicitly called out),
3. validation was performed and reported (or its absence explicitly
   justified),
4. the task file's status and result section are updated,
5. nothing was merged, deployed, or applied to production without human
   approval.
