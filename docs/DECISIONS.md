# Decisions

Append-only, newest first. Three lines each: **what** we decided, **why**,
and what it **rules out**.

A decision here is settled — don't re-litigate it without new information.
If you reverse one, append the reversal; don't edit the old entry away.

---

## 2026-11-08 — Research sub-agents describe drugs, they don't name them

**What:** `agent/` sub-agents return target profiles (HGNC targets + desired
action, pathways, site, constraints, evidence) and never drug names; a
separate matcher (DRKG / embeddings) turns profiles into drugs.
**Why:** an LLM naming drugs pre-empts and biases the matching step, and
lands on the same famous handful every time. Profiles are also what Levi's
DRKG agents need as anchors.
**Rules out:** sub-agents with drug-level tools, or drug names in profile
text (`no_drugs.py` scrubs them). Drug-level tools stay for the matcher.

## 2026-11-07 — `frontend/` (Motus) is the only frontend

**What:** Deleted `app/` (Vite drug-funnel UI) and `web/` (a Next 16 rebuild
of the same). `frontend/` is the one frontend.
**Why:** Three frontends existed for one project because nobody checked
before starting. Two of them rendered a story we are no longer leading with.
**Rules out:** Reviving the lab-console funnel UI as-is. It's in git history
(`6c9a0f4` and parents) if any of it is wanted back.

## 2026-11-07 — The contract lives in `contract/`, not inside a frontend

**What:** Moved `contract.ts`, `contract.test.ts` and `validate.ts` out of
`app/src/lib/` into a standalone `contract/` package with one dependency
(zod).
**Why:** The Python owners run `npm run validate` to check their output. That
check must not die because a frontend was deleted, and it must not require
installing React to run.
**Rules out:** Putting schema code inside any app directory again.

## 2026-11-07 — Per-person AI config is gitignored; `.workspace/` is for the rest

**What:** `.claude/settings.json`, `.codex/`, `.cursor/`, `.entire/` are
ignored. `.workspace/` added for personal notes and agent instructions.
**Why:** Each harness writes machine-local hooks into the repo root. Four
people committing those is a merge fight with no upside.
**Rules out:** Committing your own agent setup. Shared rules go in
`AGENTS.md` where all four harnesses read them.

## 2026-11-07 — `data/pipeline.json` stays; the drug pipeline is live

**What:** Kept `data/pipeline.json`, `docs/CONTRACT.md` and the validator
even though the UI that rendered them is gone.
**Why:** `cursor/pipeline-graph-ui` is active work that writes against this
contract. Deleting a frontend is not a decision to drop the track.
**Rules out:** Treating the drug-repurposing work as abandoned.

---

## Earlier, carried over from the previous `AGENTS.md`

These were settled during the first frontend build. They're kept because the
reasoning still applies to Motus, even though the UI they described is gone.

- **Self-host fonts, don't use a CDN.** A webfont request that fails at the
  expo table takes the whole look with it.
- **Gate entrance animations on visibility, not on mount.** Animations below
  the fold played and finished before anyone scrolled to them. `Reveal` sets
  opacity, which hides an animation rather than pausing it — use
  `useOnScreen` or `whileInView`.
- **Don't animate a dither/noise background.** At any speed slow enough to
  read as texture the canvas is bit-identical frame to frame, while the
  render loop cost 33.3ms — it halved the frame rate of everything else.
- **Don't use a ref as a "have I started" guard in an effect.** A ref
  survives StrictMode's mount/cleanup/mount, so the first cleanup cancels the
  work and the second mount skips it. Latch on state.
- **Run a palette validator rather than reasoning about colour.** Our
  pass/fail green-and-red measured ΔE 7.9 for deuteranopia — the single worst
  pair available.
