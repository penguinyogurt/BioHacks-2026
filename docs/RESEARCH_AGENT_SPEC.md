# Research Agent — engineering spec

> **Paths:** since the 2026-11-08 reorg this lives in `backend/`. Paths below
> (`agent/…`, `data/…`) are relative to `backend/`; run commands from there.

A main research agent (the orchestrator) reads the patient's record and
decides which questions are worth asking. It then sends a set of smaller
sub-agents to research specific angles: lifespan, pain, a body region, BBB
penetration, and so on. Each sub-agent has a narrow set of tools that query
drug, knowledge-graph, trial and literature sources. The frontend calls the
agent, and progress streams back live. The agents run on Gemini, and
LangChain/LangSmith traces every call.

Soft deadline: **Sun 2026-11-08 09:00** (see `AGENTS.md`).

---

## 0. Decisions this forces (team must agree)

1. **We now have a backend.** `AGENTS.md` says "static site, no backend".
   An LLM agent with API keys can't run in the browser. The FastAPI server
   on `cursor/pipeline-graph-ui` (`server/main.py`) becomes the host, with a
   new `/api/research` route. Update `AGENTS.md` once agreed.
2. **New contract, separate from `pipeline.json`.** The agent emits
   `ResearchReport` (§6) through its own zod schema,
   `app/src/lib/agentContract.ts`. `pipeline.json` stays frozen.
3. **The architecture rule still holds.** The agent never imports
   `kg_rank.py`, `patient_filter.py` and the rest. It reads their output
   JSON in `data/`, or calls the server's HTTP endpoints (e.g.
   `/api/predict` for BBB).
4. **Deterministic rules beat the LLM.** If `patient_filter` eliminated a
   drug, no sub-agent can bring it back. The agent can only *explain* the
   decision and *add* candidates, which then go through the same rules.
5. **The demo must survive bad Wi-Fi.** Every run gets recorded. A
   committed golden run (`data/research_run.sample.json`) replays in the UI
   with no network, using the same "guided run" idea as the funnel.

---

## 1. Architecture

```
app (React)
  │  POST /api/research {patient_id, question?, criteria?}   → returns run_id
  │  GET  /api/research/{run_id}/events   (SSE stream)
  ▼
server/main.py (FastAPI)
  └─ agent/graph.py  (LangGraph StateGraph)
        ┌──────────────────────────────────────────────────────────┐
        │ 1. load_patient   → tools: patient MCP (profile/labs/trials) │
        │ 2. plan           → orchestrator LLM picks criteria (§3)    │
        │ 3. fan_out        → Send() one sub-agent per criterion (‖)   │
        │ 4. sub-agents     → each: create_agent(flash, tools[k], schema)│
        │ 5. verify         → resolve IDs, check citations exist      │
        │ 6. safety_gate    → deterministic patient_filter rules     │
        │ 7. synthesize     → orchestrator ranks + writes report      │
        └──────────────────────────────────────────────────────────┘
        tools come from MCP servers via langchain-mcp-adapters:
          local:    als-patient · als-pipeline · als-kg   (FastMCP, ours)
          external: BioMCP or medical-mcps (trials, PubMed, ChEMBL, Open Targets)
        tracing: LangSmith (LANGSMITH_TRACING=true, LANGSMITH_API_KEY, LANGSMITH_PROJECT)
```

### Stack

| Layer | Choice | Why |
|---|---|---|
| Orchestration | **LangGraph** `StateGraph` + `Send` for parallel fan-out | Explicit graph = predictable demo; native LangSmith tracing |
| Sub-agents | LangChain `create_agent` (tool-calling loop) with structured output | One line per sub-agent; Pydantic schema enforces shape |
| LLM | `langchain-google-genai` `ChatGoogleGenerativeAI` | Gemini, as decided |
| MCP | `langchain-mcp-adapters` `MultiServerMCPClient` | Loads MCP tools as LangChain tools |
| Our MCP servers | `FastMCP` (python `mcp` SDK) | ~20 lines per tool |
| API | FastAPI + `sse-starlette` | Already the server we have |

