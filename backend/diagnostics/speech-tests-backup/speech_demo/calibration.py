"""Personal passage calibration; only derived profiles are saved on this Mac."""
import hashlib
import json
import os
from pathlib import Path

import numpy as np
from engine import ROOT, SR, WORDS, inspect

PROFILE = ROOT / "calibration-v1.json"
MIN_WORDS = 7
EDGES = np.geomspace(80, 8000, 33)
FREQ = np.fft.rfftfreq(512, 1/SR)
STEP = SR/512
BANK = np.maximum(0, np.minimum(FREQ[:,None]+STEP/2, EDGES[1:]) -
                  np.maximum(FREQ[:,None]-STEP/2, EDGES[:-1])) / STEP


def fingerprint(blob):
    reading, audio = inspect(blob)
    bands = []
    for row in reading["rows"]:
        spectrum = None
        if row["span"]:
            a,b = (round(v*SR) for v in row["span"])
            word = audio[a:b]
            frames = np.lib.stride_tricks.sliding_window_view(word,400)[::160]
            power = abs(np.fft.rfft(frames*np.hanning(400),512))**2
            energy = power.mean(axis=0) @ BANK
            if energy.max()>1e-12:
                spectrum = (10*np.log10(np.maximum(1e-6,energy/energy.max()))).tolist()
        bands.append(spectrum)
    return {"id":hashlib.sha256(audio.astype("<f4").tobytes()).hexdigest(),"bands":bands}


def load(path=None):
    path = path or PROFILE
    return json.loads(path.read_text()) if path.exists() else []


def save(entries,path=None):
    path = path or PROFILE
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(entries,allow_nan=False))
    os.replace(temp,path)


def status(entries):
    return {"count":len(entries),"ready":len(entries)==10}


def score(entries, reading):
    # Accumulate each word's error and both anchors on exactly the same words.
    error = low = high = 0.
    included = []
    for i,word in enumerate(reading["bands"]):
        normal = [s["bands"][i] for s in entries[:5] if s["bands"][i] is not None]
        extreme = [s["bands"][i] for s in entries[5:] if s["bands"][i] is not None]
        if word is None or min(len(normal),len(extreme))<3:
            continue
        center = np.mean(normal,axis=0)
        low += np.abs(normal-center).mean()
        high += np.abs(extreme-center).mean()
        error += np.abs(word-center).mean()
        included.append(i)
    out = dict(words=len(included),total=len(WORDS),included=included,value=None)
    if len(included)<MIN_WORDS:
        return dict(out,reason="Too few reliably comparable words. Try the full passage again.")
    if high-low <= 0.1*len(included):
        return dict(out,reason="The two calibration anchors are too close or reversed on these words.")
    raw = 1 + 99*(error-low)/(high-low)
    return dict(out,value=float(np.clip(raw,1,100)),raw=float(raw),error=error,normal=low,extreme=high)


def accept(entries,reading,expected,path=None):
    if len(entries)!=expected or len(entries)>=10:
        raise ValueError("Calibration has changed. Reload to see the current step.")
    if any(s["id"]==reading["id"] for s in entries):
        raise ValueError("This recording was already saved. Make a new reading.")
    if sum(v is not None for v in reading["bands"])<MIN_WORDS:
        raise ValueError("Fewer than seven words aligned reliably. Please read the full passage again.")
    updated=entries+[reading]
    if len(updated)==10:
        # Validate the completed profile using all eligible word positions.
        check=score(updated,{"bands":[[0.]*32 for _ in WORDS]})
        if check["value"] is None:
            raise ValueError(check["reason"]+" Retake this example or restart calibration.")
    save(updated,path)
    return status(updated)

def draft_path():
    return PROFILE.with_name("calibration-draft.json")


def current_state():
    active=load()
    draft=draft_path()
    return dict(status(active),draft_count=len(load(draft)) if draft.exists() else None)


def accept_take(reading,step,replacing):
    draft=draft_path()
    if replacing:
        if len(load())!=10 or not draft.exists():
            raise ValueError("Recalibration is no longer active. Reload the page.")
        state=accept(load(draft),reading,step,draft)
        if state["ready"]:
            os.replace(draft,PROFILE)
    else:
        accept(load(),reading,step)
    return current_state()
