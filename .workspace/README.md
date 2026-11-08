# .workspace/ — your stuff, not the team's

Everything in this directory is gitignored except this README. It is where
your own working material lives so it stops leaking into the repo and into
everyone else's diffs.

## Put here

- **Your personal `CLAUDE.md` / `AGENTS.md` / `.cursorrules`** — whatever your
  harness reads that is about *how you work*, not how the project works.
- Scratch scripts, one-off queries, data dumps, `.env` files you're testing.
- Notes to yourself, half-finished thinking, TODOs you haven't shared yet.
- Screenshots and recordings you haven't picked from yet.

Suggested shape, but it's yours — nobody else sees it:

```
.workspace/
  CLAUDE.md        your personal agent instructions
  notes.md         your running scratchpad
  scratch/         throwaway scripts and data
```

## Do NOT put here

**Anything another person needs.** That is the whole point of the split. If
you find yourself writing something here that a teammate would want to read,
it belongs in the repo instead:

| What you're writing | Where it goes |
|---|---|
| How the project works, for everyone's AI | root `AGENTS.md` |
| A design, spec, or research finding | `docs/` |
| Why a decision was made | `docs/DECISIONS.md` |
| Status, blockers, what you're on | `docs/STATUS.md` |
| A rule your AI keeps getting wrong | root `AGENTS.md` |

A note in `.workspace/` is invisible to the other three people and to their
agents. If it matters, it does not go here.

## Why this exists

Each AI harness writes its own machine-local config into the repo root
(`.claude/settings.json`, `.codex/`, `.cursor/`, `.entire/`). Those are all
gitignored now. This directory gives you one obvious place for the rest, so
`git status` stays readable and nobody commits their own agent setup over
somebody else's.
