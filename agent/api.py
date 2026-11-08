"""HTTP API for the research agent. The frontend connects here.

  POST /api/research                 {question?}  → {run_id, events_url, report_url}
  GET  /api/research/{run_id}/events SSE: every event so far, then live ones
  GET  /api/research/{run_id}        {status, report, error}
  GET  /api/research                 recent runs
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
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from agent.config import GOOGLE_API_KEY, LANGSMITH_PROJECT, MAX_CONCURRENCY, ORCHESTRATOR_MODEL, RUN_TIMEOUT_S, RUNS_DIR, SUBAGENT_MODEL, tracing_enabled
from agent.graph import DEFAULT_QUESTION, graph

app = FastAPI(title="ALS research agent")
app.add_middleware(CORSMiddleware, allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?", allow_methods=["*"], allow_headers=["*"])


@dataclass
class Run:
    run_id: str
    question: str
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


async def execute(run: Run) -> None:
    await run.push({"type": "run_started", "data": {"question": run.question, "models": {"orchestrator": ORCHESTRATOR_MODEL, "subagent": SUBAGENT_MODEL}}})
    config = {
        "max_concurrency": MAX_CONCURRENCY,
        "run_name": "research run",
        "tags": ["research_run"],
        "metadata": {"run_id": run.run_id, "question": run.question},
    }
    try:
        async with asyncio.timeout(RUN_TIMEOUT_S):
            async for event in graph.astream({"run_id": run.run_id, "question": run.question}, config=config, stream_mode="custom"):
                if event.get("type") == "report":
                    run.report = event["data"]
                await run.push(event)
        run.status = "done"
        await run.push({"type": "run_finished", "data": {"findings": len((run.report or {}).get("findings", []))}})
    except Exception as e:
        run.status, run.error = "error", f"{type(e).__name__}: {e}"[:500]
        await run.push({"type": "error", "data": {"message": run.error}})


class ResearchRequest(BaseModel):
    question: str | None = None


@app.post("/api/research")
async def start_research(body: ResearchRequest):
    if not GOOGLE_API_KEY:
        raise HTTPException(503, "GOOGLE_API_KEY is not set (agent/.env)")
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    run_id = time.strftime("r%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    run = RUNS[run_id] = Run(run_id=run_id, question=(body.question or DEFAULT_QUESTION).strip())
    asyncio.create_task(execute(run))
    return {"run_id": run_id, "events_url": f"/api/research/{run_id}/events", "report_url": f"/api/research/{run_id}"}


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


@app.get("/api/research")
async def list_runs():
    live = [{"run_id": r.run_id, "status": r.status, "question": r.question} for r in RUNS.values()]
    recorded = sorted((p.stem for p in RUNS_DIR.glob("*.jsonl")), reverse=True)[:20] if RUNS_DIR.exists() else []
    return {"live": live, "recorded": recorded}


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "gemini_key": bool(GOOGLE_API_KEY),
        "models": {"orchestrator": ORCHESTRATOR_MODEL, "subagent": SUBAGENT_MODEL},
        "langsmith_tracing": tracing_enabled(),
        "langsmith_project": LANGSMITH_PROJECT if tracing_enabled() else None,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("AGENT_PORT", "8001")))
