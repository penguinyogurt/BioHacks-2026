# BioHacks 2026 — patient-constrained drug repurposing for ALS

This file is the single source of truth for both humans and agents working in
this repo. `CLAUDE.md` imports it; Codex, Cursor and Copilot read it directly.
If you change how the project works, change it **here**, not in a second file.

Devpost closes **Sun 2026-11-08 11:30 am**; expo judging 1:30–3:00 pm. Treat
**9:00 am Sunday** as the real deadline and leave the last two hours for the
pitch.

Full engineering spec (stages, rules, data sources, cut lines):
<https://claude.ai/artifact/HhAjTpMb2cjAAWqJHpgVMc>

---

## What this is

A five-stage elimination funnel over ~4,800 approved drugs:

| # | Stage | Question it answers | Removes |
|---|---|---|---|
| 1 | `universe` | Which drugs are approved and available? | Nothing — the input set |
| 2 | `kg_relevance` | Does it touch ALS biology? | No path to ALS in the knowledge graph |
| 3 | `bbb` | Can it physically reach the target tissue? | Wrong side of the barrier for its target |
| 4 | `patient_filter` | Is it safe and usable **for Alex**? | Interactions, his vulnerabilities, routes he can't manage |
| 5 | `trial_history` | Has this already been tried and failed? | Known failures, flagged not silently dropped |

**Stage 4 is the original contribution.** Stages 2 and 3 integrate published
methods. The second output — the "graveyard" — partitions failed ALS trial
drugs into `never_arrived` (predicted barrier-negative) and `arrived_failed`
(predicted barrier-positive). Nobody has published that partition for ALS.

## Architecture rule

Four Python modules each write **one JSON file** to `data/`. **Nobody imports
anybody else's code.** Integration happens through files, which is why all
four can be built simultaneously and a broken module doesn't block the rest.

```
kg_rank.py        → data/kg_scores.json
bbb_model.py      → data/bbb_scores.json
patient_filter.py → data/patient_filter.json
merge.py          → data/pipeline.json   ← joins on InChIKey
app/              → reads data/pipeline.json and nothing else
```

Do not propose refactors that couple these modules. The decoupling is the
schedule.

## The contract

`data/pipeline.json` is frozen. Its executable definition is
[`app/src/lib/contract.ts`](app/src/lib/contract.ts); the prose version with
field-by-field notes is [`docs/CONTRACT.md`](docs/CONTRACT.md).

**Check your output against it without running the frontend:**

```bash
npm run validate --prefix app -- path/to/your.json
```

Exits non-zero with readable problems. Wire it into your own script if you
like.

If the shape genuinely needs to change: update `contract.ts`, update the
committed sample in `data/pipeline.json`, run `npm run check --prefix app`,
and **tell the team in the same breath** — four people are writing against it.

## Repo map

```
AGENTS.md              this file — repo guidance for humans and agents
CLAUDE.md              imports this file, plus Claude-specific skill notes
README.md              human quickstart
docs/CONTRACT.md       the pipeline.json contract, annotated
data/pipeline.json     the frozen contract + a hand-written sample
app/                   the frontend (Vite + React 19 + TS + Tailwind v4)
  src/lib/contract.ts  zod schema — the ONLY place the UI learns the shape
  src/lib/validate.ts  CLI validator for the Python owners
  src/components/      one component per section of the report
.claude/skills/        21 vetted design/frontend skills (see CLAUDE.md)
skills-lock.json       pinned skill versions — `npx skills update` to refresh
```

## Commands

All frontend commands run from `app/` (or add `--prefix app`):

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :5173. HMR picks up `data/pipeline.json` edits instantly. |
| `npm run check` | Typecheck + contract tests. **Run before every push.** |
| `npm run validate -- <file>` | Validate any pipeline JSON against the contract. |
| `npm run build` | Typecheck + production build to `dist/`. |
| `npm run lint` | ESLint. |

## Frontend

Stack: Vite + React 19 + TypeScript + Tailwind v4 + `motion`. Static site, no
backend, no router.

**No shadcn/ui, no Radix, no component library.** This is one bespoke funnel,
one card and one chart — a library would be installed to go almost entirely
unused. Don't add one.

### Decisions — settled, don't re-litigate

**Layout: guided run, one screen.** The funnel runs on load; survivors land as
cards below it; a replay control re-runs it in ~3s. Graveyard partition and
validation sit one scroll down. A judge arriving mid-conversation sees the
whole argument without anyone touching the laptop.

**Typography: three voices, one job each.** Instrument Serif carries headings
(h1/h2 only — it's a high-contrast display face whose thin strokes break up
at body size, and it ships one weight, so never put `font-semibold` on a
heading). Inter carries prose. System mono carries every number. Both faces
are self-hosted via `@fontsource` rather than a CDN: a webfont request that
fails at the expo table takes the whole look with it.

This is the change that bought the most visual ground. Of three
award-winning reference projects, two shipped no animation library at all —
each bought its look with a single display typeface.

**Aesthetic: dark lab console.** Deep purple-black ground, elevated surfaces,
luminous data. Dense, tabular monospace numerals, **one** accent reserved for
elimination. Revised 2026-11-07 from an earlier light "clinical instrument"
direction — the earlier call optimised for a clinician's trust, this one
optimises for a judge's attention at an expo table, which is what actually
decides the outcome. The data discipline did not change: colour still never
carries meaning alone, numbers are still tabular, nothing is decorative at
the cost of being readable.

**Candidate volume: top 100 + all late cuts.** `merge.py` emits the top 100 by
`kg.score` plus **every** drug eliminated at `patient_filter` or
`trial_history` regardless of rank. Everything cut earlier exists only as
funnel counts. Keeps the file ~200KB and guarantees stage 4 is always fully
visible. This is a deliberate change from the spec.

### Non-negotiables

- Eliminated candidates stay in `candidates[]` with `verdict` and
  `eliminated_at` — the UI animates them leaving.
- `filters[]` is **ordered**. Render in rule order and highlight the first
  failure; it's the decisive one.
- `bbb.in_domain === false` → **never render `bbb.prob`.** Show the Tanimoto
  distance instead. Don't display a number the model can't stand behind.
- Reason strings render **verbatim**. They're the clinical receipt; never
  paraphrase them in JSX.
- The funnel must not make stage 4 look trivial. Bars are log-scaled and every
  stage gets equal dwell time, both on purpose.
- Alex comes before the drugs. His chart values live in
  `patient_profile` in the data, never hardcoded in a component.

Audience: judges at an expo table, 90 seconds, laptop screen. Optimise for one
legible story at arm's length, not for mobile.

## Working style

- **Shortest working diff.** No abstraction for one use, no config for a value
  that never changes, no scaffolding "for later".
- **Never leave `main` in a state where `data/pipeline.json` doesn't render.**
  A broken demo costs more than a missing feature.
- Non-trivial logic leaves one runnable check behind. `app/src/lib/contract.test.ts`
  is the pattern: node's built-in test runner, no framework.
- Branch per piece of work, PR into `main`. Commit messages say *why*, not what.
