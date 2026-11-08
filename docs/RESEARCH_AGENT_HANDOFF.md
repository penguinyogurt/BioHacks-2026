# Research agent — handoff for merging the two agent workflows

> **Paths:** since the 2026-11-08 reorg this lives in `backend/`. Paths below
> (`agent/…`, `data/…`) are relative to `backend/`; run commands from there.

From: Neo's session, 2026-11-07 → 11-08. Branch: `agent/research-backend`.
For: whoever merges this with Levi's `backend/query-generation/`
(`agentic-query-generation`) and Jeremy's discovery UI.

The goal: **one discovery engine**. Keep the **main research agent**
(orchestrator) as it is, and combine the **best parts of both** sub-agent
designs. Don't keep two pipelines standing side by side. issue #7
already notes that we have built the same thing twice.

---

## 1. What this branch ships (`agent/`)

A Python backend the frontend can call. The **orchestrator** (Claude Opus
5.5) reads the patient record. It sends parallel **sub-agents** (Claude
Sonnet 5.5, up to 8 at once). Each one researches one ALS criterion using
MCP tools. Results are verified, made free of drug names, and ranked for
the patient.

```
POST /api/research
  └─ load_patient   (patient record; orchestrator only)
  └─ plan           (Opus: picks 3–8 criteria from criteria.py, writes one Brief each, then privacy.sanitize_brief)
  └─ research ×N    (Sonnet sub-agents via LangGraph Send; Brief only + target-level MCP tools)
  └─ verify         (PMIDs/NCTs must exist; drop unsupported profiles; scrub drug names)
  └─ synthesize     (Opus with the record: rank for this patient; add patient-specific required/avoid)
  └─ ResearchReport (SSE "report" event + agent/runs/<id>.jsonl for replay)
```

| File | Role | Keep as-is? |
|---|---|---|
| `graph.py` | The orchestrator: LangGraph StateGraph, plan → fan-out → verify → synthesize | **Yes, this is the main research agent** |
| `criteria.py` | ALS criteria catalog: M1–M18 mechanisms (SOD1, C9orf72, TDP-43, excitotoxicity, neuroinflammation…), S1–S13 symptoms (cramps, spasticity, sialorrhea, PBA, respiratory, weight loss…) | Yes; extend freely |
| `subagent.py` | One LLM research sub-agent per criterion (LangChain `create_agent`, `ProviderStrategy` structured output, tool budget, fallback answer on recursion limit) | **This is the half to merge** |
| `mcp_server.py` | FastMCP stdio server: PubMed, ClinicalTrials.gov, Open Targets (`target_profile`, `opentargets_als_targets`), plus drug-level tools (ChEMBL, FDA label, PubChem, pipeline.json) the sub-agents are *not* given | Yes |
| `schemas.py` | `Brief`, `TargetProfile`, `ReportProfile`, `ResearchReport`, `PatientRecord` | Yes; `ReportProfile` is the hand-off seam |
| `privacy.py` · `no_drugs.py` | The privacy wall and the drug-name scrubber | **Do not weaken** (see §5) |
| `ingest.py` | Chart PDF → `PatientRecord` (pypdf text, scanned PDFs go to Claude as a document) | Yes |
| `api.py` | FastAPI + SSE for the frontend | Yes |
| `llm.py` · `config.py` | The only place Claude clients are built; budgets | Yes |

How to run it, the API table and the event list are in [`backend/agent/README.md`](../backend/agent/README.md).
The original design and the list of data sources are in [`RESEARCH_AGENT_SPEC.md`](RESEARCH_AGENT_SPEC.md).
**Where they disagree, this file and the README are current.** The spec
still describes sub-agents that return drug findings and the old Gemini
setup, both of which changed this session.

### What changed this session

1. **Sub-agents return target profiles, not drugs.** Each one describes what
   an ideal drug should **do** for its criterion:
   - therapeutic goal and mechanism of action
   - `molecular_targets[]`, an HGNC symbol plus `desired_action` (inhibit, antagonize, reduce_expression, …)
   - pathways and site of action
   - required/avoid properties
   - lessons from failed ALS trials, in mechanism terms
   - evidence (PMID/NCT/Ensembl/MONDO)

   **Why:** a separate step turns profiles into specific drugs. If
   sub-agents named drugs, they would bias that step. `no_drugs.py` scrubs
   any name that slips through anyway.
2. **The criteria are ALS-specific** (mechanisms and symptoms), replacing
   the old generic categories.
3. **Gemini → Claude** (Opus 5.5 orchestrator and ingest, Sonnet 5.5
   sub-agents, `reasoning_effort=medium`, server-side refusal fallback).
   This removed the free-tier 429s, so the sub-agent limit went from 3 to 8.
