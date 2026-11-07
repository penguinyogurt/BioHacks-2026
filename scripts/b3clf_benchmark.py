"""Write artifacts/b3clf_comparison.json (ours on external BBBP + published B3clf ref)."""
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.metrics import average_precision_score, matthews_corrcoef, roc_auc_score

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

EXT = ROOT / "data" / "external_bbbp.json"
MET = ROOT / "artifacts" / "bbb_metrics.json"
OUT = ROOT / "artifacts" / "b3clf_comparison.json"


def pack(y, p, thr):
    pred = (p >= thr).astype(int)
    return {
        "roc_auc": round(float(roc_auc_score(y, p)), 4),
        "pr_auc": round(float(average_precision_score(y, p)), 4),
        "mcc": round(float(matthews_corrcoef(y, pred)), 4),
        "n": int(len(y)),
    }


def main():
    from bbb.model import load_model

    if not EXT.exists():
        raise SystemExit("Run scripts/build_external_set.py first")
    compounds = json.loads(EXT.read_text()).get("compounds", [])
    model = load_model()
    y_all, p_all, y_id, p_id = [], [], [], []
    for c in compounds:
        pr = model.predict(c["smiles"])
        y_all.append(c["label"])
        p_all.append(pr.raw_prob)
        if pr.in_domain:
            y_id.append(c["label"])
            p_id.append(pr.raw_prob)
    metrics = json.loads(MET.read_text()) if MET.exists() else {}
    sc = metrics.get("scaffold_split", {}).get("summary", {})
    doc = {
        "comparison_notes": [
            "B3clf (XGB + PaDEL) is the published B3DB baseline (Meng et al., Sci Data 2021).",
            "Fair pairwise test: BBBP structures not in B3DB (scripts/build_external_set.py).",
            "Full B3clf rescoring needs Java + padelpy; published B3DB hold-out ROC-AUC ~0.91.",
        ],
        "ours_scaffold_split_cv": sc,
        "ours_external_bbbp_all_molecules": pack(np.array(y_all), np.array(p_all), model.threshold),
        "ours_external_bbbp_in_domain_only": pack(np.array(y_id), np.array(p_id), model.threshold) if y_id else None,
        "b3clf_published_b3db_benchmark": {
            "roc_auc": 0.91,
            "citation": "B3DB/B3clf authors; engineering-spec validation baseline",
            "model": "xgb + PaDEL, trained on B3DB",
        },
        "delta_scaffold_roc_auc_vs_published_b3clf": round(sc.get("roc_auc", {}).get("mean", 0) - 0.91, 4) if sc else None,
    }
    OUT.write_text(json.dumps(doc, indent=2) + "\n")
    print(OUT)


if __name__ == "__main__":
    main()