`langgraph-supervisor` exists too, but a hand-written graph with `Send` gives
explicit control over concurrency and budgets, which matters more than
convenience here.

### Models (set in env, never hard-coded)

```
GEMINI_ORCHESTRATOR_MODEL=gemini-3.1-pro-preview   # planning + synthesis
GEMINI_SUBAGENT_MODEL=gemini-3-flash-preview       # many parallel cheap calls
```

These were the IDs on the official models table when this was written, but
preview IDs get retired (`gemini-3-pro-preview` already has). Check
<https://ai.google.dev/gemini-api/docs/models> before the demo.

### Budgets (stop runaway runs and rate-limit errors)

- at most **8 sub-agents** per run, **4 at once**
- at most **8 tool calls** per sub-agent, **45 s** timeout per sub-agent
- whole run times out at **150 s**; return partial results marked `partial: true`
- every external tool response is cached on disk by (tool, args) hash in
  `agent/cache/`. Warm the cache before the expo.

---

## 2. Patient data the orchestrator can read

"Alex" is synthetic. **Do not put real PHI into the Gemini API.** Real
patients would need Vertex AI with a BAA, which is out of scope.

| Source | File (new unless noted) | Contents |
|---|---|---|
| Profile | `data/pipeline.json` → `patient_profile` (exists) | Demographics, diagnosis, onset site, current meds, vulnerabilities, routes |
| Labs / tests | `data/patient/labs.json` | eGFR/creatinine, ALT/AST, CK, NfL, FVC %, ALSFRS-R (total + bulbar/fine/gross/resp subscores), weight trend, genetics (SOD1, C9orf72, FUS, TARDBP, ATXN2), CYP2D6/CYP1A2 phenotype |
| Trials | `data/patient/trials.json` | Trials enrolled, screened out (with reason), completed; NCT IDs |
| Digital measures | `data/patient/digital.json` | FaceCheck summary (`facecheck.session.v3`), speech severity output |
| Symptoms | `data/patient/symptoms.json` | Active symptom list with severity: pain, cramps, sialorrhea, PBA, insomnia, spasticity, … |

**Symptoms and genetics drive the planner.** Sub-agents spawn only for
criteria the record makes relevant (§3). That gives a different patient a
visibly different run, which is the Stage-4 argument again.

---

## 3. Criteria the sub-agents can target

Each row is a sub-agent type. **Trigger** is the record condition under which
the planner spawns it. **Ground truth** lists known answers the agent should
find, and doubles as our eval set (§7).

### A. Disease-modifying / survival

| # | Criterion | Trigger | What it researches | Ground truth to recover |
|---|---|---|---|---|
| A1 | Extend survival / slow progression | always | Drugs with survival or ALSFRS-R slope evidence | riluzole, edaravone |
| A2 | Genetic subtype | variant in record | Gene-specific therapies | tofersen (SOD1) |
| A3 | Glutamate excitotoxicity | always (cheap) | Glutamate release/uptake modulators, EAAT2 | riluzole; ceftriaxone (failed P3, graveyard) |
| A4 | Oxidative stress | planner choice | Free-radical scavengers, NRF2 | edaravone |
| A5 | TDP-43 proteinopathy / cryptic exons (STMN2, UNC13A) | planner choice | Aggregation, nuclear import, splicing | mostly preclinical, flag as such |
| A6 | Neuroinflammation (microglia, astrocytes) | planner choice | Immunomodulators | masitinib (contested), ibudilast |
| A7 | Mitochondrial / energy metabolism | weight loss, hypermetabolism | Bioenergetics | sodium phenylbutyrate-taurursodiol (withdrawn after P3 fail, graveyard) |
| A8 | Proteostasis / autophagy | planner choice | Autophagy inducers, HSP modulators | arimoclomol (failed) |
| A9 | Axonal transport / NMJ stability | planner choice | Cytoskeleton, NMJ agrin/MuSK | |
| A10 | Biomarker-moving (NfL) | NfL in labs | Drugs with an NfL-reduction signal | tofersen |