4. **PDF chart parser** (`ingest.py`, `POST /api/patients`) and a fictional
   test chart, `data/patient/samples/jordan_chart.pdf`.

### Verified run (Jordan, synthetic: bulbar onset, SOD1 A4V, CYP2D6 poor metabolizer)

- About **98 s** end to end, down from about 5 min on Gemini.
- 7 criteria planned (M3 SOD1, M10 proteostasis, M8 oxidative stress, S3
  sialorrhea, S5 PBA, S8 weight loss, S12 constipation).
- 25 tool calls, 0 tool errors.
- **15 verified profiles**; 2 evidence items failed verification and were
  dropped; 1 drug mention scrubbed.
- **No drug names in any profile.**
- Top profile: `SOD1: reduce_expression`, intrathecal/CNS-penetrant, with
  patient constraints added by synthesis.

---

## 2. The two sub-agent designs, side by side

| | **This branch (`agent/`)** | **Levi (`backend/query-generation/`)** |
|---|---|---|
| What a sub-agent is | An LLM (Sonnet) with literature/trial/target tools | A deterministic Python function over DRKG, no LLM |
| Split by | ALS criterion (31 in the catalog; orchestrator picks 3–8 per patient) | 5 fixed categories: disease-indications, genes-targets, pathways-processes, safety-interactions-class, symptoms-function |
| Sees the patient? | **No.** Gets a sanitized Brief only | Yes: reads chart quotes (`examples/alex.json` `facts`) |
| Output | Target profiles: *what a drug should do*, no drug names | Ranked **drugs** (DrugBank ids) with TransE distances and graph witnesses |
| Grounding | PubMed/NCT/Open Targets ids, existence-checked | DRKG release (SHA-256 checked), MeSH + Hetionet resolver, frozen entity map |
| Strengths | Reads current literature; reasons about *why* a mechanism helps or failed in trials; covers symptoms; privacy wall | Reproducible; every score has an inspectable path; human-ALS-exposure **trial gate**; real **safety/interaction** check; strict intersection + fallback ranking; deterministic tests |
| Weaknesses | Doesn't produce drugs (by design); LLM cost and latency | Anchors come from the chart only, so it is thin on mechanism (symptoms agent found 0 eligible edges for Alex); no literature reasoning |

They fit together rather than compete. **Ours produces the hypotheses
(which targets, which direction, why). Levi's turns hypotheses into ranked,
gated, safety-checked drugs.** That is also what `DISCOVERY_SPEC.md` §2
asks for: stage 1–2 profiles, stage 3 DRKG embedding, stage 4 ranking.

---

## 3. Recommended merge

### Keep intact

- `agent/graph.py` orchestrator flow (`load_patient → plan → research×N →
  verify → synthesize`), its event stream and `ResearchReport`.
- The privacy wall (§5) and `no_drugs.py` on sub-agent output.

### Combine the sub-agents

Let the LLM sub-agents write the anchors that Levi's DRKG agents currently
derive from chart text.

| Levi agent | Fed by (from our `ReportProfile`) | Mapping |
|---|---|---|
| **genes-targets** | `molecular_targets[].symbol` of every M* profile | HGNC → Entrez → `Gene::<entrez>`. Use `desired_action` to choose the relation: inhibit/antagonize/block/reduce_expression vs. agonize/activate/increase_expression, and keep `TARGET` (`DRUGBANK::target`, `Hetionet::CbG`) as the fallback relation |
| **pathways-processes** | `pathways[]` and the genes above | Resolve pathway text to GO BP through Levi's terms resolver, or skip the text and expand from the genes as he does now |
| **symptoms-function** | S* profiles: `therapeutic_goal`, `site_of_action` | Resolve to MeSH symptom terms. This is where his run had **0** edges for Alex; our S* profiles give it real anchors |
| **disease-indications** | Unchanged (diagnosis → MeSH ALS) | — |
| **safety-interactions-class** | Current meds and chart observations. **Orchestrator side only**; plus our `patient_avoid` / `avoid_properties` as review prompts | Keep Levi's interaction predicates and hard vetoes |

Then keep Levi's **trial gate**, his **strict intersection + fallback
ranking** and his **leader review**. Add one more signal: a drug that
matches several of our profiles beats one that matches one (the
"five profiles give a spread" argument in `DISCOVERY_SPEC.md` §2).
Use each profile's `confidence` and `rank` as weights.

`embedding_text` and `constraints_text` on each profile are there for a
text-embedding matcher (sentence embedding vs. drug mechanism text, e.g.
DrugBank MoA). That is an option *alongside* DRKG, which embeds entities
and has no vector for a sentence.

### Integration through files (repo rule: nobody imports anybody else's code)

