"""Weakly supervised VOC-ALS clip classification. Run with .venv/bin/python -B clip_impairment.py"""
import argparse
import csv
import os
from pathlib import Path
from math import gcd

import numpy as np
import soundfile as sf
from scipy.fft import dct
from scipy.signal import get_window, resample_poly
from scipy.special import expit
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from threadpoolctl import threadpool_limits

PRIVATE = Path(__file__).resolve().parent / "private"
OUT = PRIVATE / "clip_impairment"
TASKS = ("phonationA", "phonationE", "phonationI", "phonationO", "phonationU",
         "rhythmPA", "rhythmTA", "rhythmKA")
LABELS = ("none detected", "speech impairment detected")
RATE, FRAME, HOP, FFT = 16000, 400, 160, 512
WINDOW = get_window("hann", FRAME)
hz = np.fft.rfftfreq(FFT, 1/RATE)[:, None]
edges = 700*np.expm1(np.linspace(0, np.log1p((RATE/2)/700), 42))
filters = np.maximum(0, np.minimum((hz-edges[:-2])/np.diff(edges)[:-1],
                                  (edges[2:]-hz)/np.diff(edges)[1:]))


def features(path):
    audio, sr = sf.read(path, dtype="float32", always_2d=True)
    if len(audio)==0 or not np.isfinite(audio).all():
        raise ValueError(f"Invalid audio: {path}")
    duration = len(audio)/sr
    g = gcd(sr, RATE)
    wave = resample_poly(audio.mean(axis=1), RATE//g, sr//g)
    if len(wave)<FRAME:
        wave = np.pad(wave, (0, FRAME-len(wave)))
    frames = np.lib.stride_tricks.sliding_window_view(wave,FRAME)[::HOP]
    rms = np.sqrt(np.mean(frames**2,axis=1))
    power = abs(np.fft.rfft(frames*WINDOW,n=FFT,axis=1))**2/(WINDOW@WINDOW)
    mel_db = 10*np.log10(np.maximum(power@filters,1e-10))
    mfcc = dct(mel_db,type=2,norm="ortho",axis=1)[:,:13]
    return np.r_[duration, mfcc.mean(axis=0), mfcc.std(axis=0), rms.std()]


def classifier():
    return make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced",C=1,max_iter=2000))


def save_csv(name, header, rows):
    with (OUT/name).open("w",newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def run():
    with (PRIVATE/"results"/"predictions.csv").open() as f:
        speakers = list(csv.DictReader(f))
    assert len(speakers)==len({r["speaker"] for r in speakers})==102
    ids, tasks, ratings, folds, vectors = [], [], [], [], []
    for r in speakers:
        for t in TASKS:
            s = r["speaker"]
            vectors.append(features(PRIVATE/"data"/t/f"{s}_{t}.wav"))
            ids.append(s)
            tasks.append(t)
            ratings.append(int(r["observed_rating"]))
            folds.append(int(r["fold"]))
    X = np.stack(vectors)
    ids, tasks, ratings, folds = map(np.asarray,(ids,tasks,ratings,folds))
    assert set(ratings)=={1,2,3,4} and set(folds)==set(range(1,6))
    y = (ratings<4).astype(int)
    scores = np.full(len(y),np.nan)
    majority = np.full(len(y),-1)
    for fold in range(1,6):
        test = folds==fold
        train = ~test
        assert set(ids[train]).isdisjoint(ids[test])
        model = classifier().fit(X[train],y[train])
        scores[test] = model.predict_proba(X[test])[:,1]
        majority[test] = np.bincount(y[train],minlength=2).argmax()
    assert np.isfinite(scores).all() and (majority>=0).all()
    pred = (scores>0.5).astype(int)
    OUT.mkdir(parents=True,exist_ok=True)
    save_csv("predictions.csv",["speaker","task","fold","speaker_rating","weak_positive","score",
                               "prediction","majority_prediction"],
             zip(ids,tasks,folds,ratings,y,scores,(LABELS[i] for i in pred),(LABELS[i] for i in majority)))
    rows = []
    for name,p in [("logistic",pred),("majority",majority)]:
        for task in ("all",*TASKS):
            mask = np.ones(len(y),bool) if task=="all" else tasks==task
            tn,fp,fn,tp = confusion_matrix(y[mask],p[mask],labels=[0,1]).ravel()
            sens,spec = tp/(tp+fn),tn/(tn+fp)
            mild = mask & (ratings==3)
            rows.append([name,task,mask.sum(),tn,fp,fn,tp,(tp+tn)/mask.sum(),
                         (sens+spec)/2,sens,spec,p[mild].sum(),mild.sum(),p[mild].mean()])
    save_csv("metrics.csv",["model","task","clips","TN","FP","FN","TP","accuracy","balanced_accuracy",
                            "sensitivity","specificity","mild_detected","mild_clips","mild_sensitivity"],rows)
    # Deployment fit is separate from the out-of-fold predictions above.
    scaler, logistic = classifier().fit(X,y).steps
    scaler, logistic = scaler[1], logistic[1]
    np.savez(OUT/"model.npz",mean=scaler.mean_,scale=scaler.scale_,
             coef=logistic.coef_[0],intercept=logistic.intercept_[0])
    print((OUT/"metrics.csv").read_text())


if __name__=="__main__":
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predict",type=Path,metavar="WAV",help="Classify one clip with the saved full-cohort fit")
    arg = parser.parse_args()
    with threadpool_limits(limits=1):
        if arg.predict is None:
            run()
        else:
            with np.load(OUT/"model.npz",allow_pickle=False) as m:
                logit = ((features(arg.predict)-m["mean"])/m["scale"])@m["coef"]+m["intercept"]
            print(LABELS[int(logit>0)],f"(model score {expit(logit):.3f})")
