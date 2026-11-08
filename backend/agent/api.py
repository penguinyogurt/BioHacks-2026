"""HTTP API for the research agent. The frontend connects here.

  POST /api/research                 {question?, patient_id?}  → {run_id, events_url, report_url}
  POST /api/assess                   {patient_id?, drugs_path? | drugs?, research_run_id?} → same + pdf_url; ranks pipeline drugs
  GET  /api/research/{run_id}/report.pdf   the finished drug assessment as a PDF
  GET  /api/research/{run_id}/events SSE: every event so far, then live ones
  GET  /api/research/{run_id}        {status, report, error}
  GET  /api/research                 recent runs
  POST /api/patients                 multipart {file: PDF, patient_id} → parsed record counts
  GET  /api/patients                 patient ids
  GET  /api/health

Every run is also written to agent/runs/<run_id>.jsonl, so a recorded run can
be replayed through the same events endpoint with no network or API key.

Run:  python -m agent.api      (port 8001; AGENT_PORT to change)
"""
import asyncio
import json
import os
import time
import uuid
from dataclasses import dataclass, field

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from agent.config import ANTHROPIC_API_KEY, DEFAULT_PATIENT, PATIENT_DIR, LANGSMITH_PROJECT, ROOT, MAX_CONCURRENCY, ORCHESTRATOR_MODEL, RUN_TIMEOUT_S, RUNS_DIR, SUBAGENT_MODEL, tracing_enabled
from agent import assess, drkg
from agent.graph import DEFAULT_QUESTION, graph
from agent.ingest import PATIENT_ID, IngestError, parse_pdf, save, summary

