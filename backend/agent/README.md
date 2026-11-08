# Research agent backend

> **Paths:** since the 2026-11-08 reorg this lives in `backend/`. Paths below
> (`agent/…`, `data/…`) are relative to `backend/`; run commands from there.

The orchestrator (Claude Opus 5.5) reads the patient record and picks the ALS
criteria that matter for this patient: disease mechanisms (`M*`) and
symptoms (`S*`, see `criteria.py`). It sends one parallel sub-agent (Claude
Sonnet 5.5) per criterion. **Sub-agents don't pick drugs.** Each one returns
1–3 **target profiles** describing what an ideal drug would do:
- therapeutic goal and mechanism of action
- molecular targets with the desired action (`SOD1: reduce_expression`, `CHRM3: antagonize`)
- pathways and site of action
- required and avoided properties
- lessons from failed ALS trials, and evidence

A separate step embeds the profiles and matches real drugs against them.

```
POST /api/research ─► load_patient ─► plan ──Send()──► research (sub-agent) ×N, ≤8 at once
                         (record)     (record,          (brief only + target-level MCP tools)
                                       writes briefs,             │
                                       sanitizes them)            ▼
                                       verify: PMIDs/NCTs must exist, drug names scrubbed
                                                                  ▼
                                       synthesize (record): rank for this patient, add patient constraints
                                                                  ▼
                                               ResearchReport ─► SSE "report" event
```

A run with 7 sub-agents takes about 100 seconds.

## Drug assessment (`assess.py`): the last step

