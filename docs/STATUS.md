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

## The whole discovery pipeline runs live (2026-11-08, Jeremy, `frontend/live-agent`)

One Run press chains three backend runs over SSE (`frontend/src/lib/agent-api.ts`),
and the page follows each stage by itself:
**research agents** (`/api/research`) → **DRKG** on the genes those agents named
(`/api/drkg` → `agent/drkg.py` runs `frontend/scripts/drkg_scene.py` as a
subprocess, so demo and live scenes use one scorer) → **drug assessment** on the
top 8 matches (`/api/assess`, Neo's `assess.py`, unchanged) → its PDF. If `:8001`
isn't up, it falls back to the scripted run; the badge says **Live agent** or
**Simulated**. ~100 s + ~2 s + several minutes.

Stage 3 starts at the research run's `verify` event (~60 s), not at its end: it
only needs the verified genes, which `graph.py`'s `verify` now also emits
(**Neo:** a second additive line). The orchestrator's ranking (`synthesize`,
~35 s more) streams alongside and opens stage 4's trace; the assessment waits
for both, since it reads the ranked profiles.

**Neo — `subagent.py`:** each `tool_result` event now carries `preview`, the first
1,500 characters of what the tool returned (sub-agents never see the patient, so
it's public data only). The profile cards' "Evidence returned" row shows it.
`chars` now counts that text rather than the repr of MCP's content list.

**Neo — `report_pdf.py` was rewritten (Jeremy's request):** the assessment PDF is now
a scientific paper (IMRaD: abstract, methods incl. DRKG retrieval, Table 1 + one
subsection per candidate, discussion, declarations, Vancouver references; serif,
justified). Same `render(report) -> bytes`, so `/report.pdf` and `assess.py` are
untouched; it also renders old reports without `score`. `schemas.py`'s summary and
limitations now ask for third-person scientific register (future runs only).

**Fixed: assessments crashed on PDF-built records** (`AttributeError: 'list' object has no attribute 'get'`). `assess.patient_context()` only knew the hand-written fixture shape; records from `POST /api/patients` (and `jordan.json`) use `PatientRecord`'s lists of items. It now handles both; `test_privacy.ReportHeader` runs it on every record in `data/patient/`.

**Report chat (Jeremy's request):** the Research report page has an "Ask about this report"
chat under the PDF once a live assessment finishes (`frontend/src/components/discovery/research-chat.tsx`).
It streams from a new `POST /api/assess/<id>/chat/stream` (SSE: answer tokens as `delta`, `draft_reset`, `thinking`, `tool_call`,
`tool_result`, then `answer`/`error`); the old `/chat` is unchanged. **Neo:** `chat.answer()`
takes an optional `emit`, tool calls are emitted after redaction (what actually left), and
`llm.claude(..., show_thinking=True)` sets `thinking.display: "summarized"` for the streamed
chat only. Opus 5.5 returns empty thinking text by default, so without it there's no visible reasoning.

- **Finished live reports are saved to Supabase** (signed-in users only): table
  `public.reports` (ids, ranking, full report JSON, **chat history**) and private bucket
  `reports/<user_id>/<run>.pdf`, both owner-only by RLS. Schema:
  `frontend/supabase/migrations/`; code: `frontend/src/lib/reports-db.ts`. The
  **Reports** page lists them from any machine (plus this session's simulated runs);
  a card opens its PDF in the app's own viewer straight from Supabase storage, so it
  keeps working after the agent backend is gone. Signed out, nothing is saved.
- **Report PDFs download as `<patient name> (<patient id>).pdf`**, e.g.
  `Alex Moreau (alex).pdf` (`api.pdf_filename`; the CORS config now exposes
  `Content-Disposition` so the frontend can read it).
- **A reload no longer loses the run.** The current run's three backend ids and the
  uploaded case PDF are kept in the browser (`frontend/src/lib/session.ts`); on load
  the app reconnects and the backend replays every event, so finished stages and the
  report come back with nothing re-run. "Clear run" forgets it.
- **Restart the backend** to pick up `/api/drkg`, and never with `uvicorn --reload`
  (Windows: subprocesses raise NotImplementedError under it). `numpy` is new in
  `requirements.txt`.
- **DRKG data is per machine**: 217 MB release into `backend/.venv/data/drkg/`
  (`DRKG_DIR`; setup lines in `backend/agent/.env.example`). First run builds a
  cache there in seconds.
- **Henri — two changes in `drkg_scene.py`:** `DRKG_DIR` env var (its
  `data/raw/drkg` default predates the reorg), and compound labels fall back to
  the committed `names.json` when the Wikidata TSV is absent. Also a real bug:
  eigenvector signs differ between numpy builds, so a cache rebuild here
  **mirrored islands 5 and 13** vs the committed `points.bin`. A rebuild now
  flips local axes to match the committed bins and keeps their bytes; verified:
  the default scene's query points reproduce exactly.
- The scene shader assumes ≤ 5 lanes (`laneAlpha`/`uLaneTime` are length 5);
  keep `AGENT_MAX_SUBAGENTS=5`.

- **Neo — one line in your file:** `graph.py`'s `plan` event now also carries
  `rationale`, so the UI can show the orchestrator's reasoning. Additive only.
- **The agent now uses the uploaded case PDF.** On Run it goes to `POST /api/patients`
  (Claude builds the record; ~10 s for the sample chart) under the id
  `<name>-<file hash>`, e.g. `alex-chen-d1cb54`, so the same file is read once. Every
  stage uses that record, so the report, PDF name and patient card all name the same
  person. Uploads are sent marked synthetic, and the upload page now says to use
  synthetic or de-identified cases only. Uploaded records are gitignored; only `alex.json`
  and `jordan.json` are tracked. `VITE_AGENT_PATIENT` is now only the fallback (replays).
- "Five agents" is `AGENT_MAX_SUBAGENTS=5` in your local `backend/agent/.env`;
  the planner may still pick 3–5. Lanes render from the plan, so any count works.
- Rehearse with `VITE_AGENT_REPLAY_RUN=<run_id>`: replays a recorded run at
  real speed, no API spend. A verified one for Alex: `r20261108-021643-3a9717`
  (96 s, 5 agents, 12 profiles). It lives in `backend/agent/runs/` (gitignored).
- **Neo — two bugs that run surfaced (not fixed):** `no_drugs.py` scrubs
  **"TDP-43" → "[drug]"** in the synthesis summary ("involves [drug]
  proteinopathy"; 20 removals that run), so it's over-matching biology terms.
  Root cause: `_CODE` (dev-code regex) matches `TDP-43`, and the hyphen makes
  `_GENE_LIKE` fail; `HSP-70`/`HSP-90` go the same way. Don't just drop the
  hyphen (that lets `MN-166` through); allowlist the protein names in
  `scrub.code()`, and add a `test_privacy.py` assert that "TDP-43
  proteinopathy" scrubs 0.
  And `backend/data/patient/alex.json` says **Alex Moreau**, while the
  frontend case (`alex-case.ts`) says **Alex Chen**. A judge will see both names.

## Knowledge graph view = the whole DRKG (2026-11-08)

Sidebar → **Knowledge graph** is a searchable explorer of all 97,238 DRKG
entities, on the same 24-island layout as stage 3. Search any name or id,
click to see full relation counts, graph neighbours (walkable) and the 10
nearest same-type entities in 400-d TransE. Data: `frontend/scripts/drkg_graph.py`
→ `frontend/public/drkg/graph/` (~20 MB). **Untracked since `frontend/live-agent`
(gitignored, Jeremy's call):** without the shards the page still renders the canvas
and name search, but no neighbour inspector. Rebuild them on the demo laptop with
`python frontend/scripts/drkg_graph.py` (needs the raw DRKG release). Merging
that branch deletes them from main. Things to know before demoing it:

- **Neighbour lists are capped at 44 per entity** (curated sources first);
  relation counts are always the full numbers. The inspector says "showing X of Y".
- **Rerunning the generator needs network once:** it fetches MeSH disease names
  from NLM (`id.nlm.nih.gov`, cached in `data/raw/drkg/cache/`). Offline it still
  runs, with bare MeSH ids.
- Typing **"als"** jumps to Amyotrophic Lateral Sclerosis (a small alias map in
  `graph-data.ts`); otherwise ALS-gene prefixes win.

## Repo reorg (2026-11-08): only `frontend/` and `backend/` at the top

`agent/`, `contract/`, `data/` → `backend/`; the six diagnostic dirs →
`backend/diagnostics/`. If your branch predates this, merge `main` in —
git follows the renames — but **new files you added at the old paths will
land at the old paths**; `git mv` them under `backend/`. Agent commands now
run from `backend/`; contract is `npm test --prefix backend/contract`.

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

**Neo** has a third piece, `backend/agent/` (PR #4): a Claude orchestrator that plans
ALS criteria and runs parallel LLM sub-agents that return drug-free *target
profiles* (genes + desired action, pathways, site). These are the anchors
Levi's DRKG agents need, and its SSE stream is a live source for Jeremy's
`PipelineEvent`s. How to combine all three without building a fourth:
[`RESEARCH_AGENT_HANDOFF.md`](RESEARCH_AGENT_HANDOFF.md).

## ⚠ Real DRKG stage 3 disagrees with the hand-written stage 4

Stage 3 now runs on the real TransE vectors (`frontend/scripts/drkg_scene.py`
→ `frontend/public/drkg/`, method in `DECISIONS.md`). Where the hand-written
drugs actually land, ranked within their own profile out of 10,551 compounds:

| Drug | Stage-4 candidate? | Real rank |
|---|---|---|
| Sirolimus | — | **3** |
| Mecasermin | yes | 18 |
| Eculizumab | — | 44 |
| Riluzole | — | 92 |
| Tocilizumab | yes | 124 |
| Sarilumab | — | 364 |
| Anakinra | yes | 402 |
| Ravulizumab | yes | 1,157 |
| Edaravone | — | 3,087 |
| Somatropin | — | 3,368 |
| Tofersen | — | no DRKG compound |

The real top 5s are mostly investigational kinase/AMPA compounds (e.g.
Amuvatinib, Azd-8055, Talampanel). **Jeremy:** stage 4's `CANDIDATES` no longer
follow from stage 3. Either re-pick candidates from the real top lists, or
say on stage that stage 4 is a curated shortlist, not the top of stage 3.
Don't demo both screens as one chain until that's settled.

The 3D picture is a clustered layout (24 k-means islands), **not** distance-
preserving. Never point at two dots and say "these are close"; read the L2
numbers. Islands mostly split by entity type; three are mixed.

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
`frontend/kg-and-provenance`).

The standalone diagnostic suite was integrated from `codex/diagnostic-tests` by joining its original history to main. The additional FaceCheck integration remains on `Master-UI-Neo-Face-Integration`. See issue #18 and the root README for the merge and launcher.
