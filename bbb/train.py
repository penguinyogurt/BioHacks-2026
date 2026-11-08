"""Train LightGBM BBB classifier and write committed artifacts."""

from __future__ import annotations

import json
import time
import urllib.request
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    matthews_corrcoef,
    roc_auc_score,
)

from .baselines import rule_scores
from .featurize import canonical_smiles, featurize, fingerprint_bits, standardize_or_none
from .split import random_split, scaffold_split

ROOT = Path(__file__).resolve().parent.parent
B3DB_PATH = ROOT / "data" / "raw" / "B3DB_classification.tsv"
B3DB_URL = "https://raw.githubusercontent.com/theochem/B3DB/main/B3DB/B3DB_classification.tsv"
ARTIFACT = ROOT / "artifacts" / "bbb_model.joblib"
METRICS = ROOT / "artifacts" / "bbb_metrics.json"
PARAMS = dict(n_estimators=600, learning_rate=0.05, num_leaves=63, subsample=0.8,
              colsample_bytree=0.6, reg_lambda=1.0, n_jobs=4, verbosity=-1)


def fetch_b3db() -> Path:
    if not B3DB_PATH.exists():
        B3DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(B3DB_URL, B3DB_PATH)
    return B3DB_PATH


def load_b3db():
    df = pd.read_csv(fetch_b3db(), sep="\t")
    mols, X, y, smiles, failed = [], [], [], [], 0
    for smi, lab in zip(df["SMILES"], df["BBB+/BBB-"]):
        m = standardize_or_none(smi)
        if m is None:
            failed += 1
            continue
        mols.append(m)
        X.append(featurize(m))
        y.append(1 if str(lab).strip() == "BBB+" else 0)
        smiles.append(canonical_smiles(m))
    return mols, np.vstack(X), np.asarray(y), smiles, failed


def _fit(X, y, seed):
    return CalibratedClassifierCV(
        lgb.LGBMClassifier(random_state=seed, **PARAMS), method="isotonic", cv=5
    ).fit(X, y)


def _metrics(y, probs, preds):
    return {
        "roc_auc": float(roc_auc_score(y, probs)),
        "pr_auc": float(average_precision_score(y, probs)),
        "mcc": float(matthews_corrcoef(y, preds)),
        "accuracy": float((preds == y).mean()),
        "brier": float(brier_score_loss(y, probs)),
        "confusion": confusion_matrix(y, preds).tolist(),
    }


def _eval(X, y, mols, splitter, seeds, rule_pred=None):
    runs, rule_runs = [], []
    for seed in range(seeds):
        tr, va, te = splitter(mols, seed=seed)
        clf = _fit(X[tr], y[tr], seed)
        pv, pt = clf.predict_proba(X[va])[:, 1], clf.predict_proba(X[te])[:, 1]
        grid = np.linspace(0.05, 0.95, 91)
        thr = float(max(grid, key=lambda t: matthews_corrcoef(y[va], (pv >= t).astype(int))))
        pred = (pt >= thr).astype(int)
        run = {"seed": seed, "threshold": thr, **_metrics(y[te], pt, pred)}
        runs.append(run)
        print(f"  seed {seed}: AUC {run['roc_auc']:.3f} MCC {run['mcc']:.3f}")
        if rule_pred is not None:
            rp = rule_pred[te]
            rule_runs.append({
                "mcc": float(matthews_corrcoef(y[te], rp)),
                "roc_auc": float(roc_auc_score(y[te], rp)),
            })
    summary = {k: {"mean": float(np.mean([r[k] for r in runs])),
                    "sd": float(np.std([r[k] for r in runs]))}
               for k in ("roc_auc", "pr_auc", "mcc", "accuracy", "brier")}
    out = {"runs": runs, "summary": summary}
    if rule_runs:
        out["rule_baseline"] = {
            "summary": {k: {"mean": float(np.mean([r[k] for r in rule_runs])),
                             "sd": float(np.std([r[k] for r in rule_runs]))}
                        for k in ("mcc", "roc_auc")}
        }
    return out


def main():
    t0 = time.time()
    mols, X, y, smiles, failed = load_b3db()
    print(f"{X.shape}, failed={failed}, pos={y.mean():.3f}")
    rule = rule_scores(mols)
    import os
    seeds = int(os.environ.get("BBB_SEEDS", "5"))
    scaffold = _eval(X, y, mols, scaffold_split, seeds, rule)
    random = _eval(X, y, mols, random_split, seeds, rule)
    thr = float(np.median([r["threshold"] for r in scaffold["runs"]]))
    final = _fit(X, y, 0)
    from .domain import pack_bits

    packed = pack_bits(np.vstack([fingerprint_bits(m) for m in mols]))
    bundle = {
        "model": final,
        "version": "bbb_v1",
        "threshold": thr,
        "metrics": {"scaffold": scaffold["summary"], "random": random["summary"]},
        "train_mw_p99": float(np.percentile(X[:, 0], 99)),
        "train_fp_packed": packed,
        "train_fp_popcount": np.unpackbits(packed, axis=-1).sum(axis=-1).astype(np.uint16),
        "train_smiles": smiles,
    }
    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, ARTIFACT, compress=3)
    doc = {
        "scaffold_split": scaffold,
        "random_split": random,
        "dataset": {"n": int(X.shape[0]), "failed_parses": failed, "n_features": int(X.shape[1])},
        "shipped_threshold": thr,
        "runtime_seconds": round(time.time() - t0, 1),
    }
    METRICS.write_text(json.dumps(doc, indent=2) + "\n")
    s, r = scaffold["summary"], random["summary"]
    print(f"SCAFFOLD ROC-AUC {s['roc_auc']['mean']:.3f}±{s['roc_auc']['sd']:.3f} "
          f"PR-AUC {s['pr_auc']['mean']:.3f} MCC {s['mcc']['mean']:.3f}")
    print(f"RANDOM  ROC-AUC {r['roc_auc']['mean']:.3f} MCC {r['mcc']['mean']:.3f}")


if __name__ == "__main__":
    main()
