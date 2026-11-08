"""Score external set with our model vs B3clf xgb/classic_ADASYN."""
import json, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, matthews_corrcoef, roc_auc_score

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
EXT = ROOT / "data" / "external_bbbp.json"
OUT = ROOT / "artifacts" / "b3clf_comparison.json"


def ours_scores(compounds):
    from bbb.model import load_model
    m = load_model()
    y, p, ids = [], [], []
    for i, c in enumerate(compounds):
        pr = m.predict(c["smiles"])
        if not pr.in_domain:
            continue
        y.append(c["label"])
        p.append(pr.raw_prob)
        ids.append(i)
    return np.array(y), np.array(p)


def b3clf_scores(compounds, repo: Path, work: Path):
    sys.path.insert(0, str(repo))
    from b3clf.descriptor_padel import compute_descriptors
    from b3clf.geometry_opt import geometry_optimize
    from b3clf.utils import get_descriptors, scale_descriptors, select_descriptors
    import joblib
    import xgboost as xgb

    smi = work / "ext.smi"
    smi.write_text("\n".join(f"{c['smiles']}\text{i}" for i, c in enumerate(compounds)))
    sdf = work / "opt.sdf"
    geometry_optimize(str(smi), str(sdf), sep="\t")
    desc = compute_descriptors(str(sdf), excel_out=None, output_csv=None)
    X, info = get_descriptors(df=desc)
    X = select_descriptors(df=X)
    Xs = scale_descriptors(df=X)
    clf = joblib.load(repo / "b3clf/pre_trained/b3clf_xgb_classic_ADASYN.joblib")
    booster = clf.get_booster()
    probs = booster.predict(xgb.DMatrix(np.asarray(Xs), feature_names=list(X.columns)))
    return dict(zip(info.index.astype(str), probs)), set(info.index.astype(str))


def summarize(y, p, thr=0.5):
    pred = (p >= thr).astype(int)
    return {
        "roc_auc": round(float(roc_auc_score(y, p)), 4),
        "pr_auc": round(float(average_precision_score(y, p)), 4),
        "mcc": round(float(matthews_corrcoef(y, pred)), 4),
        "n": int(len(y)),
    }


def main():
    repo = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/B3clf")
    if not (repo / "b3clf/pre_trained/b3clf_xgb_classic_ADASYN.joblib").exists():
        print("Clone B3clf with LFS first", file=sys.stderr)
        return 1
    compounds = json.loads(EXT.read_text())["compounds"]
    work = Path(tempfile.mkdtemp(prefix="b3clf_"))
    b3_probs, b3_idx = b3clf_scores(compounds, repo, work)
    y_ours, p_ours = ours_scores(compounds)
    shared = [c for i, c in enumerate(compounds) if f"ext{i}" in b3_idx]
    y = np.array([c["label"] for c in shared])
    pb = np.array([b3_probs[f"ext{i}"] for i, c in enumerate(compounds) if c in shared or f"ext{compounds.index(c)}" in b3_probs])
    # align by index
    rows = []
    for i, c in enumerate(compounds):
        key = f"ext{i}"
        if key not in b3_probs:
            continue
        pr = load_model().predict(c["smiles"])
        if not pr.in_domain:
            continue
        rows.append((c["label"], b3_probs[key], pr.raw_prob))
    if not rows:
        raise RuntimeError("no overlap scored")
    y = np.array([r[0] for r in rows])
    pb = np.array([r[1] for r in rows])
    po = np.array([r[2] for r in rows])
    from bbb.model import load_model
    thr = load_model().threshold
    doc = {
        "external_n": len(rows),
        "b3clf_xgb_classic_ADASYN": summarize(y, pb),
        "ours_isotonic_lightgbm": summarize(y, po, thr),
        "note": "Both trained on B3DB; test is BBBP structures absent from B3DB.",
    }
    OUT.write_text(json.dumps(doc, indent=2) + "\n")
    print(json.dumps(doc, indent=2))
    return 0

if __name__ == "__main__":
    sys.exit(main() or 0)