```
agent/ (api or cli)            → agent/runs/<run_id>.report.json   (ResearchReport)
backend/query-generation/run.py --research agent/runs/<id>.report.json   (new flag; reads profiles as anchors)
                               → reports/<case>.json               (ranked drugs, as today)
```

`agent/cli.py` already writes `agent/runs/<run_id>.report.json`. Levi's
`run.py` needs one new input flag. Neither package imports the other.

An alternative is to call Levi's `run.py` from a new graph node after
`synthesize`, as a subprocess with file in and file out. That keeps one SSE
stream for the frontend. Either works. The subprocess node is better for
the demo.

### Frontend seam (Jeremy)

`frontend/src/lib/pipeline.ts` replays `PipelineEvent`s on timers. Map our
SSE events onto it:

| Our SSE event | `PipelineEvent` |
|---|---|
| `run_started`, `plan` | `{type:'stage', stage:'analysis', …}` |
| `subagent_started` / `tool_call` / `tool_result` (lane = sub-agent index) | `{type:'step', stage:'profiles', lane, step}` |
| `subagent_finished` / `report.profiles[]` | `{type:'profile', profile}` (our profile has more fields than `DrugProfile`; map down) |
| DRKG step (Levi) | `{type:'matches'}` → `{type:'candidates'}` |
| `run_finished` | `{type:'report'}` |

Recorded runs replay from disk (`GET /api/research/{id}/events?replay_speed=1`).
That gives the demo a real, recorded run with no live API calls at the
expo table.

---

## 3b. After the matcher: drug assessment (`agent/assess.py`)

This is added after the first handoff, and it's the step that comes *after*
Levi's ranking: `DISCOVERY_SPEC.md` stages 4–5 (research, then report).

```
drug list (Levi's report / data/pipeline.json / names)
  → one Sonnet researcher per drug, Claude web search, sees only the drug name → DrugDossier
  → Opus orchestrator with the record + research-run target profiles + dossiers (+ sanitized web follow-ups)
  → DrugReport: ranked, verdict, fit, pros/cons, patient-specific risks, monitoring, sources
```

- **Input:** it reads Levi's `aggregation.final` (or `fallback.final`) and
  `ingredient_names` as they are, so his `run.py` needs **no changes** to
  feed it. The review notes his pipeline attaches go to the orchestrator
  only.
- **CLI:** `python -m agent.assess --patient alex --drugs <file>` writes
  `agent/runs/a<time>.drugs.json` plus the report as `.drugs.pdf`.
- **API:** `POST /api/assess`, with the same SSE/report URLs as research runs; the PDF is at `GET /api/research/{run_id}/report.pdf`.
- **Tested on Levi's saved Alex run** (5 drugs), about 3.5 minutes:
  1. Melatonin: worth discussing.
  2. Memantine: use with caution.
  3. Acetylcysteine: use with caution.
  4. Arimoclomol: not recommended (failed phase 3).
  5. Minocycline: not recommended (harm in phase 3).

  This is roughly the reverse of the DRKG order, because human trial outcomes
  override mechanistic links. The report also names the gaps none of the
  five cover (cramps, weight loss).
- **Privacy is the same wall:** the researchers never see the patient.
  The orchestrator's `web_research` questions have patient identifiers
  removed (`privacy.identifier_terms`). Medication names are kept, because
  interaction checks need them. Cited URLs must come from real search
  results.

## 3c. Verified: coordinated pipeline → assessment → PDF (2026-11-08)