### B. Symptom relief (spawned per active symptom)

| # | Symptom | Ground truth |
|---|---|---|
| B1 | Pain (musculoskeletal, neuropathic, contracture) | NSAIDs/acetaminophen, gabapentinoids; opioids late with respiratory caution |
| B2 | Muscle cramps | mexiletine; quinine **not** recommended (safety) |
| B3 | Spasticity | baclofen, tizanidine |
| B4 | Sialorrhea | glycopyrrolate, amitriptyline, botulinum toxin |
| B5 | Thick secretions | guaifenesin, nebulised saline |
| B6 | Pseudobulbar affect | dextromethorphan/quinidine |
| B7 | Depression / anxiety | SSRIs, mirtazapine |
| B8 | Insomnia | mirtazapine (note respiratory risk for sedatives) |
| B9 | Fatigue | modafinil (weak evidence) |
| B10 | Dyspnea / air hunger | low-dose opioids, benzodiazepines (palliative context) |
| B11 | Constipation | standard laxatives |
| B12 | Weight loss / hypermetabolism | high-calorie nutrition (non-drug, still report it) |
| B13 | Cognitive / behavioural (ALS-FTD) | very limited options; say so |

### C. Body region / tissue targeting

| # | Target | Note |
|---|---|---|
| C1 | Brain, upper motor neuron (motor cortex) | Needs BBB penetration, so pairs with D1 |
| C2 | Spinal cord, lower motor neuron | BBB/BSCB; intrathecal route (tofersen precedent) |
| C3 | Peripheral nerve / NMJ | **Doesn't need BBB.** An under-explored angle, and a good story |
| C4 | Skeletal muscle | e.g. fast skeletal troponin activators (tirasemtiv/reldesemtiv failed, graveyard) |
| C5 | Respiratory / diaphragm | FVC decline in record |
| C6 | Bulbar (tongue, lips, swallowing) | FaceCheck/speech signal in record |

### D. Delivery and pharmacology

| # | Criterion | Note |
|---|---|---|
| D1 | BBB penetration | `bbb_scores.json` + `/api/predict`; P-gp efflux; never show prob when `in_domain=false` |
| D2 | Route usability | Dysphagia → liquid / ODT / PEG-crushable / transdermal / SC (riluzole oral suspension precedent) |
| D3 | Dosing burden, half-life, titration | |
| D4 | Pharmacogenomics | CYP2D6 (dextromethorphan), CYP1A2 (riluzole) |

### E. Safety (the auditor runs on every proposed drug, not as an option)

Drug–drug interactions with current meds · renal/hepatic dose adjustment ·
respiratory depression · QT prolongation · anticholinergic burden ·
hepatotoxicity monitoring · fall risk / sedation. **Safety uses the
deterministic rules first** (`check_patient_filter`), and the LLM only writes
the explanation.

### F. Evidence and trials

| # | Criterion | Note |
|---|---|---|
| F1 | Already tried and failed? | `graveyard.json`; `never_arrived` vs `arrived_failed` |
| F2 | Recruiting trials Alex may be eligible for | ClinicalTrials.gov v2; LLM reads eligibility text vs record; output "possibly eligible", never "eligible" |
| F3 | Human-genetics support for the target | Open Targets genetic association score, GWAS/Mendelian randomisation |
| F4 | Preclinical-only evidence | Flag the SOD1-G93A mouse translation gap explicitly |
| F5 | Expanded access / compassionate use | |

### G. Practical access

Approval status (FDA/EMA) · generic available · off-label feasibility · cost
tier.

---

## 4. Data sources

**Bold** = recommended for the hackathon. Licence notes matter, since some of
these can't be redistributed.

### Knowledge graphs

