# BioHacks 2026 — repo guide for humans and AI

**This file is the single source of truth.** `CLAUDE.md` imports it; Codex,
Cursor and Copilot read it directly. If you change how the project works,
change it **here**, not in a second file and not in a DM.

Devpost closes **Sun 2026-11-08 11:30 am**; expo judging 1:30–3:00 pm. Treat
**9:00 am Sunday** as the real deadline and leave the last two hours for the
pitch.

---

## Read this before you touch anything

Four people are working in parallel with AI agents. The thing that has cost
us the most time is not bugs — it is **two people building the same thing
because neither knew what the other was doing.** We have already shipped
three separate frontends for one project.

So, in order, every session:

1. **See what's taken.** Fifteen seconds:
   ```bash
   gh issue list                 # everything open
   gh issue list --assignee ""   # unclaimed only
   ```
2. **Claim before you write code** — assign yourself. Assignment is
   server-side, so two of you can't both get it:
   ```bash
   gh issue edit <n> --add-assignee @me
   ```
   Not an issue yet? `gh issue create` it, then assign. That *is* the claim;
   don't go looking for permission. **Small stuff is exempt** — reading,
   answering, a typo, anything under ~10 minutes. Claim when you're about to
   create a file, change a shared one, or settle somewhere for a while.
3. **Check the map below** for which directory your work belongs in. If your
   change doesn't obviously fit one, say so before writing code.
4. **Before you stop**, close it (`gh issue close <n> -c "what landed"`) or
   unassign and comment where you left it. Even "I got nowhere on X" is
   worth more to the other three than silence.

Findings that aren't tasks — a number that turned out wrong, two people
colliding — go in [`docs/STATUS.md`](docs/STATUS.md). Issues are the work;
STATUS is what we learned.

**If you are an agent, steps 1, 2 and 4 are not optional and you do them
without being asked.** You are one of several agents working this repo at
the same time — Claude, Codex, Cursor and a Copilot bot have all committed
here — driven by different people, and you cannot see the others. The issue
list is the only thing that stops two of you writing the same file from
opposite directions. If what you were about to start is already assigned to
someone else, stop and tell your human rather than doing it anyway.

---

## What's here

| Directory | What it is | Stack |
|---|---|---|
| `frontend/` | **Motus** — the product. Longitudinal at-home ALS monitoring: speech, typing and handwriting tracked against a personal baseline. Landing + dashboard. | Vite · React 19 · TS · Tailwind v4 · shadcn/ui · Supabase · three |
| `contract/` | The `data/pipeline.json` schema, its tests, and the CLI validator. Owned by nobody, depended on by everybody. | zod · node:test |
| `data/` | `pipeline.json` — the frozen contract plus a hand-written sample. | — |
| `docs/` | Specs, research, decisions, status. **See "Documentation" below.** | — |
| `.claude/skills/` | 21 pinned design/frontend skills. See `CLAUDE.md`. | — |
| `.workspace/` | Your personal scratch, gitignored. See its README. | — |

### Work that lives on branches, not on main

Not everything is merged. Before starting something, check whether it already
exists here:

| Branch | What's on it |
|---|---|
| `cursor/pipeline-graph-ui` | The **drug-repurposing pipeline** — `bbb_model.py`, `patient_filter.py`, `merge.py`, `graveyard.py`, scored across 3,791 compounds. This is live work, not abandoned. |
| `cursor/facial-als-validation` | **FaceCheck** (`facecheck/`) — MediaPipe facial-amplitude prototype. Spec: [`docs/FACECHECK_SPEC.md`](docs/FACECHECK_SPEC.md). |
| `Master-UI-Neo-Face-Integration` | Speech and diagnostic test apps (`master-app/`, `speech-test-good/`, `facial-test/`, `line-test/`). **Unrelated git history** — it does not share a root with `main`. Merging it is a decision, not a chore; log it in `docs/DECISIONS.md` first. |

**Nothing above is dead.** If you think a track should be dropped, that is a
decision — write it down, don't silently stop maintaining it.

---

## The rules that keep four people from colliding

### One track per branch, one owner per file

Two agents editing the same file in parallel is how we lose an afternoon.
Claim your area in `docs/STATUS.md` and stay in it. If you need a change in
somebody else's file, say so in STATUS rather than reaching in.

### Don't build a second one

Before creating a new app, page, module or script: **search for it first.**
`git branch -r`, then grep. Three frontends happened because nobody looked.
If what exists is wrong, fix or replace it deliberately and say so — don't
leave both standing.

### Add an env var, update `.env.example` in the same commit

Non-negotiable, and it applies to agents without being asked. The moment you
read a new `import.meta.env.*` or `os.environ[...]`, add it to the matching
`.env.example` with a comment saying what it's for and whether the app runs
without it.

