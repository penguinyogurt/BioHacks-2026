"""Speaker-level ordinal prediction from the eight VOC-ALS tasks."""
import csv
import hashlib
import json
import math
import os
import re
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
PRIVATE = ROOT / "private"
TASKS = ("phonationA", "phonationE", "phonationI", "phonationO", "phonationU",
         "rhythmPA", "rhythmTA", "rhythmKA")
LEVELS = (1, 2, 3, 4)
MODEL = "facebook/hubert-base-ls960"
REV = "dba3bb02fda4248b6e082697eee756de8fe8aa8a"


def passage_wpm(words_spoken, elapsed_seconds):
    """Completed reading passage only. Elapsed time includes all pauses."""
    if not isinstance(words_spoken, int) or words_spoken < 0:
        raise ValueError("Expected a nonnegative integer word count")
    if not math.isfinite(elapsed_seconds) or elapsed_seconds <= 0:
        raise ValueError("Expected positive finite elapsed seconds")
    return 60 * words_spoken / elapsed_seconds


def norm(value):
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def read_ratings(path):
    from openpyxl import load_workbook
    book = load_workbook(path, read_only=True, data_only=True)
    ratings = {}
    required = ["id", "category", "alsfrsr speechsubscore".replace(" ", "")]
    found = False
    for sheet in book:
        rows = iter(sheet.values)
        for row in rows:
            names = list(map(norm, row))
            if not all(key in names for key in required):
                continue
            found = True
            indices = [names.index(key) for key in required]
            for row in rows:
                speaker, category, score = (row[i] for i in indices)
                if norm(category) != "als":
                    continue
                try:
                    score = float(score)
                except (ValueError, TypeError):
                    continue
                if score not in LEVELS:
                    continue
                speaker = str(speaker or "").strip().upper()
                if not speaker or speaker in ratings:
                    raise ValueError("Missing or duplicate eligible speaker ID")
                ratings[speaker] = int(score)
            break
    book.close()
    if not found or not ratings:
        raise ValueError("No eligible rows with ID, category and ALSFRS-R_SpeechSubscore")
    return dict(sorted(ratings.items()))


def download(syn, entity, folder, version):
    folder.mkdir(parents=True, exist_ok=True)
    file = syn.get(entity, version=version, downloadLocation=str(folder))
    if not file.path or not Path(file.path).is_file():
        raise PermissionError(f"Synapse did not grant file download for {entity}")
    return Path(file.path)


def collect():
    from synapseclient import Synapse
    from synapseclient.core.exceptions import SynapseNoCredentialsError
    syn = Synapse(skip_checks=True)
    try:
        syn.login(authToken=os.getenv("SYNAPSE_AUTH_TOKEN"), silent=True)
    except SynapseNoCredentialsError:
        print("No Synapse credentials found. Checking public workbook download.", flush=True)
    data = PRIVATE / "data"
    ratings = read_ratings(download(syn, "syn53182546", data, 2))
    print("ALS speakers with a recorded eligible rating:", counts(list(ratings.values())), flush=True)
    folders = {item["name"]: item["id"] for item in syn.getChildren("syn53009474")}
    recordings = {speaker: {} for speaker in ratings}
    for task in TASKS:
        for item in syn.getChildren(folders[task]):
            m = re.fullmatch(r"([^_]+)_" + task + r"\.wav", item["name"], re.I)
            if m and m[1].upper() in recordings:
                tasks = recordings[m[1].upper()]
                if task in tasks:
                    raise ValueError(f"Duplicate recording for {m[1]} {task}")
                tasks[task] = (item["id"], item["versionNumber"])
    complete = [s for s in ratings if len(recordings[s]) == len(TASKS)]
    for s in ratings:
        if s not in complete:
            print("Incomplete speaker", s, "missing", sorted(set(TASKS)-recordings[s].keys()))
    y = np.array([ratings[s] for s in complete])
    print("Complete speakers per rating:", counts(y), flush=True)
    fold_count(y)
    paths = [[download(syn, recordings[s][t][0], data/t, recordings[s][t][1])
              for t in TASKS] for s in complete]
    return complete, y, paths