| Source | What | Access | Use for |
|---|---|---|---|
| **DRKG** | Drug repurposing KG (Amazon/DGL), ~97k entities, ~5.9M edges, includes COVID-era repurposing work | Bulk TSV + pretrained embeddings | Already used (`src/drkg.py`). Paths drug→ALS; embedding similarity |
| **PrimeKG** | Harvard Zitnik lab, 129,375 nodes / 4,050,249 edges, 17,080 diseases; strong **drug–disease indication, contraindication and off-label** edges | Harvard Dataverse CSV | Contraindications (E), off-label (G), disease-similarity paths. Fills DRKG's thin drug–disease layer |
| Hetionet | 47k nodes, 2.25M edges, CC0 | Neo4j dump / public browser | Lightweight sanity paths |
| SPOKE | UCSF, very large | API (request access) | Probably too slow to get access before Sunday |
| ROBOKOP | NCATS Translator KG | Public TRAPI API | Optional cross-check |
| **Open Targets Platform** | Target–disease association scores, known drugs, genetics, safety | Free GraphQL API | A1–A10, F3, "known drugs for ALS" |

### Drugs and chemistry

| Source | Access | Use for |
|---|---|---|
| **ChEMBL** | Free REST | Mechanism of action, targets, bioactivity, max phase |
| DrugBank | Academic licence; no free API; CC0 vocabulary only | Rich DDI data, but licensing makes it a stretch goal |
| **DrugCentral** | Open, Postgres dump + web | Approved drugs, MoA, indications; good open DrugBank substitute |
| **PubChem PUG-REST** | Free REST | Name→CID→SMILES/InChIKey, TPSA/logP/MW for BBB |
| DGIdb | Free GraphQL | Gene→drug interactions |
| IUPHAR/BPS Guide to Pharmacology | Free | Curated target pharmacology |
| BindingDB | Free download | Affinity data |
| **openFDA** | Free REST (key optional) | Drug labels (boxed warnings, renal dosing), FAERS adverse events |
| DailyMed | Free REST | SPL labels, formulations (liquid/ODT for D2) |
| RxNorm (RxNav) | Free REST | Name normalisation. **NLM retired its drug-interaction API in 2024**, so use labels + our rules for DDI |
| SIDER / OFFSIDES / TWOSIDES (nSIDES) | Download | Side effects, two-drug side-effect signals |

### Biology and targets

UniProt · STRING (PPI) · Reactome · Gene Ontology · **GTEx / Human Protein
Atlas** (is the target expressed in spinal cord / motor cortex? Supports C1–C2)
· ClinVar · GWAS Catalog · LINCS L1000 / CMap (signature-reversal
repurposing; stretch) · KEGG (licence-restricted, avoid) · DisGeNET (now
requires an account/licence, so check first).

### ALS-specific

| Source | Access | Use for |
|---|---|---|
| **ALSoD** | Free web | ALS gene/variant catalogue (A2) |
| PRO-ACT | Registration | Pooled historical ALS trial data, progression rates |
| Answer ALS | Data portal, registration | iPSC motor-neuron multi-omics |
| Target ALS | Data/biorepository access | Biomarkers |
| Project MinE | Controlled access | ALS WGS genetics |

Anything needing registration should be **requested tonight** and treated as
"won't arrive in time" unless it does.

### Literature and trials

| Source | Access | Use for |
|---|---|---|
| **ClinicalTrials.gov API v2** | Free REST | F1, F2 |
| **PubMed E-utilities** | Free (key raises rate limit) | Citations for every claim |
| **PubTator3** | Free | Entity-tagged abstracts (drug/gene/disease) |
| Europe PMC REST | Free | Full-text open access, preprints |
| Semantic Scholar | Free API key | Citation counts, recency |
| WHO ICTRP | Web | Non-US trials |

### BBB

**B3DB** · MoleculeNet BBBP (already in `data/external_bbbp.json`) · our model
via `/api/predict`.

---

## 5. Tools (MCP)

### Existing MCP servers (community-maintained, so pin versions and test)

- **BioMCP** (genomoncology): one binary covering trials (CT.gov v2),
  PubMed/articles, variants, ChEMBL, Open Targets and more.
- **medical-mcps** (PyPI): separate Streamable-HTTP endpoints for Open
  Targets, ChEMBL, ClinicalTrials.gov and PubMed/PubTator3, plus a unified
  endpoint.

