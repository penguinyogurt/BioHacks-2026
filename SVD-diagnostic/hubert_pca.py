"""Offline HuBERT dimensionality comparison. Run with ../speech-tests-backup/.venv/bin/python hubert_pca.py."""
import csv
import hashlib
import os

import numpy as np
from mord import LogisticAT
from sklearn.decomposition import PCA
from sklearn.metrics import recall_score
from sklearn.model_selection import StratifiedKFold
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "speech-tests-backup"))
from speech_severity import PRIVATE, REV, TASKS, evaluate

CANDIDATES = (2, 4, 8, 16)
OUTPUT = PRIVATE / "hubert_pca"


def write_csv(name, header, rows):
    with (OUTPUT/name).open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)


def load_cached_features(ids):
    cache = PRIVATE/"embeddings"/(REV+"-16k-last-mean-v1")
    speakers = []
    for speaker in ids:
        tasks = []
        for task in TASKS:
            wav = PRIVATE/"data"/task/f"{speaker}_{task}.wav"
            key = hashlib.sha256(wav.read_bytes()).hexdigest()
            vector = np.load(cache/(key+".npy"), allow_pickle=False)
            assert vector.shape == (768,) and np.isfinite(vector).all()
            tasks.append(vector)
        speakers.append(np.concatenate(tasks))
    return np.stack(speakers)


def preprocess(X, train, test, dimensions):
    scale = StandardScaler().fit(X[train])
    a, b = scale.transform(X[train]), scale.transform(X[test])
    pca = PCA(n_components=dimensions, whiten=True, svd_solver="full")
    return a, b, pca.fit_transform(a), pca.transform(b)


def predict(train, test, labels):
    return LogisticAT(alpha=1.).fit(train, labels).predict(test)


def main():
    os.umask(0o077)
    with (PRIVATE/"results"/"predictions.csv").open() as f:
        ref = list(csv.DictReader(f))
    ids = np.array([r["speaker"] for r in ref])
    y = np.array([int(r["observed_rating"]) for r in ref])
    folds = np.array([int(r["fold"]) for r in ref])
    assert len(set(ids)) == len(ids) == 102 and set(folds) == set(range(1,6))
    X = load_cached_features(ids)
    evaluate(ids, X, y, OUTPUT/"original")
    with (OUTPUT/"original"/"predictions.csv").open() as f:
        assert list(csv.DictReader(f)) == ref, "Original predictions or folds changed"

    predictions = {"original_10": np.array([int(r["ordinal_prediction"]) for r in ref]),
                   "no_pca": np.zeros_like(y), "selected_pca": np.zeros_like(y)}
    tuning = []
    for fold in sorted(set(folds)):
        train, test = np.flatnonzero(folds != fold), np.flatnonzero(folds == fold)
        assert set(ids[train]).isdisjoint(ids[test])
        inner = StratifiedKFold(4, shuffle=True, random_state=42)
        held = {d: np.zeros_like(y[train]) for d in CANDIDATES}
        for a, b in inner.split(train, y[train]):
            fit, val = train[a], train[b]
            assert set(ids[fit]).isdisjoint(ids[val])
            _, _, z, v = preprocess(X, fit, val, max(CANDIDATES))
            for d in CANDIDATES:
                held[d][b] = predict(z[:, :d], v[:, :d], y[fit])
        scores = [recall_score(y[train], held[d], average="macro") for d in CANDIDATES]
        selected = CANDIDATES[np.argmax(scores)]  # smallest count on a tie
        tuning.append([fold, selected, *scores])
        a, b, z, v = preprocess(X, train, test, selected)
        predictions["no_pca"][test] = predict(a, b, y[train])
        predictions["selected_pca"][test] = predict(z, v, y[train])
    write_csv("selection.csv", ["outer_fold", "selected", *[f"inner_recall_{d}" for d in CANDIDATES]], tuning)
    write_csv("predictions.csv", ["speaker","fold","rating",*predictions], zip(ids, folds, y, *predictions.values()))
    rows = []
    for name, p in predictions.items():
        rows.append([name, sum(p==y), np.mean(p==y), np.mean(abs(p-y)),
                     recall_score(y,p,average="macro"), sum((y==3)&(p==4)), sum(y==3)])
    write_csv("comparison.csv", ["model","exact_count","accuracy","mae","macro_recall","mild_to_normal","mild_count"],rows)
    print((OUTPUT/"comparison.csv").read_text(), (OUTPUT/"selection.csv").read_text())


if __name__ == "__main__":
    with threadpool_limits(limits=1):
        main()
