"""Component D: join module JSON outputs into the single file the frontend reads."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from src.paths import (
    BBB_SCORES_JSON,
    DATA,
    KG_SCORES_JSON,
    PATIENT_FILTER_JSON,
    PIPELINE_JSON,
    ROOT,
)

STAGES = [
    ("universe", "Approved drugs"),
    ("kg_relevance", "Linked to ALS biology"),
    ("bbb", "Can reach the target"),
    ("patient_filter", "Safe and usable for Alex"),
    ("trial_history", "Not already failed"),
]
RULE_ORDER = [
    "cyp1a2",
    "respiratory",
    "weight_loss",
    "myopathy",
    "swallow",
    "dexterity",
    "bbb_direction",
    "canada",
]
DEFAULT_N_INPUT = 4805
BBB_THRESHOLD = 0.5


def log(msg: str) -> None:
    print(f"[merge] {msg}", file=sys.stderr)


def load_json(path: Path) -> tuple[dict | None, str]:
    if not path.exists():
        return None, "missing"
    try:
        with path.open() as fh:
            doc = json.load(fh)
    except (json.JSONDecodeError, OSError) as exc:
        log(f"{path.name}: {exc}")
        return None, "unreadable"
    return (doc, "ok") if isinstance(doc, dict) else (None, "unreadable")


def rows(payload: dict | None, *keys: str) -> list[dict]:
    if not payload:
        return []
    for key in keys:
        val = payload.get(key)
        if isinstance(val, list):
            return [r for r in val if isinstance(r, dict)]
    return []


def num(v, default=None):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return default
    return float(v)


def pf_by_key(payload: dict | None) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for rec in rows(payload, "results", "patients", "candidates"):
        key = rec.get("inchikey") or rec.get("id") or rec.get("name")
        if key:
            out[str(key)] = rec
    return out


def bbb_by_key(payload: dict | None) -> dict[str, dict]:
    out = {}
    for rec in rows(payload, "scores", "predictions", "candidates"):
        block = rec.get("bbb") if isinstance(rec.get("bbb"), dict) else rec
        key = rec.get("inchikey") or block.get("inchikey") or rec.get("name")
        if key:
            merged = dict(block)
            for k in ("name", "smiles", "inchikey", "id"):
                if rec.get(k) and k not in merged:
                    merged[k] = rec[k]
            out[str(key)] = merged
            if rec.get("name"):
                out[str(rec["name"]).lower()] = merged
    return out


def normalize_filters(raw: list[dict]) -> list[dict]:
    seen = [
        {
            "rule": f["rule"],
            "passed": bool(f.get("passed", True)),
            "reason": f.get("reason") or "",
        }
        for f in raw
        if isinstance(f.get("rule"), str)
    ]
    known = sorted([f for f in seen if f["rule"] in RULE_ORDER], key=lambda f: RULE_ORDER.index(f["rule"]))
    extra = [f for f in seen if f["rule"] not in RULE_ORDER]
    return known + extra


def bbb_block(rec: dict | None) -> dict:
    if not rec:
        return {
            "prob": None,
            "in_domain": True,
            "nearest_tanimoto": None,
            "descriptors": {},
            "scored": False,
        }
    in_domain = bool(rec.get("in_domain", True))
    prob = num(rec.get("prob"))
    desc = rec.get("descriptors") if isinstance(rec.get("descriptors"), dict) else {}
    return {
        "prob": prob if in_domain else None,
        "in_domain": in_domain,
        "nearest_tanimoto": num(rec.get("nearest_tanimoto")),
        "descriptors": desc,
        "scored": True,
        **({"refusal": rec["refusal"]} if rec.get("refusal") else {}),
    }


def bbb_gate(bbb: dict | None, compartment: str | None) -> tuple[bool, str | None]:
    if not bbb:
        return True, None
    if not bbb.get("in_domain", True):
        return False, bbb.get("refusal") or "Outside applicability domain"
    prob = bbb.get("prob")
    if prob is None:
        return True, None
    crosses = prob >= BBB_THRESHOLD
    comp = (compartment or "cns").lower()
    if comp in ("cns", "brain", "central") and not crosses:
        return False, f"CNS target but predicted BBB-negative (p = {prob:.2f})"
    if comp in ("muscle", "peripheral") and crosses:
        return False, f"Peripheral target but BBB-positive (p = {prob:.2f})"
    return True, None


STAGE_INPUT = {
    "kg_relevance": "kg_scores.json",
    "bbb": "bbb_scores.json",
    "patient_filter": "patient_filter.json",
    "trial_history": "graveyard.json",
}


def merge_funnel(n_input: int, reported: dict, missing: set[str], eliminated_at: dict) -> list[dict]:
    counts: dict[str, int] = {}
    running = n_input
    for stage, _ in STAGES[1:]:
        key = stage
        if isinstance(reported.get(key), int):
            running = reported[key]
        else:
            running -= len(eliminated_at.get(key, []))
        counts[key] = max(running, 0)

    out = [{"stage": "universe", "label": "Approved drugs", "count": n_input, "eliminated": 0, "top_reason": None}]
    prev = n_input
    reasons = {
        "kg_relevance": "no path to ALS in graph",
        "bbb": "predicted BBB-negative",
        "patient_filter": "respiratory depressant",
        "trial_history": "failed phase 3",
    }
    for stage, label in STAGES[1:]:
        count = counts[stage]
        out.append(
            {
                "stage": stage,
                "label": label,
                "count": count,
                "eliminated": max(prev - count, 0),
                "top_reason": reasons.get(stage),
                **({"degraded": True} if STAGE_INPUT.get(stage) in missing else {}),
            }
        )
        prev = count
    return out


def graveyard_bucket(entry: dict, bbb_rec: dict | None) -> tuple[str | None, float | None]:
    if entry.get("bucket") in ("never_arrived", "arrived_failed"):
        return entry["bucket"], num(entry.get("bbb_prob"))
    delivery = (entry.get("delivery") or "").lower()
    if delivery in ("intrathecal", "it", "spinal"):
        return "arrived_failed", num(entry.get("bbb_prob"))
    prob = num(entry.get("bbb_prob"))
    if bbb_rec:
        in_domain = bool(bbb_rec.get("in_domain", True))
        scored = num(bbb_rec.get("prob"))
        if in_domain and scored is not None:
            prob = scored
        elif not in_domain:
            return "never_arrived", None
    if prob is None:
        return "never_arrived", None
    return ("arrived_failed" if prob >= BBB_THRESHOLD else "never_arrived"), prob


def merge(in_dir: Path = DATA, out_path: Path = PIPELINE_JSON) -> dict:
    kg_p, kg_st = load_json(in_dir / "kg_scores.json")
    bbb_p, bbb_st = load_json(in_dir / "bbb_scores.json")
    pf_p, pf_st = load_json(in_dir / "patient_filter.json")
    gy_p, gy_st = load_json(in_dir / "graveyard.json")

    inputs = {
        "kg_scores.json": kg_st,
        "bbb_scores.json": bbb_st,
        "patient_filter.json": pf_st,
        "graveyard.json": gy_st,
    }
    missing = {k for k, v in inputs.items() if v != "ok"}
    for k in sorted(missing):
        log(f"{k} missing; stage marked degraded")

    kg_meta = (kg_p or {}).get("meta", {}) or {}
    bbb_meta = (bbb_p or {}).get("meta", {}) or {}
    pf_meta = (pf_p or {}).get("meta", {}) or {}

    kg_rows = rows(kg_p, "compounds", "scores", "ranked", "candidates")
    bbb_map = bbb_by_key(bbb_p)
    pf_map = pf_by_key(pf_p)
    gy_rows = rows(gy_p, "graveyard", "entries", "failures")

    trial_names = {g["name"].lower(): g for g in gy_rows if g.get("name")}

    candidates = []
    eliminated_at: dict[str, list] = {}
    for kg in kg_rows:
        key = kg.get("inchikey")
        if not key:
            continue
        name = kg.get("name")
        bbb_rec = bbb_map.get(key) or (bbb_map.get(str(name).lower()) if name else None)
        bbb = bbb_block(bbb_rec)
        compartment = kg.get("target_compartment") or (bbb_rec or {}).get("target_compartment") or "cns"
        pf = pf_map.get(key) or pf_map.get(kg.get("id") or kg.get("drugbank_id")) or pf_map.get(name)
        filters = normalize_filters(pf.get("filters", []) if pf else [])

        verdict, elim_at = "shortlisted", None
        elim_reason = None
        path = kg.get("path") if isinstance(kg.get("path"), list) else []
        if not path and kg.get("score") is None:
            verdict, elim_at = "eliminated", "kg_relevance"
        else:
            ok, reason = bbb_gate(bbb, compartment)
            if not ok:
                verdict, elim_at, elim_reason = "eliminated", "bbb", reason
            else:
                fail = next((f for f in filters if not f["passed"]), None)
                if fail:
                    verdict, elim_at, elim_reason = "eliminated", "patient_filter", fail["reason"]
                elif kg.get("name", "").lower() in trial_names:
                    verdict, elim_at = "eliminated", "trial_history"

        if elim_at:
            eliminated_at.setdefault(elim_at, []).append(kg)

        candidates.append(
            {
                "id": kg.get("id") or kg.get("drugbank_id") or key,
                "inchikey": key,
                "name": kg.get("name") or key,
                "smiles": kg.get("smiles") or "",
                "kg": {"score": num(kg.get("score")), "rank": kg.get("rank")},
                "path": path,
                "bbb": bbb,
                "filters": filters,
                "verdict": verdict,
                "eliminated_at": elim_at,
                **({"eliminated_reason": elim_reason} if elim_reason else {}),
            }
        )

    n_input = next(
        (
            n
            for n in (
                kg_meta.get("n_input"),
                kg_meta.get("universe_size"),
                len(kg_rows) if kg_rows else None,
            )
            if isinstance(n, int) and n > 0
        ),
        DEFAULT_N_INPUT,
    )
    # Funnel counts come from this join, not from subset n_pass on the 21-drug
    # patient-filter sample or the handful of BBB demo candidates.
    reported = {
        "kg_relevance": None,
        "bbb": None,
        "patient_filter": None,
        "trial_history": None,
    }

    graveyard = []
    part = {"never_arrived": 0, "arrived_failed": 0}
    for g in gy_rows:
        inchi = g.get("inchikey")
        bbb_rec = (bbb_map.get(inchi) if inchi else None) or bbb_map.get(str(g.get("name") or "").lower())
        bucket, prob = graveyard_bucket(g, bbb_rec)
        if not bucket:
            continue
        part[bucket] = part.get(bucket, 0) + 1
        graveyard.append(
            {
                "name": g["name"],
                "year": g.get("year"),
                "phase": g.get("phase"),
                "bbb_prob": prob,
                "bucket": bucket,
                "note": g.get("note"),
                "source_url": g.get("source_url"),
            }
        )

    sample = (not kg_p) or str(kg_meta.get("source", "")).upper().startswith("SAMPLE")
    mode = "sample" if sample else "real"
    kg_val = (kg_p or {}).get("validation") or {}
    pos = kg_val.get("positive_controls") or {}
    riluzole_rank = (pos.get("riluzole") or {}).get("rank")
    edaravone_rank = (pos.get("edaravone") or {}).get("rank")
    if riluzole_rank is None:
        hit = next((c for c in candidates if (c.get("name") or "").lower() == "riluzole"), None)
        riluzole_rank = (hit or {}).get("kg", {}).get("rank")
    if edaravone_rank is None:
        hit = next((c for c in candidates if (c.get("name") or "").lower() == "edaravone"), None)
        edaravone_rank = (hit or {}).get("kg", {}).get("rank")
    bbb_matched = sum(1 for c in candidates if (c.get("bbb") or {}).get("scored"))
    pf_matched = sum(1 for c in candidates if c.get("filters"))
    bbb_auc = None
    split = ((bbb_p or {}).get("model") or {}).get("scaffold_split") or {}
    auc_block = split.get("roc_auc") if isinstance(split.get("roc_auc"), dict) else {}
    bbb_auc = num(auc_block.get("mean")) or num(bbb_meta.get("roc_auc"))

    doc = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "n_input": n_input,
            "patient": pf_meta.get("patient") or "alex_chen",
            "data_mode": mode,
            "is_sample": mode == "sample",
            "inputs": inputs,
            "coverage": {
                "kg": len(candidates),
                "bbb": bbb_matched,
                "patient_filter": pf_matched,
                "graveyard": len(graveyard or gy_rows),
            },
            "rule_order": pf_meta.get("rule_order") or RULE_ORDER,
            "chart": pf_meta.get("chart") or {},
        },
        "funnel": merge_funnel(n_input, reported, missing, eliminated_at),
        "candidates": candidates,
        "graveyard": graveyard or rows(gy_p, "graveyard"),
        "validation": {
            "riluzole_rank": riluzole_rank,
            "edaravone_rank": edaravone_rank,
            "bbb_roc_auc": bbb_auc,
            "bbb_roc_auc_published_baseline": num(
                bbb_meta.get("roc_auc_published_baseline") or bbb_meta.get("baseline_auc")
            ),
            "negatives_in_top_50": kg_val.get("negatives_in_top_50") or kg_meta.get("negatives_in_top_50"),
            "partition": part,
        },
    }

    if bbb_matched < n_input:
        for stage in doc["funnel"]:
            if stage["stage"] == "bbb":
                stage["degraded"] = True
                stage["scored"] = bbb_matched
    if pf_matched < n_input:
        for stage in doc["funnel"]:
            if stage["stage"] == "patient_filter":
                stage["degraded"] = True
                stage["scored"] = pf_matched

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as fh:
        json.dump(doc, fh, indent=2)
        fh.write("\n")
    log(f"wrote {out_path} ({len(candidates)} candidates, {len(graveyard)} graveyard)")
    return doc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in-dir", type=Path, default=DATA)
    ap.add_argument("--out", type=Path, default=PIPELINE_JSON)
    args = ap.parse_args()
    merge(args.in_dir, args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