**Recommendation:** use one of these for external sources. Build our own
three local servers for everything patient- or pipeline-specific, so patient
data and our KG never depend on a third party. If an external server is
flaky, P2 wraps the same REST APIs directly in our own FastMCP server. Each
wrapper is about 15 lines.

### Our MCP servers

**`als-patient`** (local, reads `data/patient/*`, `patient_profile`), for the
orchestrator only:
```
get_patient_profile() -> Profile
get_labs(kind: str | None = None) -> list[Lab]
get_medications() -> list[Med]
get_symptoms() -> list[Symptom]
get_patient_trials() -> list[TrialHistory]
get_digital_measures() -> DigitalSummary          # FaceCheck + speech
```

**`als-pipeline`** (reads `data/*.json`, calls server HTTP), for all agents:
```
get_candidates(verdict=None, eliminated_at=None, limit=20)
get_candidate(inchikey)                           # kg, bbb, filters[] verbatim
check_patient_filter(drug_name | inchikey)        # deterministic stage-4 rules → filters[]
predict_bbb(smiles)                               # → POST /api/predict
get_graveyard_entry(drug)                         # never_arrived | arrived_failed
resolve_drug(name) -> {inchikey, chembl_id, smiles, pubchem_cid}  # via PubChem/ChEMBL
```

`check_patient_filter` for a drug *not* already in `patient_filter.json`
needs the stage-4 logic callable. Under the architecture rule, the clean way
is for `patient_filter.py`'s owner to expose `POST /api/patient_filter` on
the server. Agree this with them.

**`als-kg`** (DRKG + PrimeKG, loaded once into memory or SQLite):
```
kg_paths(drug, disease="ALS", max_hops=3, limit=5)
kg_neighbors(entity, relation=None, limit=25)
kg_drugs_for_target(gene_symbol)
kg_targets_for_drug(drug)
kg_contraindications(drug)                        # PrimeKG
kg_off_label(drug)                                # PrimeKG
```

### External tools (via BioMCP/medical-mcps or our wrappers)

```
trials_search(condition="ALS", intervention=None, status="RECRUITING", phase=None)
trials_get(nct_id)                                # eligibility text for F2
pubmed_search(query, max=10) / pubmed_fetch(pmid)
pubtator_annotate(pmid)
chembl_mechanism(drug) / chembl_target_drugs(target)
opentargets_disease_targets(disease_id, limit)
opentargets_known_drugs(disease_id)
opentargets_target_safety(target)
openfda_label(drug)                               # boxed warning, renal/hepatic dosing, forms
openfda_faers(drug, reaction=None)
dailymed_forms(drug)                              # liquid/ODT/transdermal for D2
gtex_expression(gene, tissues=["Brain - Cortex","Spinal cord (cervical c-1)"])
dgidb_interactions(gene)
```

### Toolsets per sub-agent (narrow = faster, cheaper, fewer bad calls)

| Sub-agent | Tools |
|---|---|
| A* mechanism / survival | `kg_*`, `opentargets_*`, `chembl_*`, `pubmed_*`, `resolve_drug` |
| B* symptom | `openfda_label`, `pubmed_*`, `chembl_mechanism`, `resolve_drug` |
| C* region | `gtex_expression`, `kg_targets_for_drug`, `predict_bbb`, `pubmed_*` |
| D* delivery | `predict_bbb`, `get_candidate`, `dailymed_forms`, `openfda_label` |
| E safety auditor | `check_patient_filter`, `openfda_label`, `kg_contraindications` |
| F* evidence/trials | `trials_*`, `get_graveyard_entry`, `pubmed_*` |

---

## 6. Contracts

### Sub-agent output (Pydantic, enforced by `with_structured_output`)

