"""Stage 3: the research agents' target genes → DRKG → candidate drugs.

  research run ─► one profile per sub-agent (its criterion, its verified HGNC targets): sent by the
                  frontend straight from the `verify` event, or rebuilt from a finished report
                  ─► frontend/scripts/drkg_scene.py --profiles … --out runs/<id>.scene.json
                     (q = e[gene] − r[DRUGBANK::target], 400-d L2 over every DrugBank compound,
                      min over the profile's genes, top 5; method in docs/DECISIONS.md)
                  ─► runs/<id>.scene.json   the stage-3 picture, for the frontend
                     runs/<id>.drugs.json   the top matches, for the drug assessment (POST /api/assess)

The scoring lives in that one script, run as a subprocess (file in, file out), so the demo's
precomputed scene and a live run can't drift apart. Needs numpy and the raw DRKG release in
DRKG_DIR (see agent/.env.example). The first run on a machine builds a ~10 min cache.
"""
import asyncio
import json
import os
import re
import sys
from typing import Callable

from agent.config import ROOT, RUNS_DIR

SCRIPT = ROOT.parent / "frontend" / "scripts" / "drkg_scene.py"
DRKG_DIR = os.getenv("DRKG_DIR") or str(ROOT / ".venv" / "data" / "drkg")
MAX_DRUGS = int(os.getenv("AGENT_DRKG_MAX_DRUGS", "8"))
TIMEOUT_S = float(os.getenv("AGENT_DRKG_TIMEOUT_S", "1200"))  # the first run builds the layout cache
_LOCK = asyncio.Lock()

# A name a web researcher can actually search for: not a bare DrugBank id, not an IUPAC string.
_SEARCHABLE = re.compile(r"^(?!DB\d{5}$)[^()\[\]{}]{2,40}$")


def profiles_from(report: dict) -> list[dict]:
    """One DRKG profile per sub-agent, in plan order, so lane n here is lane n in the UI."""
    lanes = [p["criterion"] for p in report.get("plan", [])]
    out = []
    for lane, cid in enumerate(lanes):
        mine = sorted((p for p in report.get("profiles", []) if p["criterion"] == cid), key=lambda p: p["rank"])
        targets = list(dict.fromkeys(t["symbol"] for p in mine for t in p["molecular_targets"] if t.get("symbol")))
        label = next((p["criterion_label"] for p in mine), None) or next((p["label"] for p in report["plan"] if p["criterion"] == cid), cid)
        out.append({"lane": lane, "name": label, "criterion": cid, "targets": targets})
    return out


def candidates(scene: dict, limit: int = MAX_DRUGS) -> list[dict]:
    """Best matches across profiles, round-robin by rank, so every hypothesis gets a turn."""
    picked, seen = [], set()
    profiles = sorted(scene["profiles"], key=lambda p: p["lane"])
    for rank in range(max((len(p["matches"]) for p in profiles), default=0)):
        for p in profiles:
            if rank >= len(p["matches"]) or len(picked) >= limit:
                continue
            m = p["matches"][rank]
            if m["id"] in seen or not _SEARCHABLE.match(m["name"]):
                continue
            seen.add(m["id"])
            picked.append({"name": m["name"], "id": m["id"].split("::")[-1], "profile": p["name"], "lane": p["lane"],
                           "via_gene": m["viaGene"], "drkg_rank": m["rank"], "l2": m["distance"], "direct_edge": m["directEdge"]})
    return picked


async def run(run_id: str, profiles: list[dict], emit: Callable[[dict], None], research_run_id: str = "", patient_id: str = "") -> dict:
    """Score each profile's targets in DRKG. Emits progress; returns the stage-3 summary."""
    if not any(p["targets"] for p in profiles):
        raise ValueError("the research run has no molecular targets to look up")
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    src, out, drugs_out = (RUNS_DIR / f"{run_id}.{x}" for x in ("profiles.json", "scene.json", "drugs.json"))
    src.write_text(json.dumps(profiles, indent=1), encoding="utf-8")
    emit({"type": "drkg_started", "data": {"profiles": profiles, "research_run_id": research_run_id}})

    tail: list[str] = []
    # One at a time: on a fresh machine the first run rebuilds the layout cache and rewrites
    # frontend/public/drkg/*.bin in place, and two of those at once would race.
    async with _LOCK:
        proc = await asyncio.create_subprocess_exec(
            sys.executable, str(SCRIPT), "--profiles", str(src), "--out", str(out),
            cwd=str(ROOT.parent), env={**os.environ, "DRKG_DIR": DRKG_DIR, "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8"},
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        try:
            async with asyncio.timeout(TIMEOUT_S):
                async for raw in proc.stdout:
                    line = raw.decode("utf-8", "replace").rstrip()
                    tail = (tail + [line])[-20:]
                    if line.startswith(("relayout", "cached layout", "check:", "warning:", "layout:")):
                        emit({"type": "drkg_log", "data": {"line": line}})
                await proc.wait()
        finally:
            if proc.returncode is None:  # timeout, cancelled task, server shutdown: don't orphan it
                proc.kill()
                await proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"drkg_scene.py exited {proc.returncode}: " + " | ".join(tail[-4:]))

    scene = json.loads(out.read_text(encoding="utf-8"))
    for p in scene["profiles"]:
        emit({"type": "drkg_profile", "criterion": next((x["criterion"] for x in profiles if x["lane"] == p["lane"]), ""), "data": {
            "lane": p["lane"], "name": p["name"],
            "genes": [g["symbol"] for g in p["genes"]], "unresolved": p["unresolved"],
            "matches": [{k: m[k] for k in ("rank", "name", "id", "distance", "viaGene", "directEdge")} for m in p["matches"]],
        }})
    drugs = candidates(scene)
    drugs_out.write_text(json.dumps({"drugs": drugs}, indent=1), encoding="utf-8")
    summary = {
        "run_id": run_id, "research_run_id": research_run_id, "patient_id": patient_id,
        "scene_url": f"/api/research/{run_id}/scene.json",
        "drugs_path": drugs_out.relative_to(ROOT).as_posix(), "drugs": drugs,
        "universe": scene["meta"]["universe"], "formula": scene["meta"]["formula"],
    }
    emit({"type": "report", "data": summary})
    return summary
