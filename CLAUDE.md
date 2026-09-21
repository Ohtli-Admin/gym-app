# CLAUDE.md

Before working in this repository:

1. Read [`AGENTS.md`](AGENTS.md) — the shared rules for every agent working
   on GymApp — and follow it in full. Do not restate it; treat it as binding.
2. Read whichever of `docs/CLAUDE_WEB_HANDOFF.md`,
   `docs/CURRENT_STATE_RECONCILIATION.md`, and
   `docs/REENGINEERING_DECISION_FRAME.md` are relevant to the task before
   proposing or making changes.
3. If a task file exists under `tasks/`, read it fully (scope, out-of-scope,
   acceptance criteria, allowed files) before touching code.

## How to work

- Inspect current code and deployed behavior before modifying anything —
  don't assume the historical docs describe the current state exactly.
- Prefer small, independently reviewable changes over large ones. If a task
  seems to require broad, sweeping changes, pause and confirm scope first.
- Run whatever validation exists for the area you touched (existing checks,
  manual reproduction steps, or tests you add). If nothing exists, say so
  explicitly rather than skipping the question.
- Never deploy, modify production Supabase, or merge to `main` yourself —
  see `AGENTS.md` for the approval boundary.

## What to report back

At the end of a task, report:

- **Files modified** — exact list.
- **Validations performed** — what you ran or checked, and the result.
- **Risks** — anything that could break existing behavior, data, or the
  legacy exercise catalog.
- **Pending decisions** — anything that needs explicit human approval before
  it can proceed (per `AGENTS.md`).

For the full standard procedure for implementation tasks, use the
`gymapp-development` skill in
`.agents/skills/gymapp-development/SKILL.md`.