```python
class Evidence(BaseModel):
    source: Literal["pubmed","clinicaltrials","chembl","opentargets","openfda","drkg","primekg","pipeline"]
    id: str            # PMID / NCT / CHEMBL id / edge id
    url: str
    claim: str         # one sentence this source supports

class DrugFinding(BaseModel):
    drug: str
    inchikey: str | None
    criterion: str     # e.g. "B2 muscle cramps"
    mechanism: str
    rationale: str
    evidence: list[Evidence]           # ≥1 required, otherwise the finding is dropped
    evidence_level: Literal["approved_for_als","rct","observational","preclinical","kg_only"]
    confidence: float  # 0–1, self-reported, shown with the label "model estimate"

class SubagentResult(BaseModel):
    criterion: str
    findings: list[DrugFinding]
    dead_ends: list[str]               # what it looked for and didn't find (honesty)
```

### Verify step (deterministic, after sub-agents)

- Every `Evidence.id` is resolved: the PMID exists, the NCT exists, the
  ChEMBL ID exists. Evidence that doesn't resolve is dropped. A finding left
  with no evidence is dropped.
- `drug` → `resolve_drug` → InChIKey. Join with `pipeline.json` candidates,
  so the UI can say "also in funnel, survived / eliminated at stage N".
- `check_patient_filter` runs on every drug. Its `filters[]` reasons are
  carried **verbatim** (same rule as the funnel).

### `ResearchReport` (what the frontend gets; zod in `agentContract.ts`)

```jsonc
{
  "run_id": "r_2026-11-08T03:12:00Z_ab12",
  "patient_id": "alex",
  "partial": false,
  "models": { "orchestrator": "gemini-3.1-pro-preview", "subagent": "gemini-3-flash-preview" },
  "trace_url": "https://smith.langchain.com/...",
  "plan": [{ "criterion": "B2 muscle cramps", "why": "cramps severity 3/5 in symptoms.json" }],
  "findings": [{
    "drug": "mexiletine", "inchikey": "…", "criterion": "B2 muscle cramps",
    "evidence_level": "rct", "confidence": 0.8,
    "rationale": "…", "evidence": [{ "source": "pubmed", "id": "…", "url": "…", "claim": "…" }],
    "patient_safety": { "status": "pass|fail|caution", "filters": [/* verbatim from rules */] },
    "pipeline": { "in_pipeline": true, "verdict": "survived", "eliminated_at": null }
  }],
  "dead_ends": ["A5 TDP-43: only preclinical compounds found"],
  "warnings": ["Research aid, not medical advice."]
}
```

### SSE events (`/api/research/{run_id}/events`)

`run_started` → `patient_loaded` → `plan` → (`subagent_started` →
`tool_call` → `tool_result` → `subagent_finished`)* → `verify` →
`safety_gate` → `report` → `run_finished` | `error`

Each event is `{type, t_ms, subagent?, data}`. The UI renders the sub-agents
as parallel lanes that fill as tool calls stream in. **That live view is the
demo moment.** Recording these events to a file is how the golden replay
works.

---

## 7. Evaluation (the one runnable check)

`agent/eval.py` with a fixed patient fixture: SOD1 variant, cramps,
sialorrhea, spasticity, PBA, mild dysphagia.

Assertions:
- **Recall of known answers:** riluzole, edaravone, tofersen (A2), mexiletine
  (B2), glycopyrrolate (B4), baclofen (B3), dextromethorphan/quinidine (B6)
  all appear.
- **Graveyard respected:** ceftriaxone and sodium phenylbutyrate-taurursodiol
  never appear as recommendations without the graveyard flag.
- **Safety respected:** no finding with `patient_safety.status="fail"` is
  ranked above a passing one.
- **Citations real:** 100% of rendered evidence IDs resolve.

Report the recall % in the pitch: "the agent independently recovers 7/7
standard-of-care drugs for this profile". That number makes everything else
it says believable.

---

## 8. Repo layout