Nobody else can see your `.env` — it's gitignored, which is the point. An
undocumented variable means the next person clones the repo, gets a blank
screen or a crash, and loses twenty minutes to a key they didn't know
existed. At 3am on Sunday that is the whole evening.

Never put a real value in `.env.example`, and never commit a `.env`. If a
key does land in a commit, say so immediately and rotate it — it's in the
history whether or not you delete the file.

### Integration happens through files, not imports

Each module writes **one JSON file**. Nobody imports anybody else's code.

```
the Python pipeline  → data/pipeline.json   (validated by contract/)
FaceCheck            → facecheck.session.v3 (its own export)
frontend/            → reads what it's given, imports no pipeline code
```

This decoupling is the schedule: all four tracks can be built at once and a
broken module doesn't block the rest. **Do not propose refactors that couple
them.**

### The contract is frozen

`data/pipeline.json`'s executable definition is
[`contract/contract.ts`](contract/contract.ts); the annotated prose version is
[`docs/CONTRACT.md`](docs/CONTRACT.md).

Check your output without running any frontend:

```bash
npm run validate --prefix contract -- path/to/your.json
```

Exits non-zero with readable problems. If the shape genuinely must change:
update `contract/contract.ts`, update the sample in `data/pipeline.json`, run
`npm test --prefix contract`, log it in `docs/DECISIONS.md`, and **tell the
team in the same breath.**

---

## Documentation — what goes in `docs/`

The test is simple: **would a teammate arriving tomorrow need this, and would
they find it?** If yes, it goes in `docs/`. Not in a commit message, not in
chat, not in your head.

| File | What belongs in it | When you write it |
|---|---|---|
| `docs/STATUS.md` | Who is on what, blockers, what just landed. | Start and end of every session. |
| `docs/DECISIONS.md` | Why we chose X over Y. Append-only, newest first. | Any time you make a call someone could reasonably reverse. |
| `docs/CONTRACT.md` | The `pipeline.json` shape, annotated. | When the contract changes. |
| `docs/<THING>_SPEC.md` | A design: what it's for, what exists, what's open. | Before building something non-trivial. |
| `docs/<THING>_RESEARCH.md` | Findings with citations. Mark anything unverified as **unverified** — never guess an author or year. | As you research. |

**Non-trivial work leaves a doc behind.** A spec before, findings after. If
the explanation lives only in a chat window, it does not exist on Sunday
morning when someone else has to demo it.

### Decisions get logged, not argued twice

`docs/DECISIONS.md` entries are three lines: what we decided, why, and what
it rules out. A decision in the log is **settled** — don't re-litigate it
without new information, and if you do reverse one, append the reversal
rather than editing history.

---

## Branches, commits, PRs

- **Branch naming: `<track>/<what>`.** Tracks are `pipeline`, `facecheck`,
  `speech`, `frontend`, `docs`. We currently have four naming conventions in
  flight (`cursor/…`, `codex/…`, `Master-UI-…`); new branches use this one so
  `git branch -r` is readable.
- **Branch per piece of work. PR into `main`.** No direct pushes to `main`.
- **Commit messages say _why_, not what.** The diff already says what.
- **Never leave `main` in a state where the frontend doesn't render.** A
  broken demo costs more than a missing feature.
- Non-trivial logic leaves **one runnable check** behind.
  [`contract/contract.test.ts`](contract/contract.test.ts) is the pattern:
  node's built-in test runner, no framework.

---

## Commands

```bash
npm install --prefix frontend          # once
npm run dev --prefix frontend          # Motus on :5173

npm test     --prefix contract         # contract tests
npm run validate --prefix contract -- <file>   # validate any pipeline JSON
```

**There is no CI.** We deleted it — it's a hackathon and a red X on a PR
nobody has time to read is just noise. That makes the two commands above
yours to run: the contract is the integration point between four people, so
if you change its shape and don't check, the first person to find out is
whoever is demoing.

---

## Working style

- **Shortest working diff.** No abstraction for one use, no config for a
  value that never changes, no scaffolding "for later".
- Audience: judges at an expo table, 90 seconds, laptop screen. Optimise for
  one legible story at arm's length, not for mobile.
- Colour never carries meaning alone — pair it with a glyph, a shape or a
  position. (Our pass/fail pair measured ΔE 7.9 for deuteranopia.)
- Numbers are tabular. Reason strings render **verbatim** — they're the
  clinical receipt, never paraphrase them in JSX.

---

## When this file is wrong

It has been wrong before, and it sent two people into a directory that no
longer existed. That is the most expensive failure mode this repo has.

**If you find a drift between this file and reality, fix this file first,
in the same PR as your change.** Not later, not in a comment. A stale
`AGENTS.md` is worse than no `AGENTS.md`, because four agents believe it.