def embed(paths):
    import soundfile as sf
    import torch
    from scipy.signal import resample_poly
    from transformers import HubertModel, Wav2Vec2FeatureExtractor
    cache = PRIVATE / "embeddings" / (REV + "-16k-last-mean-v1")
    cache.mkdir(parents=True, exist_ok=True)
    model = None
    speakers = []
    for tasks in paths:
        vectors = []
        for path in tasks:
            key = hashlib.sha256(path.read_bytes()).hexdigest()
            dest = cache / (key + ".npy")
            if not dest.exists():
                if model is None:
                    processor = Wav2Vec2FeatureExtractor.from_pretrained(MODEL, revision=REV)
                    model = HubertModel.from_pretrained(MODEL, revision=REV).eval()
                    model.requires_grad_(False)
                audio, sr = sf.read(path, dtype="float32", always_2d=True)
                divisor = math.gcd(sr, 16000)
                mono = resample_poly(audio.mean(axis=1), 16000//divisor, sr//divisor)
                if len(mono) < 400 or not np.isfinite(mono).all():
                    raise ValueError(f"Invalid audio in {path.name}")
                values = processor(mono, sampling_rate=16000, return_tensors="pt").input_values
                with torch.inference_mode():
                    vector = model(values).last_hidden_state.mean(1)[0].numpy()
                with dest.with_suffix(".tmp").open("wb") as f:
                    np.save(f, vector)
                dest.with_suffix(".tmp").replace(dest)
            vector = np.load(dest, allow_pickle=False)
            if vector.shape != (768,) or not np.isfinite(vector).all():
                raise ValueError(f"Invalid cache entry {dest}")
            vectors.append(vector)
        speakers.append(np.concatenate(vectors))
    return np.stack(speakers)


def counts(y):
    tally = Counter(y)
    return {k: tally[k] for k in LEVELS}


def fold_count(y):
    k = min(5, min(counts(y).values()))
    if k < 2:
        raise ValueError(f"Four-class stratified validation needs two speakers per rating: {counts(y)}")
    return k


def evaluate(ids, X, y, output):
    from mord import LogisticAT
    from sklearn.decomposition import PCA
    from sklearn.metrics import confusion_matrix
    from sklearn.model_selection import StratifiedKFold
    from sklearn.preprocessing import StandardScaler
    assert len(set(ids)) == len(ids) == len(y) == len(X)
    splitter = StratifiedKFold(fold_count(y), shuffle=True, random_state=42)
    pred = np.zeros_like(y)
    baseline = np.zeros_like(y)
    fold = np.zeros_like(y)
    for number, (train, test) in enumerate(splitter.split(X, y), start=1):
        scale = StandardScaler().fit(X[train])
        z = scale.transform(X[train])
        pca = PCA(n_components=min(10, len(train)-1, X.shape[1]), svd_solver="full", whiten=True)
        model = LogisticAT(alpha=1.).fit(pca.fit_transform(z), y[train])
        pred[test] = model.predict(pca.transform(scale.transform(X[test])))
        baseline[test] = np.sort(y[train])[(len(train)-1)//2]
        fold[test] = number
    output.mkdir(parents=True, exist_ok=True)
    with (output/"predictions.csv").open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["speaker", "fold", "observed_rating", "ordinal_prediction", "median_baseline"])
        writer.writerows(zip(ids, fold, y, pred, baseline))
    report = {"speakers_per_rating": counts(y), "folds": splitter.n_splits,
              "matrix_rows_actual_columns_predicted": list(LEVELS)}
    for name, results in [("ordinal", pred), ("training_median", baseline)]:
        errors = np.abs(y-results)
        report[name] = {"mae_levels": float(errors.mean()), "exact_accuracy": float(np.mean(errors==0)),
                        "errors_2plus": int(np.sum(errors>=2)), "errors_2plus_rate": float(np.mean(errors>=2)),
                        "confusion": confusion_matrix(y, results, labels=LEVELS).tolist()}
    summary = json.dumps(report, indent=2)
    (output/"metrics.json").write_text(summary+"\n")
    print(summary)



def acoustic_features(paths):
    """Per-task energy timing; detected envelope peaks approximate syllable nuclei."""
    import soundfile as sf
    from scipy.signal import find_peaks, resample_poly
    from scipy.ndimage import gaussian_filter1d

    rows = []
    for recordings in paths:
        row = []
        for task, path in zip(TASKS, recordings):
            audio, sr = sf.read(path, dtype="float32", always_2d=True)
            divisor = math.gcd(sr, 16000)
            mono = resample_poly(audio.mean(axis=1), 16000//divisor, sr//divisor)
            mono -= mono.mean()
            frames = np.lib.stride_tricks.sliding_window_view(mono, 400)[::160]
            rms = np.sqrt(np.mean(frames**2, axis=1))
            env = gaussian_filter1d(rms, 1.5)
            peak = np.percentile(env, 95)
            active = np.flatnonzero(env > max(0.12*peak, 1e-8))
            if not len(active):
                raise ValueError(f"No active signal in {path.name}")
            segment = env[active[0]:active[-1]+1]
            seconds = (len(segment)-1)*0.01 + 0.025
            row.extend([seconds, len(active)/len(segment),
                        np.std(segment)/max(segment.mean(), 1e-8)])
            if task.startswith("rhythm"):
                peaks, _ = find_peaks(np.pad(segment, 1), distance=8,
                                      prominence=0.15*peak, height=0.20*peak)
                intervals = np.diff(peaks)*0.01
                row.extend([len(peaks)/seconds,
                            intervals.std()/intervals.mean() if len(intervals)>1 else np.nan])
        rows.append(row)
    return np.array(rows)


def representations(hubert, acoustic, train, test, kind):
    from sklearn.decomposition import PCA
    from sklearn.impute import SimpleImputer
    from sklearn.preprocessing import StandardScaler

    blocks = {}
    if kind != "acoustic":
        scale = StandardScaler().fit(hubert[train])
        pca = PCA(n_components=10, whiten=True, svd_solver="full")
        blocks["hubert"] = (pca.fit_transform(scale.transform(hubert[train])),
                           pca.transform(scale.transform(hubert[test])))
    if kind in ("acoustic", "combined"):
        imp = SimpleImputer(strategy="median", keep_empty_features=True).fit(acoustic[train])
        scale = StandardScaler().fit(imp.transform(acoustic[train]))
        blocks["acoustic"] = (scale.transform(imp.transform(acoustic[train])),
                             scale.transform(imp.transform(acoustic[test])))
    return blocks


def ordinal_predict(blocks, y, n_pc, alpha, exponent):
    from mord import LogisticAT
    parts = [tuple(m[:, :n_pc] for m in pair) if key == "hubert" else pair
             for key, pair in blocks.items()]
    train, test = [np.column_stack(m) for m in zip(*parts)]
    freq = np.bincount(y)[y]
    weights = freq.astype(float)**(-exponent)
    model = LogisticAT(alpha=alpha).fit(train, y, sample_weight=weights/weights.mean())
    return model.predict(test)


def run_comparison():
    from itertools import product
    from sklearn.metrics import confusion_matrix, recall_score
    from sklearn.model_selection import StratifiedKFold

    reference = PRIVATE/"results"/"predictions.csv"
    with reference.open() as f:
        saved = list(csv.DictReader(f))
    ids = np.array([r["speaker"] for r in saved])
    y = np.array([int(r["observed_rating"]) for r in saved])
    fold = np.array([int(r["fold"]) for r in saved])
    ratings = read_ratings(PRIVATE/"data"/"VOC-ALS.xlsx")
    assert len(set(ids)) == len(ids) and all(ratings[s] == v for s,v in zip(ids,y))
    paths = [[PRIVATE/"data"/t/f"{s}_{t}.wav" for t in TASKS] for s in ids]
    h = embed(paths)
    out = PRIVATE/"comparison"
    evaluate(ids, h, y, out/"reproduction")
    with (out/"reproduction"/"predictions.csv").open() as f:
        if list(csv.DictReader(f)) != saved:
            raise ValueError("Original folds or predictions changed")
    acoustic = acoustic_features(paths)
    predictions = {name: np.array([int(r[key]) for r in saved]) for name,key in
                   [("median","median_baseline"), ("original","ordinal_prediction")]}
    settings = []
    for kind in ("unweighted", "weighted", "acoustic", "combined"):
        pred = np.zeros_like(y)
        for k in sorted(set(fold)):
            train, test = np.flatnonzero(fold!=k), np.flatnonzero(fold==k)
            assert set(ids[train]).isdisjoint(ids[test])
            inner = StratifiedKFold(min(4,min(counts(y[train]).values())),
                                    shuffle=True, random_state=42)
            candidates = list(product([10,5] if kind!="acoustic" else [0], [1.,10.],
                                      [0.] if kind=="unweighted" else
                                      ([0.5,1.] if kind=="weighted" else [0.,0.5,1.])))
            inner_predictions = {params: np.zeros_like(y[train]) for params in candidates}
            for a,b in inner.split(train, y[train]):
                fit, val = train[a], train[b]
                assert set(ids[fit]).isdisjoint(ids[val])
                blocks = representations(h, acoustic, fit, val, kind)
                for params in candidates:
                    inner_predictions[params][b] = ordinal_predict(blocks,y[fit],*params)
            best = max(candidates, key=lambda p: recall_score(y[train],inner_predictions[p],average="macro"))
            blocks = representations(h, acoustic, train, test, kind)
            pred[test] = ordinal_predict(blocks, y[train], *best)
            settings.append([kind,k,*best])
        predictions[kind] = pred

    def write(name, header, rows):
        with (out/name).open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(header)
            w.writerows(rows)

    write("tuning.csv", ["model","fold","hubert_pcs","alpha","weight_exponent"],settings)
    write("predictions.csv", ["speaker","fold","rating",*predictions],
          zip(ids,fold,y,*predictions.values()))
    matrices = []
    summary = []
    for name, pred in predictions.items():
        cm = confusion_matrix(y,pred,labels=LEVELS)
        matrices.extend([name,i,*row] for i,row in zip(LEVELS,cm))
        errors = np.abs(pred-y)
        summary.append([name,recall_score(y,pred,average="macro"),errors.mean(),
                        np.mean(errors==0),np.sum(errors>=2),cm[2,3],*cm.diagonal(),*cm.sum(axis=1)])
    write("comparison.csv",["model","macro_recall","MAE","exact_accuracy","errors_2plus",
                            "mild_to_normal",*[f"correct_{i}" for i in LEVELS],
                            *[f"count_{i}" for i in LEVELS]],summary)
    write("confusion_matrices.csv",["model","actual",*[f"predicted_{i}" for i in LEVELS]],matrices)


if __name__ == "__main__":
    import argparse
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("--compare", action="store_true", help="Reuse local downloads, embeddings and original folds")
    if parser.parse_args().compare:
        run_comparison()
    else:
        try:
            speakers, ratings, paths = collect()
        except PermissionError as error:
            raise SystemExit(f"{error}. See README.md for Synapse access and the rerun command.")
        evaluate(speakers, embed(paths), ratings, PRIVATE/"results")
