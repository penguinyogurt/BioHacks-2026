# Research agent backend

The orchestrator agent reads the patient record and sends parallel
sub-agents out to research one criterion each (survival, cramps, BBB, …)
using MCP tools. It verifies their citations and returns a ranked report.
Design: [`docs/RESEARCH_AGENT_SPEC.md`](../docs/RESEARCH_AGENT_SPEC.md).

```
POST /api/research ─► load_patient ─► plan ──Send()──► research (sub-agent) ×N, ≤4 at once
                         (record)     (record,          (brief only + als-research MCP tools)
                                       writes briefs,             │
                                       sanitizes them)            ▼
                                                    verify (PMIDs/NCTs must exist)
                                                                  ▼
                                    synthesize (record; ranks) + safety gate from pipeline.json
                                                                  ▼
                                               ResearchReport ─► SSE "report" event
```

## Setup (once)

```bash
python -m venv agent/.venv
agent/.venv/Scripts/python -m pip install -r agent/requirements.txt   # macOS/Linux: agent/.venv/bin/python
cp agent/.env.example agent/.env    # then fill in GOOGLE_API_KEY and LANGSMITH_API_KEY
```

## Run (from the repo root)

```bash
agent/.venv/Scripts/python -m agent.api                 # API on http://127.0.0.1:8001
agent/.venv/Scripts/python -m agent.cli "cramps and sleep?"   # one run in the terminal
agent/.venv/Scripts/python -m unittest agent.test_privacy     # privacy wall, no key needed
agent/.venv/Scripts/python -m agent.mcp_server          # the MCP server alone (stdio)
```

On Windows, don't run it with `uvicorn --reload`. Reload mode switches to an
event loop that can't spawn the MCP subprocesses.

## API (for the frontend)

| Method | Path | Returns |
|---|---|---|
| POST | `/api/research` body `{"question"?: string}` | `{run_id, events_url, report_url}` |
| GET | `/api/research/{run_id}/events` | SSE stream: all past events, then live. Recorded runs replay from `agent/runs/`; `?replay_speed=1` keeps original timing |
| GET | `/api/research/{run_id}` | `{status, report, error}` |
| GET | `/api/research` | live + recorded run ids |
| GET | `/api/health` | key present, models, tracing on/off |

Event types, in order: `run_started` · `patient_loaded` · `plan` ·
(`subagent_started` · `tool_call` · `tool_result` · `subagent_finished`)×N
· `verify` · `report` · `run_finished` | `error`. Each event is
`{t_ms, type, criterion?, data}`. The `report` data is `ResearchReport` in
`schemas.py`. Mirror it in zod when the frontend is connected.

```js
const { events_url } = await (await fetch("http://127.0.0.1:8001/api/research", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
const es = new EventSource("http://127.0.0.1:8001" + events_url);
es.addEventListener("report", (e) => console.log(JSON.parse(e.data).data));
```

## Privacy wall

Sub-agents never see the patient. Three layers enforce it, and
`test_privacy.py` checks all three:

1. **Shape:** `Brief` is `{criterion, objective, constraints, avoid}`, with
   no patient field. The `Send` payload carries only the brief.
2. **Tools:** the `als-research` MCP server has no patient tool, and its
   pipeline tools strip the patient-specific `filters[]` reasons.
3. **Scrubbing:** `privacy.sanitize_brief` redacts every identifier in the
   record, current medication names, dates, ages, contact details and
   lab-style values from each brief. The `plan` event reports how many
   redactions were made.

The orchestrator does see the record, so it's in the **LangSmith traces**
of the plan and synthesize steps. Alex is synthetic, so that's fine. For
real data, set `LANGSMITH_HIDE_INPUTS=true`, and use Vertex AI with a BAA
instead of the Gemini API.

## LangSmith

Tracing is on when `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` are in
`agent/.env`. No code changes. Each run appears as **research run** with
children `orchestrator: plan` → `subagent <id>: <label>` (each with its own
tool calls) → `orchestrator: synthesize`. Filter by `metadata.run_id` to
find the trace for a given API run.

## Tools (`mcp_server.py`)

`search_pubmed` · `fetch_pubmed_abstract` · `search_als_trials` ·
`get_trial` · `chembl_drug` · `pubchem_properties` · `fda_label` ·
`opentargets_als_drugs` · `opentargets_als_targets` ·
`opentargets_target_drugs` · `pipeline_drug` · `pipeline_top_candidates`

Responses are cached in `agent/cache/`. Run the CLI a few times before the
expo to warm the cache.
