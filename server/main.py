import json
import os
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from server import bbb_adapter
from server.presets import PRESETS

ROOT = Path(__file__).resolve().parent.parent
PIPELINE = Path(os.environ.get("PIPELINE_PATH", ROOT / "data" / "pipeline.json"))

app = FastAPI(title="ALS repurposing connector")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"],
    allow_headers=["*"],
)
_cache = {"mtime": None, "data": None}
_warm = {"done": False}


def read_pipeline():
    if not PIPELINE.exists():
        raise HTTPException(503, f"{PIPELINE.name} not found; run merge or use sample.")
    mt = PIPELINE.stat().st_mtime
    if _cache["mtime"] != mt:
        _cache["data"] = json.loads(PIPELINE.read_text())
        _cache["mtime"] = mt
    return _cache["data"]


@app.on_event("startup")
def warm():
    def run():
        for p in PRESETS:
            if p.get("smiles"):
                try:
                    bbb_adapter.predict(p["smiles"])
                except Exception:
                    pass
        _warm["done"] = True

    threading.Thread(target=run, daemon=True).start()


@app.get("/api/health")
def health():
    return {"ok": True, "pipeline_present": PIPELINE.exists(), "bbb_model_wired": bbb_adapter.model_available(), "warm": _warm["done"]}


@app.get("/api/pipeline")
def pipeline():
    return read_pipeline()


@app.get("/api/presets")
def presets():
    return {"presets": PRESETS}


class PredictBody(BaseModel):
    smiles: str = Field(min_length=1)


@app.post("/api/predict")
def predict(body: PredictBody):
    try:
        return bbb_adapter.predict(body.smiles)
    except bbb_adapter.InvalidSmiles as e:
        raise HTTPException(422, str(e))
