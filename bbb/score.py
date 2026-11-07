from __future__ import annotations

import json
import time
from pathlib import Path

from .featurize import UnparseableSmilesError
from .model import load_model

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "bbb_scores.json"
GRAVEYARD = (ROOT / "data" / "graveyard.json", ROOT / "data" / "als_graveyard.json")
CANDIDATES = (ROOT / "data" / "crosswalk.json", ROOT / "data" / "bbb_candidates.json")


def _load(paths):
    for p in paths:
        if p.exists():
            return json.loads(p.read_text()), p
    raise FileNotFoundError(paths)


def _list(doc):
    if isinstance(doc, list):
        return doc
    return doc.get("compounds") or doc.get("drugs") or []


def _score(model, entries):
    out = []
    for e in entries:
        row = {k: e[k] for k in ("name", "year", "phase", "note", "smiles", "source_url") if k in e}
        smi = e.get("smiles")
        if not smi:
            row["scorable"] = False
            row["bbb"] = None
            out.append(row)
            continue
        try:
            p = model.predict(smi)
        except UnparseableSmilesError as exc:
            row["scorable"] = False
            row["bbb"] = None
            row["error"] = str(exc)
            out.append(row)
            continue
        row["scorable"] = True
        row["bbb"] = p.to_contract()
        row["detail"] = {"call": p.call, "raw_prob": p.raw_prob, "domain_reason": p.domain_reason}
        if p.in_domain and p.call == "BBB+":
            row["bucket"] = "arrived_failed"
        elif p.in_domain:
            row["bucket"] = "never_arrived"
        else:
            row["bucket"] = "undetermined"
        out.append(row)
    return out


def main():
    model = load_model()
    cand_doc, cand_p = _load(CANDIDATES)
    grav_doc, grav_p = _load(GRAVEYARD)
    candidates = _score(model, _list(cand_doc))
    graveyard = _score(model, _list(grav_doc))
    part = {
        "never_arrived": [g for g in graveyard if g.get("bucket") == "never_arrived"],
        "arrived_failed": [g for g in graveyard if g.get("bucket") == "arrived_failed"],
        "undetermined": [g for g in graveyard if g.get("bucket") == "undetermined"],
    }
    counts = {k: len(v) for k, v in part.items()}
    metrics = {}
    mp = ROOT / "artifacts" / "bbb_metrics.json"
    if mp.exists():
        metrics = json.loads(mp.read_text())
    b3 = ROOT / "artifacts" / "b3clf_comparison.json"
    b3clf = json.loads(b3.read_text()) if b3.exists() else None
    n_ood = sum(1 for c in candidates if c.get("scorable") and not c["bbb"]["in_domain"])
    doc = {
        "meta": {
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "candidate_source": str(cand_p.relative_to(ROOT)),
            "graveyard_source": str(grav_p.relative_to(ROOT)),
        },
        "model": {
            "scaffold_split": metrics.get("scaffold_split", {}).get("summary"),
            "random_split_contrast": metrics.get("random_split", {}).get("summary"),
            "b3clf_comparison": b3clf,
        },
        "summary": {
            "n_candidates_in_domain": sum(1 for c in candidates if c.get("bbb") and c["bbb"]["in_domain"]),
            "n_candidates_out_of_domain": n_ood,
            "graveyard_partition": counts,
        },
        "candidates": candidates,
        "graveyard": graveyard,
        "graveyard_partition": {"counts": counts, "members": part},
    }
    OUT.write_text(json.dumps(doc, indent=2) + "\n")
    print(counts, "ood", n_ood, "->", OUT)
