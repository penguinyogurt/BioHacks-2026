"""Run offline: ../speech-tests-backup/.venv/bin/python -B logmel_svd.py"""
import csv
import math
import os
from pathlib import Path

import numpy as np
import soundfile as sf
from mord import LogisticAT
from scipy.signal import get_window, resample_poly
from sklearn.metrics import confusion_matrix, recall_score
from sklearn.model_selection import StratifiedKFold
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

PRIVATE = Path(__file__).resolve().parents[1] / "speech-tests-backup" / "private"
OUTPUT = PRIVATE / "logmel_svd"
TASKS = ("phonationA", "phonationE", "phonationI", "phonationO", "phonationU",
         "rhythmPA", "rhythmTA", "rhythmKA")
CANDIDATES = (2, 4, 8, 16)
LEVELS = (1, 2, 3, 4)
RATE, FRAME, HOP, FFT = 16000, 400, 160, 512
WINDOW = get_window("hann", FRAME)
# 64 triangular filters with vertices equally spaced on the HTK mel scale.
hz = np.fft.rfftfreq(FFT, 1/RATE)
edges = 700 * np.expm1(np.linspace(0, np.log1p((RATE/2)/700), 66))
left = (hz[:, None] - edges[:-2]) / np.diff(edges)[:-1]
right = (edges[2:] - hz[:, None]) / np.diff(edges)[1:]
FILTERS = np.maximum(0, np.minimum(left, right))


def features(path):
    wave, rate = sf.read(path, dtype="float32", always_2d=True)
    divisor = math.gcd(rate, RATE)
    mono = resample_poly(wave.mean(axis=1), RATE//divisor, rate//divisor)
    if len(mono) < FRAME+HOP or not np.isfinite(mono).all():
        raise ValueError(f"Invalid recording: {path.name}")
    frames = np.lib.stride_tricks.sliding_window_view(mono, FRAME)[::HOP]
    power = np.abs(np.fft.rfft(frames*WINDOW, n=FFT, axis=1))**2 / (WINDOW@WINDOW)
    db = 10*np.log10(np.maximum(power @ FILTERS, 1e-10))
    return np.concatenate([db.mean(axis=0), db.std(axis=0), np.abs(np.diff(db,axis=0)).mean(axis=0)])


def transform(X, fit, other):
    scaler = StandardScaler().fit(X[fit])
    train, test = scaler.transform(X[fit]), scaler.transform(X[other])
    _, _, vt = np.linalg.svd(train, full_matrices=False)
    basis = vt[:max(CANDIDATES)].T
    return train, test, train@basis, test@basis


def predict(train, test, labels):
    return LogisticAT(alpha=1.).fit(train, labels).predict(test)


def save(name, header, rows):
    with (OUTPUT/name).open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)


def main():
    os.umask(0o077)
    with (PRIVATE/"results"/"predictions.csv").open() as f:
        ref = list(csv.DictReader(f))
    ids = np.array([r["speaker"] for r in ref])
    folds = np.array([int(r["fold"]) for r in ref])
    y = np.array([int(r["observed_rating"]) for r in ref])
    assert len(set(ids)) == len(ids) == 102 and set(folds) == set(range(1,6))
    X = np.stack([np.concatenate([features(PRIVATE/"data"/task/f"{s}_{task}.wav")
                                  for task in TASKS]) for s in ids])
    assert X.shape == (len(ids),1536) and np.isfinite(X).all()
    predictions = {name:np.zeros_like(y) for name in ("acoustic_svd","acoustic_full")}
    selections = []
    for fold in sorted(set(folds)):
        train, test = np.flatnonzero(folds!=fold), np.flatnonzero(folds==fold)
        assert set(ids[train]).isdisjoint(ids[test])
        inner = StratifiedKFold(4, shuffle=True, random_state=42)
        held = {k:np.zeros_like(y[train]) for k in CANDIDATES}
        for a,b in inner.split(train,y[train]):
            fit, val = train[a], train[b]
            assert set(ids[fit]).isdisjoint(ids[val])
            _, _, z, v = transform(X, fit, val)
            for k in CANDIDATES:
                held[k][b] = predict(z[:,:k], v[:,:k], y[fit])
        recalls = [recall_score(y[train],held[k],labels=LEVELS,average="macro") for k in CANDIDATES]
        k = CANDIDATES[np.argmax(recalls)]  # smallest k breaks a tie
        selections.append([fold, k, *recalls])
        a,b,z,v = transform(X,train,test)
        predictions["acoustic_svd"][test] = predict(z[:,:k],v[:,:k],y[train])
        predictions["acoustic_full"][test] = predict(a,b,y[train])
    predictions["saved_hubert"] = np.array([int(r["ordinal_prediction"]) for r in ref])
    summary, matrices = [], []
    for name,p in predictions.items():
        cm = confusion_matrix(y,p,labels=LEVELS)
        summary.append([name,int((p==y).sum()),len(y),np.mean(p==y),np.mean(abs(p-y)),
                        np.mean(cm.diagonal()/cm.sum(axis=1)),cm[2,3],cm[2].sum()])
        matrices.extend([name,level,*row] for level,row in zip(LEVELS,cm))
    OUTPUT.mkdir(parents=True,exist_ok=True)
    save("comparison.csv",["model","exact","speakers","accuracy","MAE","macro_recall","mild_to_normal","mild_count"],summary)
    save("confusion.csv",["model","actual","severe","moderate","mild","normal"],matrices)
    save("selection.csv",["fold","selected_k",*[f"inner_macro_{k}" for k in CANDIDATES]],selections)
    save("predictions.csv",["speaker","fold","observed",*predictions],zip(ids,folds,y,*predictions.values()))
    print((OUTPUT/"comparison.csv").read_text(),(OUTPUT/"confusion.csv").read_text(),selections)


if __name__ == "__main__":
    with threadpool_limits(limits=1):
        main()
