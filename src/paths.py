"""Repo-relative paths, so every module runs the same from any working directory."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DATA = ROOT / "data"
RAW = DATA / "raw"
ARTIFACTS = ROOT / "artifacts"
APP = ROOT / "app"

# The frozen output contract: the only file the frontend reads.
PIPELINE_JSON = DATA / "pipeline.json"

KG_SCORES_JSON = DATA / "kg_scores.json"
BBB_SCORES_JSON = DATA / "bbb_scores.json"
PATIENT_FILTER_JSON = DATA / "patient_filter.json"


def ensure_dirs() -> None:
    for d in (DATA, RAW, ARTIFACTS):
        d.mkdir(parents=True, exist_ok=True)