After the drug pipeline (Levi's DRKG matcher or `data/pipeline.json`) has
named drugs, this step turns them into a ranked report for the patient:

```
POST /api/assess ─► load (record + drug list + latest research run's target profiles)
                    ─Send()─► researcher ×N, one per drug: Sonnet + Claude web search, sees ONE DRUG NAME only
                              → DrugDossier (mechanism, ALS trials, side effects, CYP/interactions, formulations, availability, cost)
                    ─► assess: Opus with the record + profiles + dossiers; may ask `web_research` follow-ups
                              (patient identifiers are stripped from the question first)
                    ─► DrugReport: drugs ranked with verdict, fit, pros, cons, patient-specific risks, monitoring, sources
```

```bash
agent/.venv/Scripts/python -m agent.assess --patient alex --drugs path/to/drugs.json [--research <run_id>]
# → agent/runs/a<time>.drugs.json (data) + .drugs.pdf (the report)
```

The input can be the coordinated `backend/query-generation/reports/<case>-coordinated.json`
(advanced drugs, unresolved tested drugs, then its discovery leads; unnamed DrugBank ids are
named via PubChem), an older query-generation report, `data/pipeline.json`
(the drugs that survived), `{"drugs": [...]}`, or a plain list of names. Over the API:
`POST /api/assess {"patient_id": "alex", "drugs_path": "data/pipeline.json"}` or
`{"drugs": ["memantine", "riluzole"]}`, then the same events/report URLs as research runs, plus
`GET /api/research/{run_id}/report.pdf` for the PDF.

Cited URLs must have come back from a real search; any others are dropped
and counted in `report.web.dropped_urls`. Searches use Claude's
`web_search` server tool, not Google, and need web search enabled for the
API key's organization.

## Setup (once)

```bash
python -m venv agent/.venv
agent/.venv/Scripts/python -m pip install -r agent/requirements.txt   # macOS/Linux: agent/.venv/bin/python
cp agent/.env.example agent/.env    # then fill in ANTHROPIC_API_KEY and LANGSMITH_API_KEY
```

## Patient charts (PDF → record)

```bash
agent/.venv/Scripts/python -m agent.ingest chart.pdf --id jordan   # → data/patient/jordan.json
```

`ingest.py` takes text with `pypdf` and has Claude structure it into a
`PatientRecord` (`schemas.py`). A scanned PDF with no text layer goes to
Claude as a PDF document instead, so no OCR install is needed. The
`identifiers` section feeds the privacy redaction, so a parse that finds no
patient name fails rather than saving. A synthetic test chart is in
`data/patient/samples/jordan_chart.pdf` (regenerate it with
`python -m agent.make_sample_chart`).

## Run (from the repo root)

```bash
agent/.venv/Scripts/python -m agent.api                       # API on http://127.0.0.1:8001
agent/.venv/Scripts/python -m agent.cli --patient jordan      # one run in the terminal
agent/.venv/Scripts/python -m unittest agent.test_privacy     # privacy wall + drug-name scrub, no key needed
```

On Windows, don't run it with `uvicorn --reload`. Reload mode switches to an
event loop that can't spawn the MCP subprocesses.

## API (for the frontend)

| Method | Path | Returns |
|---|---|---|
| POST | `/api/patients` multipart `file` (PDF), `patient_id`, `synthetic`? | `{patient_id, method, counts}` (section counts only, no contents) |
| GET | `/api/patients` | patient ids |
| POST | `/api/research` body `{"question"?: string, "patient_id"?: string}` | `{run_id, events_url, report_url}` |
| GET | `/api/research/{run_id}/events` | SSE stream: all past events, then live. Recorded runs replay from `agent/runs/`; `?replay_speed=1` keeps original timing |
| GET | `/api/research/{run_id}` | `{status, report, error}` |
| POST | `/api/drkg` body `{"research_run_id": string, "profiles"?: [{lane, name, criterion, targets}]}` (profiles from the research run's `verify` event let it start before synthesis) | `{run_id, events_url, report_url, scene_url}`. Stage 3: the run's target genes → DRKG matches (`drkg.py`, no LLM, ~2 s). Report: `{drugs, drugs_path, scene_url}`; pass `drugs_path` to `/api/assess` |
| GET | `/api/research/{run_id}/scene.json` | the stage-3 scene for a DRKG run (layout binaries are the frontend's `/drkg/*.bin`) |
| GET | `/api/research` | live + recorded run ids |
| GET | `/api/health` | key present, models, tracing on/off |

Event types, in order: `run_started` · `patient_loaded` · `plan` ·
(`subagent_started` · `tool_call` · `tool_result` · `budget_exhausted`? · `subagent_finished`)×N
· `verify` · `report` · `run_finished` | `error`. Each event is
`{t_ms, type, criterion?, data}`.

## The report (for the drug matcher)

`report.profiles[]` is a `ReportProfile` (`schemas.py`), ranked for the
patient. Two fields exist for matching:

- `embedding_text`: mechanism only, in a fixed field order (criterion → goal
  → mechanism → targets → pathways → site of action), so profiles embed
  comparably. Embed this one and compare it against drug mechanism text.
- `constraints_text`: required/avoid properties (the profile's own, the
  brief's, and the patient-specific ones the orchestrator added), to use as a
  filter or a second embedding.

`molecular_targets[].symbol` are HGNC symbols, so they can also be joined
directly against drug–target tables (DRKG, ChEMBL, Open Targets).

## Privacy wall

Sub-agents never see the patient. Three layers enforce it, and
`test_privacy.py` checks all three:

1. **Shape:** `Brief` is `{criterion, objective, constraints, avoid}`, with
   no patient field. The `Send` payload carries only the brief.
2. **Tools:** the MCP server has no patient tool, and sub-agents only get the
   target-level ones (`SUBAGENT_TOOLS`).
3. **Scrubbing:** `privacy.sanitize_brief` redacts every identifier in the
   record (person names are also split into first and last name), current
   medication names, dates, ages, contact details and lab-style values. The
   `plan` event reports how many redactions were made.

The orchestrator does see the record, so it's in the **LangSmith traces**
of the plan and synthesize steps. For real data, set
`LANGSMITH_HIDE_INPUTS=true`.

## No drug names

`no_drugs.py` removes drug names and development codes from every profile and
from the synthesis. Its list combines the pipeline's candidates and
graveyard, Open Targets' ALS trial drugs, and a curated list of ALS symptom
drugs and brand names. The removals are counted in `report.privacy.drug_mentions_removed`.
Gene symbols, trial ids and biology words ("glutamate", "creatine kinase")
are kept.

## Claude settings

`llm.py` is the only place a client is built:
- **Models:** `claude-opus-5-5` for the orchestrator and ingest,
  `claude-sonnet-5-5` for sub-agents. Set them with `CLAUDE_*_MODEL`.
- **Effort:** `medium` (`AGENT_EFFORT`). Thinking stays adaptive; these
  models don't allow turning it off.
- **Structured output:** uses Claude's native `output_config.format`
  (`method="json_schema"`, and `ProviderStrategy` for agents). Forced
  `tool_choice` returns a 400 on these models.
- **Refusal fallback:** server-side `fallbacks: "default"` is on, so a
  safety-classifier refusal is retried on a suitable model rather than
  returned.
- **Schema rule:** keep schemas free of `X | None` fields. Optional unions
  can make the compiled output grammar too large (a 400).

## LangSmith

Tracing is on when `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` are in
`agent/.env`. Each run appears as **research run**, with these steps inside
it: `orchestrator: plan` → `subagent <id>: <label>` (each with its own tool
calls) → `orchestrator: synthesize`. Filter by `metadata.run_id` to find the
trace for a given API run.

## Tools (`mcp_server.py`)

Sub-agents use `search_pubmed` · `fetch_pubmed_abstract` ·
`search_als_trials` · `get_trial` · `opentargets_als_targets` ·
`target_profile` (function, pathways, druggability, safety liabilities, ALS
association by evidence type). The server also has drug-level tools
(`chembl_drug`, `fda_label`, `pubchem_properties`, `opentargets_als_drugs`,
`opentargets_target_drugs`, `pipeline_*`) for the matching step. Responses
are cached in `agent/cache/`.
