# Findings — what we learned the hard way

**Tasks are not here any more.** Work is claimed in GitHub Issues:

```bash
gh issue list                  # what's open
gh issue list --assignee ""    # what's free
gh issue edit <n> --add-assignee @me
```

This file is for the other thing: numbers that turned out wrong, two people
colliding, traps that cost someone an hour. Things you need *before* you
pitch or before you merge, which don't belong in a task.

Add to it when you find one. It's cheaper than the next person finding it
again.

Last updated: **2026-11-08**

---

## ⚠ Two people are building the same pipeline right now

**Jeremy** has the five-stage discovery pipeline in `frontend/` — scripted
TypeScript, `MATCHES` hand-written, labelled "Simulated".

**Levi** has `backend/query-generation/` on `agentic-query-generation` —
**five real Python agents** (`disease-indications`, `genes-targets`,
`pathways-processes`, `safety-interactions-class`, `symptoms-function`)
plus `ranking/intersection.py` and `ranking/fallback.py`, grounded in DRKG
and gated on human ALS exposure.

That is the same five agents, twice. One is the demo, one is the engine,
and **they share no git history** — `agentic-query-generation` has no merge
base with `main`.

Whoever picks this up: the cheapest win in the repo is making Jeremy's
`PipelineEvent` stream come from Levi's agents instead of a timer. The seam
already exists. Talk before either of you builds further.

**Neo** has a third piece, `agent/` (PR #4): a Claude orchestrator that plans
ALS criteria and runs parallel LLM sub-agents that return drug-free *target
profiles* (genes + desired action, pathways, site). These are the anchors
Levi's DRKG agents need, and its SSE stream is a live source for Jeremy's
`PipelineEvent`s. How to combine all three without building a fourth:
[`RESEARCH_AGENT_HANDOFF.md`](RESEARCH_AGENT_HANDOFF.md).

## Found while auditing — read before you pitch

Measured against Neo's real `pipeline.json` on `cursor/pipeline-graph-ui`,
not the sample. Full citations in [`FUS_RESEARCH.md`](FUS_RESEARCH.md).

1. **The graveyard overstates `never_arrived`.** 24 `never_arrived` / 8
   `arrived_failed` — but **21 of the 24 have no BBB prediction at all**
   (biologics, or out of the model's domain). `src/merge.py:211-214` files
   "no prediction" as `never_arrived`. Only ceftriaxone (p 0.39),
   pentoxifylline (0.29) and pioglitazone (0.29) are actually predicted
   BBB-negative. Honest split: **3 / 8 / 21 undetermined.** Say "3 predicted
   never-arrived, 21 we can't call" on stage, never "24" — a judge who knows
   gabapentin crosses the BBB will catch it.
2. **Same error in the funnel.** "2,440 eliminated: predicted BBB-negative"
   is **1,593 predicted negative + 847 out of domain.** The honest number is
   still the strong one: **1,593 approved drugs the model says can't cross.**
   That is the FUS-unlocked pool — use it.
3. **Discovery stage 3 is fake while a real one exists.** `MATCHES` in
   `frontend/src/lib/pipeline.ts` is hand-written; Neo's `src/drkg.py` loads
   the real DRKG TransE vectors. Note DRKG embeds *entities*, not text, so a
   profile has to become DRKG genes before it has a vector — Jeremy's
   profiles already list target genes, so that bridge is short.
4. **Three knowledge graphs and two FaceChecks exist.** Graph: Neo's
   `GraphCanvas`, Henri's stale `KnowledgeGraph.tsx`, and a "coming soon"
   placeholder on `main`. FaceCheck: Neo's TS original and Levi's JS port.
   Pick one of each.

## If main gives you a `tsconfig.tsbuildinfo` conflict — read this first

**Jeremy, this is the one you're hitting.** `frontend/tsconfig.tsbuildinfo`
is TypeScript's incremental build cache. It was committed by mistake, it
rewrites itself on every single build, so it conflicted constantly. `main`
untracked it on 2026-11-07 and it's gitignored now.

Your branch has it modified, main deleted it → modify/delete conflict.
Accept the deletion; it regenerates on your next build and will never come
back:

```bash
git rm --cached frontend/tsconfig.tsbuildinfo
git commit --no-edit
```

One time only. Sorry — that one's on Henri, and it was the only file under
`frontend/` that main touched.

## Heads-up if you merge main

`main` deleted `app/` on 2026-11-07, so branches that built there get
modify/delete conflicts (measured: 11 on `cursor/pipeline-graph-ui`, 19 on
`frontend/kg-and-provenance`). `Master-UI-Neo-Face-Integration` and
`codex/diagnostic-tests` share **no common ancestor** with main and can't be
merged without `--allow-unrelated-histories`. Your branch, your call.
