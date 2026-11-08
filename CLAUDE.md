@AGENTS.md

---

# Claude-specific notes

Everything about the project and how we work is in `AGENTS.md`, imported
above — including the session ritual (read `docs/STATUS.md`, update it before
you stop). This file only covers what's specific to working here as Claude.

## Skills

21 skills under `.claude/skills/`, installed via `npx skills` and pinned in
`skills-lock.json` so the whole team gets the identical set. Audited on
install: none declare hooks, the only bundled script is a Tailwind docs sync.

**Load them rather than improvising — that's the point of having them.**

### Before writing any UI

- `baseline-ui` — ~40 MUST/NEVER Tailwind rules. Run as a linter pass.
- `emil-design-eng` — the motion decision framework. Durations by element
  type, stagger 30–80ms, custom easing curves, never `ease-in` on UI.
- `better-ui` — exact radius/shadow/press values.
- `better-typography` — `tabular-nums` on every readout, line-height
  1.1 / 1.2–1.3 / 1.5, −0.01em tracking above 24px.
- `better-colors` — semantic tokens, OKLCH ramps, and the rule that matters
  most here: colour must never be the only carrier of pass/fail.
- `apple-design` — spring feel, reduced-motion, material and depth.

### Animation

`animate` to build · `review-animations` to critique a diff ·
`improve-animations` to audit the whole app · `find-animation-opportunities`
to find what should move · `fixing-motion-performance` for jank ·
`vercel-react-view-transitions` for the View Transition API.

There is **no trustworthy Motion/Framer Motion skill** — the best candidate
gives blanket `will-change` advice. Rely on the above.

### Tailwind and React

- `tailwind-4-docs` — **check before writing config or `@theme`.** v4 differs
  sharply from the v3 that dominates training data.
- `tailwind-v4-shadcn` — the Vite + Tailwind v4 setup and its CSS-variable
  gotchas. `frontend/` uses exactly this stack, shadcn half included.
- `tailwind-design-system` — tokens and component structure.
- `vercel-react-best-practices` — perf review before the demo.

### Review

- `better-interface` — orchestrates `better-ui` / `-typography` / `-colors` /
  `-accessibility` into one ranked report. **This is the single pre-demo pass.**
- `better-accessibility` — WCAG 2.2 with severity.
- `prototype` — divergent layout variants on one route with a switcher, for
  settling a shape fast instead of iterating in place.
- `web-design-guidelines` — rules vendored to `guidelines.md`, so it works
  offline at the expo.

### Not installed, deliberately

`taste-skill@design-taste-frontend` (installs a Stop hook, runs headless
Chrome, failed a third-party trust audit) · `ui-ux-pro-max` and `ui-taste`
(lookup databases and paid-MCP routers, no judgment) · `gsap-skills` (adds a
dependency, silent on exit animation) · `knowledge-work-plugins@data-visualization`
(matplotlib, not React).

One-off slop check needing no install: `npx impeccable detect frontend/src/`
— 62 deterministic rules, no LLM.

Maintenance: `npx skills update` · `npx skills add owner/repo@skill -y`.

## shadcn/ui in `frontend/`

Components live in `frontend/src/components/ui/`. Add more with
`npx shadcn@latest add <name>` — but the CLI resolves `@` as a literal
directory here and writes `cn` imports as `from "cn"`, so after adding, move
`frontend/@/components/ui/*` into `src/components/ui/` and fix that import.
The hand-written `components.json` is correct; don't run `init` over it.

## Also available from Henri's global plugins

`frontend-design` and `dataviz` are enabled on his account, not in this repo —
teammates cloning this won't have them. Don't rely on them for anything a
committed skill should cover.