app = FastAPI(title="ALS research agent")
app.add_middleware(CORSMiddleware, allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?", allow_methods=["*"], allow_headers=["*"])


@dataclass
class Run:
    run_id: str
    question: str
    patient_id: str
    started: float = field(default_factory=time.monotonic)
    events: list[dict] = field(default_factory=list)
    status: str = "running"  # running | done | error
    report: dict | None = None
    error: str | None = None
    changed: asyncio.Condition = field(default_factory=asyncio.Condition)

    async def push(self, event: dict) -> None:
        event = {"t_ms": int((time.monotonic() - self.started) * 1000), **event}
        self.events.append(event)
        with (RUNS_DIR / f"{self.run_id}.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(event) + "\n")
        async with self.changed:
            self.changed.notify_all()


RUNS: dict[str, Run] = {}


async def execute(run: Run, g=graph, inputs: dict | None = None, name: str = "research run", timeout: float = RUN_TIMEOUT_S) -> None:
    await run.push({"type": "run_started", "data": {"kind": name, "question": run.question, "models": {"orchestrator": ORCHESTRATOR_MODEL, "subagent": SUBAGENT_MODEL}}})
    config = {
        "max_concurrency": MAX_CONCURRENCY,
        "run_name": name,
        "tags": [name.replace(" ", "_")],
        "metadata": {"run_id": run.run_id, "question": run.question, "patient_id": run.patient_id},
    }
    inputs = {"run_id": run.run_id, "patient_id": run.patient_id, **(inputs or {"question": run.question})}
    try:
        async with asyncio.timeout(timeout):
            async for event in g.astream(inputs, config=config, stream_mode="custom"):
                if event.get("type") == "report":
                    run.report = event["data"]
                await run.push(event)
        run.status = "done"
        r = run.report or {}
        await run.push({"type": "run_finished", "data": {"profiles": len(r.get("profiles", []))} if "profiles" in r else {"drugs": len(r.get("drugs", []))}})
    except Exception as e:
        run.status, run.error = "error", f"{type(e).__name__}: {e}"[:500]
        await run.push({"type": "error", "data": {"message": run.error}})


class ResearchRequest(BaseModel):
    question: str | None = None
    patient_id: str = DEFAULT_PATIENT


@app.post("/api/patients")
async def upload_patient(file: UploadFile = File(...), patient_id: str = Form(...), synthetic: bool = Form(True)):
    """Upload a chart PDF; it's parsed into data/patient/<patient_id>.json. Returns section counts, not contents."""
    if not PATIENT_ID.match(patient_id):
        raise HTTPException(422, "patient_id must be lowercase letters, digits, - or _")
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "PDF over 20 MB")
    try:
        record, method = await parse_pdf(data)
    except IngestError as e:
        raise HTTPException(422, str(e))
    save(record, patient_id, synthetic=synthetic, source=file.filename or "upload.pdf")
    return {"patient_id": patient_id, "method": method, "counts": summary(record)}


@app.get("/api/patients")
async def list_patients():
    return {"patients": sorted(p.stem for p in PATIENT_DIR.glob("*.json"))}


@app.post("/api/research")
async def start_research(body: ResearchRequest):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(503, "ANTHROPIC_API_KEY is not set (agent/.env)")
    if not PATIENT_ID.match(body.patient_id) or not (PATIENT_DIR / f"{body.patient_id}.json").exists():
        raise HTTPException(404, f"unknown patient '{body.patient_id}' (upload a chart to /api/patients)")
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    run_id = time.strftime("r%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    run = RUNS[run_id] = Run(run_id=run_id, question=(body.question or DEFAULT_QUESTION).strip(), patient_id=body.patient_id)
    asyncio.create_task(execute(run))
    return {"run_id": run_id, "events_url": f"/api/research/{run_id}/events", "report_url": f"/api/research/{run_id}"}


class DrkgProfile(BaseModel):
    lane: int
    name: str
    criterion: str = ""
    targets: list[str]


class DrkgRequest(BaseModel):
    research_run_id: str = ""
    patient_id: str = DEFAULT_PATIENT
    # The sub-agents' verified targets, straight from the research run's `verify` event, so
    # matching starts while the orchestrator is still ranking. Without them, research_run_id
    # must name a finished run and its report's profiles are used.
    profiles: list[DrkgProfile] | None = None


async def execute_drkg(run: Run, profiles: list[dict], research_run_id: str) -> None:
    await run.push({"type": "run_started", "data": {"kind": "drkg", "research_run_id": research_run_id}})
    pushes: list[asyncio.Task] = []
    try:
        summary = await drkg.run(run.run_id, profiles, lambda e: pushes.append(asyncio.create_task(run.push(e))), research_run_id, run.patient_id)
        await asyncio.gather(*pushes)
        run.report, run.status = summary, "done"
        await run.push({"type": "run_finished", "data": {"drugs": len(summary["drugs"])}})
    except Exception as e:
        await asyncio.gather(*pushes, return_exceptions=True)
        run.status, run.error = "error", f"{type(e).__name__}: {e}"[:500]
        await run.push({"type": "error", "data": {"message": run.error}})


@app.post("/api/drkg")
async def start_drkg(body: DrkgRequest):
    """Stage 3: match the sub-agents' target genes to DrugBank compounds in DRKG. No LLM calls."""
    if body.profiles:
        profiles, patient_id = [p.model_dump() for p in body.profiles], body.patient_id
    else:
        report = (await get_run(body.research_run_id))["report"] if body.research_run_id else None
        if not report or "profiles" not in report:
            raise HTTPException(409, "give profiles, or a research run that has produced a report")
        profiles, patient_id = drkg.profiles_from(report), report.get("patient_id", body.patient_id)
    run_id = time.strftime("d%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    run = RUNS[run_id] = Run(run_id=run_id, question="drkg matching", patient_id=patient_id)
    asyncio.create_task(execute_drkg(run, profiles, body.research_run_id))
    return {"run_id": run_id, "events_url": f"/api/research/{run_id}/events", "report_url": f"/api/research/{run_id}", "scene_url": f"/api/research/{run_id}/scene.json"}


@app.get("/api/research/{run_id}/scene.json")
async def drkg_scene(run_id: str):
    """The stage-3 scene for a DRKG run. Its layout binaries are the frontend's own /drkg/*.bin."""
    path = RUNS_DIR / f"{run_id}.scene.json"
    if not path.is_file() or not path.resolve().is_relative_to(RUNS_DIR.resolve()):
        raise HTTPException(404, "no DRKG scene for this run")
    return Response(path.read_bytes(), media_type="application/json")


class AssessRequest(BaseModel):
    patient_id: str = DEFAULT_PATIENT
    drugs_path: str | None = None      # a drug-pipeline output file inside the repo
    drugs: list[str] | None = None     # or just names
    research_run_id: str = ""          # whose target profiles to compare against; default latest for the patient


@app.post("/api/assess")
async def start_assess(body: AssessRequest):
    """Research each drug on the web (no patient data), then the orchestrator ranks them for the patient."""
    if not ANTHROPIC_API_KEY:
        raise HTTPException(503, "ANTHROPIC_API_KEY is not set (agent/.env)")
    if not PATIENT_ID.match(body.patient_id) or not (PATIENT_DIR / f"{body.patient_id}.json").exists():
        raise HTTPException(404, f"unknown patient '{body.patient_id}'")
    if body.drugs:
        inputs = {"drugs": [{"name": n.strip(), "id": "", "notes": ""} for n in body.drugs[: assess.MAX_DRUGS] if n.strip()], "drugs_path": "inline"}
    elif body.drugs_path:
        path = (ROOT / body.drugs_path).resolve()
        if not path.is_relative_to(ROOT.resolve()) or not path.is_file():
            raise HTTPException(404, "drugs_path must be a file inside the repo")
        try:
            found = assess.load_drugs(path)
        except (ValueError, UnicodeDecodeError, KeyError, TypeError, AttributeError):
            found = []
        if not found:
            raise HTTPException(422, "no drugs found in that file (expects a drug-pipeline JSON)")
        inputs = {"drugs_path": str(path)}
    else:
        raise HTTPException(422, "give drugs_path or drugs")
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    run_id = time.strftime("a%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    run = RUNS[run_id] = Run(run_id=run_id, question="drug assessment", patient_id=body.patient_id)
    asyncio.create_task(execute(run, assess.graph, {**inputs, "research_run_id": body.research_run_id}, "drug assessment", assess.TIMEOUT_S))
    return {"run_id": run_id, "events_url": f"/api/research/{run_id}/events", "report_url": f"/api/research/{run_id}", "pdf_url": f"/api/research/{run_id}/report.pdf"}


def _from_disk(run_id: str) -> list[dict] | None:
    path = RUNS_DIR / f"{run_id}.jsonl"
    if not path.exists() or not path.resolve().is_relative_to(RUNS_DIR.resolve()):
        return None
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


@app.get("/api/research/{run_id}/events")
async def events(run_id: str, replay_speed: float = 0):
    """SSE. For a recorded run, replay_speed=1 replays with the original timing (0 = instant)."""
    run = RUNS.get(run_id)
    if run is None:
        recorded = _from_disk(run_id)
        if recorded is None:
            raise HTTPException(404, "unknown run")

        async def replay():
            last = 0
            for e in recorded:
                if replay_speed > 0:
                    await asyncio.sleep(max(0, e.get("t_ms", 0) - last) / 1000 / replay_speed)
                    last = e.get("t_ms", 0)
                yield {"event": e["type"], "data": json.dumps(e)}

        return EventSourceResponse(replay())

    async def live():
        i = 0
        while True:
            while i < len(run.events):
                yield {"event": run.events[i]["type"], "data": json.dumps(run.events[i])}
                i += 1
            if run.status != "running":
                return
            async with run.changed:
                await run.changed.wait_for(lambda: len(run.events) > i or run.status != "running")

    return EventSourceResponse(live())


@app.get("/api/research/{run_id}")
async def get_run(run_id: str):
    run = RUNS.get(run_id)
    if run:
        return {"run_id": run_id, "status": run.status, "report": run.report, "error": run.error}
    recorded = _from_disk(run_id)
    if recorded is None:
        raise HTTPException(404, "unknown run")
    report = next((e["data"] for e in recorded if e["type"] == "report"), None)
    return {"run_id": run_id, "status": "done" if report else "error", "report": report, "error": None}


@app.get("/api/research/{run_id}/report.pdf")
async def report_pdf(run_id: str):
    """The drug assessment as a PDF (assessment runs only)."""
    report = (await get_run(run_id))["report"]
    if not report or "drugs" not in report:
        raise HTTPException(404, "no finished drug assessment for this run")
    return Response(assess.render_pdf(report), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="drug-assessment-{report["patient_id"]}-{run_id}.pdf"'})


@app.get("/api/research")
async def list_runs():
    live = [{"run_id": r.run_id, "status": r.status, "question": r.question} for r in RUNS.values()]
    recorded = sorted((p.stem for p in RUNS_DIR.glob("*.jsonl")), reverse=True)[:20] if RUNS_DIR.exists() else []
    return {"live": live, "recorded": recorded}


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "anthropic_key": bool(ANTHROPIC_API_KEY),
        "models": {"orchestrator": ORCHESTRATOR_MODEL, "subagent": SUBAGENT_MODEL},
        "langsmith_tracing": tracing_enabled(),
        "langsmith_project": LANGSMITH_PROJECT if tracing_enabled() else None,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("AGENT_PORT", "8001")))
