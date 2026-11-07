# BioHacks 2026 — patient-constrained drug repurposing for ALS

Hackathon. Devpost closes **Sun 2026-11-08 11:30 am**; expo judging 1:30–3:00 pm. Treat 9 am Sunday as the real deadline.

Full spec (the source of truth for pipeline stages, rules, data sources, cut lines):
https://claude.ai/artifact/HhAjTpMb2cjAAWqJHpgVMc

## What this is

Five-stage elimination funnel over ~4,800 approved drugs: universe → KG relevance → BBB gate → patient filter → trial history. Every surviving drug carries a receipt of what it passed. Second output: the "graveyard" — failed ALS trial drugs partitioned into `never_arrived` (predicted BBB−) vs `arrived_failed` (predicted BBB+).

## Architecture rule

Four Python modules each write one JSON to `data/`. **Nobody imports anybody else's code.** `merge.py` joins on InChIKey and emits `data/pipeline.json`. The frontend reads `data/pipeline.json` and nothing else.

`data/pipeline.json` is the frozen contract. The hand-written sample in this repo is canonical until `merge.py` produces a real one — if the shape needs to change, change the sample first and tell the team.

## Frontend (`app/`)

Stack: Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui + `motion` (Framer Motion). Static site, no backend, no router unless we need it.

### Decisions (made 2026-11-07, don't re-litigate)

**Layout — guided run, one screen.** The funnel runs on load: 4,805 collapses stage by stage, survivors land as cards below it. A persistent replay control re-runs it in ~3s. Graveyard partition and validation metrics sit one scroll down. Rationale: a judge who arrives mid-conversation sees the whole argument without anyone touching the laptop.

**Aesthetic — clinical instrument.** Dense, high-contrast, tabular monospace numerals for every number, near-neutral palette, **one** accent colour reserved for elimination. It should read as a tool a neurologist would open, because that is the claim being made. No gradients, no glassmorphism, no nested cards, no dark-console look.

**Candidate volume — top 100 + all late cuts.** `merge.py` emits: the top 100 by `kg.score`, **plus every drug eliminated at `patient_filter` or `trial_history` regardless of rank**. Everything cut earlier exists only as funnel counts. Keeps `pipeline.json` ~200KB, animates at 60fps, and guarantees the stage-4 contribution is always fully visible. This is a change from the spec — whoever owns `merge.py` needs to know.

### Design notes that outrank "make the chart accurate"

- **The funnel must not make stage 4 look trivial.** Linear bars make 4,465→340 look like the whole story and 12→6 look like rounding error, but the patient filter is the original contribution. Give each stage comparable screen time in the run, or scale non-linearly and label it honestly.
- **Alex comes before the drugs.** The chart numbers (supine FVC 61%, CK 470 U/L, 3 kg pinch) are what earn the clinical-grounding points. A judge should see the person the filter is built around before seeing a ranked list.
- **`in_domain: false` needs a designed state, not a blank.** Say the molecule is outside the model's domain and show the Tanimoto distance. Never render a suppressed probability as an empty space.
- **Parse at the boundary.** Validate `pipeline.json` on load and render a visible badge while `meta.sample` is true, so nobody ever demos fake numbers believing they're real.

Non-negotiables from the spec:
- Eliminated candidates stay in `candidates[]` with `verdict` + `eliminated_at` — the UI animates them leaving.
- `filters[]` is ordered; render in rule order and highlight the first failure.
- `bbb.in_domain === false` → **do not render `bbb.prob`** at all. Show "outside model's domain" instead.
- Reason strings come from the data verbatim. Don't paraphrase them in the UI.

Audience: judges at an expo table, 90 seconds, laptop screen. Optimise for one legible story at arm's length, not for mobile.

## Skills

21 skills under `.claude/skills/`, installed via `npx skills` (lockfile: `skills-lock.json`). Audited: none declare hooks; the only bundled script is a Tailwind docs sync. Load them rather than improvising — that's the point of having them.

**Before writing any UI**
- `baseline-ui` — ~40 MUST/NEVER Tailwind rules. Run as a linter pass. (`h-dvh` not `h-screen`, `text-pretty`, compositor-only props.)
- `emil-design-eng` — durations by element type, stagger 30–80ms, "never ease-in", hover gated behind a media query.
- `better-ui` — exact radius/shadow/press values. Its exit recipe *is* our card elimination: opacity + 4px blur + −12px translateY, 150ms ease-out.
- `better-typography` — `tabular-nums` for every probability and rule count; line-height 1.1 / 1.2–1.3 / 1.5; −0.01em tracking above 24px.
- `better-colors` — semantic tokens, OKLCH ramps. Critical for pass/fail: never let colour be the only carrier. White on Tailwind `500` fails 4.5:1.
- `apple-design` — spring/gesture feel, reduced-motion, material and depth.

**Animation**
- `animate` to build, `review-animations` to critique a diff, `improve-animations` to audit the whole app, `find-animation-opportunities` to find what should move.
- `fixing-motion-performance` — blur cap 8px, surgical `will-change`, no read/write interleave.
- `vercel-react-view-transitions` — for the stage-to-stage funnel transitions if we use the View Transition API.
- No trustworthy Motion/Framer Motion skill exists; the best candidate gives blanket `will-change` advice. Rely on the above.

**Tailwind / components**
- `tailwind-4-docs` — **check before writing config or `@theme`.** v4 differs sharply from the v3 that dominates training data.
- `tailwind-v4-shadcn` — the Vite + Tailwind v4 + shadcn setup, including CSS-variable gotchas.
- `tailwind-design-system` — tokens and component-library structure.
- `vercel-react-best-practices` — perf review before the demo.

**Review and iteration**
- `better-interface` — orchestrates `better-ui` / `-typography` / `-colors` / `-accessibility` into one ranked report. Use this as the single pre-demo pass.
- `better-accessibility` — WCAG 2.2 with severity. `:focus-visible` not `:focus`; a stable empty live region before announcing eliminations.
- `prototype` — several divergent layout variants on one route with a switcher. Use it to settle the funnel and partition-chart shape fast instead of iterating in place.
- `web-design-guidelines` — rules vendored to `guidelines.md` so it works offline at the expo.

Also available from Henri's global plugins (not in this repo, so teammates won't have them): `frontend-design`, `dataviz`.

Deliberately **not** installed: `taste-skill@design-taste-frontend` (installs a Stop hook, runs headless Chrome, failed a trust audit), `ui-ux-pro-max` and `ui-taste` (lookup databases / paid-MCP routers, no judgment), `gsap-skills` (adds a dependency, silent on exit animation), `knowledge-work-plugins@data-visualization` (matplotlib, not React).

One-off slop check needing no install: `npx impeccable detect app/src/` — 62 deterministic rules, no LLM.

Update: `npx skills update`. Add: `npx skills add owner/repo@skill -y`.

## Working style

Ponytail mode: shortest working diff. No abstractions for one use. Hackathon: a broken demo costs more than a missing feature — never leave `main` in a state where `data/pipeline.json` doesn't render.
