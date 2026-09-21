# Tasks

This directory coordinates implementation work across agents (Claude Code,
OpenAI Codex, ChatGPT, humans). Every task is a single Markdown file that
moves between status folders as its state changes.

No implementation tasks exist yet — this is the coordination flow only.

## Status flow

```
READY -> IN_PROGRESS -> REVIEW -> DONE
                |
                v
            BLOCKED
```

- **READY** (`tasks/ready/`) — defined, unclaimed, safe to pick up.
- **IN_PROGRESS** (`tasks/in_progress/`) — an agent/human owns it and is
  actively working on it.
- **REVIEW** (`tasks/review/`) — implementation done, awaiting review
  (human or another agent) before it can be considered finished.
- **DONE** (`tasks/done/`) — reviewed and complete.
- **BLOCKED** (`tasks/blocked/`) — cannot proceed (missing decision,
  dependency, or conflicts with `AGENTS.md`); says why and what would
  unblock it.

A task moves between folders by moving the file — `git mv` — not by copying
it. The task's own `status` field must always match the folder it's in.

## Picking up a task

1. Read `AGENTS.md` and confirm the task doesn't conflict with it.
2. Check current branch and `git status`.
3. Check `tasks/in_progress/` to avoid duplicating another agent's work.
4. Move the file to `tasks/in_progress/`, set `owner`, update `status`.
5. Follow the `gymapp-development` skill
   (`.agents/skills/gymapp-development/SKILL.md`).

## Task file format

Use `TEMPLATE.md` in this directory as the starting point. Every task must
include:

- **ID** — short stable identifier, e.g. `GA-001`. Also used as the
  filename: `GA-001-short-slug.md`.
- **Objective** — one or two sentences, what outcome this achieves.
- **Context** — why this task exists; link relevant `docs/*.md` sections.
- **Scope** — exactly what is included.
- **Out of scope** — explicitly excluded work, especially adjacent things
  it would be tempting to also do.
- **Acceptance criteria** — concrete, checkable conditions for "done".
- **Allowed files/areas** — the files or directories this task may touch.
  Touching anything outside this list requires flagging it, not silently
  doing it.
- **Dependencies** — other tasks, decisions, or contracts this depends on.
- **Required validations** — tests to write/run, or manual validation
  steps, or an explicit justification if neither applies.
- **Status** — one of `READY`, `IN_PROGRESS`, `REVIEW`, `DONE`, `BLOCKED`.
- **Agent/Owner** — who is currently responsible for it.
- **Result** — filled in when work happens: summary, files touched,
  validations performed, risks, pending decisions.
