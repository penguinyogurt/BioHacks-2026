"""Run beside biceps.zip with numpy, scipy, scikit-learn and matplotlib installed.
Archive: https://www.kaggle.com/datasets/lydialoubar/emglab
Source: Nikolic M, University of Copenhagen, 2001 (EMGLAB N2001).
"""
from pathlib import Path
import csv
import re
import zipfile
from collections import defaultdict
import numpy as np
from scipy.signal import welch
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

root = Path(__file__).resolve().parent
features = ["RMS (µV)", "P99−P1 (µV)", "Waveform length (µV/s)", "Median frequency (Hz)"]
records = defaultdict(list)
identity = defaultdict(set)
with zipfile.ZipFile(root / "biceps.zip") as archive:
    for name in sorted(archive.namelist()):
        m = re.fullmatch(r"N2001([AC]\d\d)BB\d+\.hea", name)
        if not m:
            continue
        patient = m[1]
        lines = archive.read(name).decode("latin1").splitlines()
        meta = dict(line[1:].split(": ", 1) for line in lines if line.startswith("#") and ": " in line)
        if meta["muscle"].lower() != "biceps brachii (long head)":
            continue
        dx = meta["diagnosis"].lower()
        assert ("als" in dx if patient.startswith("A") else "control" in dx)
        source_id = re.search(r"1ch\\(\d+)\\", meta["indentifier"])[1]
        identity[patient].add((source_id, meta["age"], meta["gender"]))
        record, channels, fs, count = lines[0].split()
        binary, fmt, calibration = lines[1].split()
        assert record+".hea" == name and binary == record+".bin" and channels == "1"
        assert fmt == "16+20" and calibration.endswith("/uV")
        fs = float(fs)
        x = np.frombuffer(archive.read(binary), dtype="<i2", offset=20, count=int(count)).astype(float)
        x -= x.mean()
        x /= float(calibration.split("/")[0])
        freq, power = welch(x, fs, nperseg=round(fs/4), window="hann")
        median_freq = freq[np.searchsorted(power.cumsum(), power.sum()/2)]
        records[patient].append([np.sqrt(np.mean(x*x)), np.diff(np.percentile(x,[1,99]))[0],
                                 np.abs(np.diff(x)).mean()*fs, median_freq])

assert records and all(len(v)==1 for v in identity.values())
assert len({next(iter(v))[0] for v in identity.values()}) == len(records)
ids = np.array(sorted(records))
X = np.array([np.median(records[p], axis=0) for p in ids])
y = np.array([p.startswith("A") for p in ids])
def components(z):
    _, s, v = np.linalg.svd(z, full_matrices=False)
    v *= np.sign(v[np.arange(len(v)), np.abs(v).argmax(axis=1)])[:,None]
    return s*s/(s@s), v

z = StandardScaler().fit_transform(X)
variance, weights = components(z)
scores = z @ weights[:2].T
pred = np.zeros((len(ids),2),dtype=bool)
for i in range(len(ids)):
    train = np.arange(len(ids)) != i
    scaler = StandardScaler().fit(X[train])
    a, b = scaler.transform(X[train]), scaler.transform(X[[i]])
    _, v = components(a)
    for j,(u,t) in enumerate([(a@v[:2].T,b@v[:2].T),(a,b)]):
        model = LogisticRegression(C=1, class_weight="balanced").fit(u,y[train])
        pred[i,j] = model.predict(t)[0]
with (root/"patients.csv").open("w") as f:
    w = csv.writer(f)
    w.writerow(["ID","diagnosis","recordings",*features,"PC1","PC2","two_PC_prediction","four_feature_prediction"])
    for i,p in enumerate(ids):
        label = lambda val: "ALS" if val else "Healthy"
        w.writerow([p,label(y[i]),len(records[p]),*X[i],*scores[i],*map(label,pred[i])])
fig,ax = plt.subplots(figsize=(7,5))
for group, marker, color in [(True,"^","#bd4a2f"),(False,"o","#237b88")]:
    rows = y==group
    ax.scatter(*scores[rows].T,marker=marker,color=color,s=55,label="ALS" if group else "Healthy")
ax.set(xlabel=f"PC1 ({variance[0]:.1%})",ylabel=f"PC2 ({variance[1]:.1%})",title="Biceps brachii, long head · one point per participant")
ax.legend()
fig.tight_layout()
fig.savefig(root/"patient-scores.png",dpi=180)
fig,ax = plt.subplots(figsize=(7,4))
for i in range(2):
    ax.barh(np.arange(4)+(i-.5)*.36,weights[i],.36,label=f"PC{i+1}",color=["#38598c","#dc8f43"][i])
ax.set_yticks(np.arange(4),features)
ax.set_xlabel("Weight on standardized feature")
ax.axvline(0,color="gray",lw=.7)
ax.legend()
fig.tight_layout()
fig.savefig(root/"component-weights.png",dpi=180)
print(ids, [len(records[p]) for p in ids], variance, weights[:2], scores[y].mean(axis=0), scores[~y].mean(axis=0))
for j in range(2):
    print(balanced_accuracy_score(y,pred[:,j]),ids[pred[:,j]!=y])