Levi merged the orchestrator into `backend/query-generation/` (PR #20).
Checked on Windows:

- `python -m unittest discover -s tests` passes: **28/28**.
- `run.py --offline --planner claude --medication-check` **reproduces the
  committed snapshot exactly**: same `advanced`, same 19 `discovery_leads`
  and scores, same fallback. Only a link line in `summary.md` differs.

Found while checking (owner: Levi, not changed here):

1. **The offline replay fails on Windows without `PYTHONUTF8=1`.** Files are
   read with `read_text()` and no encoding, so Windows decodes them as cp1252.
   That changes the content hash of the hosted-replay cache key, which fails
   with *"Hosted research replay missing for pathways-processes"*. The `Ã—`
   in `final.json`'s stage list is the same bug. Fix: `encoding="utf-8"` on
   every `read_text`/`open`, or document `PYTHONUTF8=1`.
2. **The replay needs the Sonnet/Haiku model pair.** Pointing `--agent-env`
   at `agent/.env` selects Opus/Sonnet, and no replay exists for that pair.
   Set `CLAUDE_ORCHESTRATOR_MODEL=claude-sonnet-5-5` and
   `CLAUDE_SUBAGENT_MODEL=claude-haiku-5-5` for the replay.
3. **The candidate pool includes endogenous metabolites.**
   - Leads 1, 4, 5, 10 and 16 are creatinine, GABA, acetylcholine, uric acid
     and L-threonine. Creatinine is a lab marker, not a drug.
   - 8 of the 19 leads have no name in DRKG's glossary. `assess.py` resolves
     them through PubChem.
4. **Methylcobalamin (lead 3) is marked "unverified in bounded cache".** It
   has a positive phase 3 trial (JETALS, NCT03548311) and is approved in
   Japan. The trial cache is missing it.
5. **Genes/targets and pathways contribute 0 supported candidates** for Alex
   ("graph-only supported counts": 29 / 0 / 1 / 0 / 5). The target-profile
   half of the design isn't reaching the ranking yet.

**Integration:** `assess.load_drugs` reads the coordinated report directly
(`reports/<case>-coordinated.json`). It takes, in order:
1. `advanced`
2. `reassessments` with unresolved human evidence (established comparators excluded)
3. `discovery_leads`

The pipeline holds every lead at *"unresolved patient safety"*. Resolving
that per patient is what this step does.

```bash
python -m agent.assess --patient alex --drugs backend/query-generation/reports/alex-coordinated.json --max 25
```

**Alex run:**
- 21 drugs, about 4.5 minutes, 56 researcher web searches plus 3 follow-ups, 0 dropped citations.
- Output is `agent/runs/a20261108-012417.drugs.pdf`, 22 pages. Each drug section names its pipeline origin ("discovery lead #3 · unresolved patient safety").
- Top of the ranking:
  1. Methylcobalamin: strong candidate. JETALS was positive, but Alex is about 13 months from onset, it's injection-only, and it's not available in Canada.
  2. Melatonin and levetiracetam: worth discussing, for sleep and cramps.
  3. Calciferol: worth discussing.
- The report names creatinine, GABA, acetylcholine and uric acid as "not usable drugs". It flags quinidine and dextromethorphan for QT/CYP2D6 risk in this patient.

## 4. Running it

```bash
python -m venv agent/.venv
agent/.venv/Scripts/python -m pip install -r agent/requirements.txt
cp agent/.env.example agent/.env      # ANTHROPIC_API_KEY, LANGSMITH_API_KEY, optional NCBI_API_KEY
agent/.venv/Scripts/python -m agent.api                    # :8001
agent/.venv/Scripts/python -m agent.cli --patient jordan   # one run in the terminal
agent/.venv/Scripts/python -m unittest agent.test_privacy  # no key needed
```

- On Windows, run `python -m agent.api`, **not** `uvicorn --reload`.
  Reload mode can't spawn the stdio MCP subprocesses.
- Every LLM call and tool call is traced to the LangSmith project
  `biohacks-als-research`. Filter by `metadata.run_id`.
- `NCBI_API_KEY` raises PubMed from 3 to 10 requests/s. It's worth having with 8 parallel sub-agents.
- Cost: one run is roughly 7–8 Sonnet sub-agents plus 2 Opus calls. Use
  replayed runs for rehearsals.

---

## 5. Don't break these

- **Sub-agents never see the patient.** The `Brief` has no patient field;
  sub-agents get only `SUBAGENT_TOOLS` (no patient or drug tools); and
  `sanitize_brief` redacts names, ids, meds, dates, labs and contact
  details. `test_privacy.py` checks all three. If Levi's chart-reading code
  moves in, it runs in the **orchestrator** process, never inside a sub-agent
  brief.
- **No drug names come out of sub-agents.** Drugs are the matcher's output,
  not the researcher's.
- **Patient data stays synthetic** (Alex, Jordan). Real PHI must not go to
  any LLM API without a BAA. Set `LANGSMITH_HIDE_INPUTS=true` for anything
  that isn't synthetic: the orchestrator's traces contain the record.
- **Schemas:** no `X | None` fields in anything passed to structured output.
  Claude's output grammar overflows, causing a 400. Use `""` / `-1` defaults.
  Forced `tool_choice` also returns a 400 on Opus/Sonnet 5.5, which is why it's
  `ProviderStrategy`.

## 6. Open items

- [ ] `--research` input on `backend/query-generation/run.py` (or the
  subprocess node), plus the HGNC → Entrez mapping for `Gene::` ids.
- [ ] Map `desired_action` → DRKG relation set (GNBR has typed
  compound–gene relations: inhibition, agonism, antagonism…).
- [ ] Frontend: swap `runDemoPipeline`'s timer for our SSE, keeping the
  `PipelineEvent` shape.
- [ ] Bring `RESEARCH_AGENT_SPEC.md` up to date with this file, or delete the parts that are now wrong.
- [ ] Ingest takes ~45 s on Opus; `CLAUDE_INGEST_MODEL=claude-sonnet-5-5` is faster if needed.