```
agent/
  graph.py              LangGraph orchestrator (plan → fan-out → verify → gate → synth)
  subagents.py          registry: criterion → (prompt, toolset, trigger)
  prompts/              one .md per sub-agent type
  schemas.py            Pydantic models in §6
  mcp_servers/
    patient_server.py   als-patient
    pipeline_server.py  als-pipeline
    kg_server.py        als-kg
  mcp_config.py         MultiServerMCPClient config (local + external)
  cache/                tool-response cache (gitignored, warmed before expo)
  eval.py               §7
server/main.py          + POST /api/research, GET /api/research/{id}/events
data/patient/           labs.json, trials.json, digital.json, symptoms.json
data/research_run.sample.json   golden replay (committed)
app/src/lib/agentContract.ts    zod for ResearchReport + events
app/src/components/ResearchPanel.tsx
```

Env (`.env`, gitignored): `GOOGLE_API_KEY`, `GEMINI_ORCHESTRATOR_MODEL`,
`GEMINI_SUBAGENT_MODEL`, `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`,
`LANGSMITH_PROJECT`, `NCBI_API_KEY` (optional), `OPENFDA_API_KEY` (optional).

---

## 9. Work split: 4 people

| Person | Owns | Deliverables |
|---|---|---|
| **P1 — Orchestrator & backend** | `agent/graph.py`, `schemas.py`, `server/main.py` routes | LangGraph graph, `Send` fan-out with budgets, verify + safety gate nodes, SSE endpoint, LangSmith wiring (Gemini via `ChatGoogleGenerativeAI`), event recorder for the golden run |
| **P2 — Tools & data** | `agent/mcp_servers/*`, `mcp_config.py`, `data/patient/*` | Three local FastMCP servers; pick + pin BioMCP or medical-mcps and smoke-test each tool; PrimeKG download + loader next to DRKG; disk cache; write the synthetic patient record |
| **P3 — Sub-agents, criteria & eval** | `subagents.py`, `prompts/`, `eval.py` | Prompts + triggers for §3 (start with A1, A2, B1–B4, B6, D1, E, F1, F2); toolset per agent; eval fixture + assertions; source research on the §4 databases (licences, IDs, ALS disease IDs in Open Targets/MONDO) |
| **P4 — Frontend** | `agentContract.ts`, `ResearchPanel.tsx` | "Ask the research agent" control; live parallel lanes from SSE; findings cards (evidence links, verbatim safety reasons, pipeline cross-ref); replay from `research_run.sample.json` when offline; follows the `CLAUDE.md` design skills |

**First hour interfaces:** P1 and P4 freeze the `ResearchReport` and event
shapes. P2 and P3 freeze tool names and signatures (§5). After that,
everyone works against stubs. P1 can run the graph with fake tools, and P4
can build against a hand-written sample report.

### Timeline (from Sat late evening)

| When | Milestone |
|---|---|
| T+0:30 | Contracts frozen (§6 shapes, §5 tool names); register for any gated data now |
| T+2:00 | Graph runs end-to-end with 1 sub-agent + stub tools; patient MCP real; UI renders sample report |
| T+4:00 | 4–6 real sub-agents; external MCP working; SSE live in UI |
| T+6:00 | Verify + safety gate; eval passing ≥5/7; **record golden run** |
| T+8:00 | Feature freeze. Cache warmed, offline replay tested on the demo laptop |
| **Sun 09:00** | Code freeze. Pitch only |

### Cut lines (drop from the top)

1. PrimeKG (DRKG alone is fine)
2. Trial eligibility matching (F2). Keep plain trial search
3. Region / tissue agents (C*) except C3 peripheral
4. Live SSE lanes (show the final report only)
5. **Never cut:** citation verification, deterministic safety gate,
   golden-run replay, eval recall number

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Hallucinated drugs or citations | Verify step drops anything unresolvable; evidence required |
| LLM "rescues" a drug the rules eliminated | Safety gate is code, runs last, overrides |
| Gemini rate limits / preview model retired | Concurrency cap 4; model IDs in env; cached golden run |
| Expo Wi-Fi | Disk cache + replay file; health check shows "offline replay" honestly |
| Slow runs (60–150 s) | Stream progress; the planner can be told to pick at most N criteria |
| Medical-advice framing | Fixed warning in every report; "possibly eligible", "model estimate" wording |
| Community MCP server breaks | Pin versions; fall back to our own REST wrappers |
