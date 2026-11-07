"""Frozen PANNs CNN6 through block 4, with the checkpoint's exact frontend filters."""
import csv
import hashlib
import math
import os
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from scipy.signal import resample_poly
from torch.nn import functional as F
from speech_severity import PRIVATE, TASKS

OUT = PRIVATE / "panns"
MD5 = "e25e26b84585b14c7754c91e48efc9be"
CACHE = OUT / ("sequences-v1-" + MD5)


def reference():
    with (PRIVATE/"results"/"predictions.csv").open() as f:
        return list(csv.DictReader(f))


class FrozenCNN6:
    def __init__(self, device):
        path = OUT/"cnn6.pth"
        if hashlib.md5(path.read_bytes()).hexdigest() != MD5:
            raise ValueError("Unexpected checkpoint checksum; see PANNS.md")
        self.w = torch.load(path, map_location=device, weights_only=True)["model"]
        self.device = device

    def bn(self, x, name):
        w = self.w
        return F.batch_norm(x, w[name+".running_mean"], w[name+".running_var"],
                            w[name+".weight"], w[name+".bias"], training=False)

    @torch.inference_mode()
    def extract(self, path):
        audio, sr = sf.read(path, dtype="float32", always_2d=True)
        g = math.gcd(32000, sr)
        mono = resample_poly(audio.mean(axis=1), 32000//g, sr//g)
        x = torch.from_numpy(mono).to(self.device)[None,None,:]
        x = F.pad(x, (512,512), mode="reflect")
        stft = "spectrogram_extractor.stft."
        power = sum(F.conv1d(x,self.w[stft+k+".weight"],stride=320).square()
                    for k in ("conv_real","conv_imag"))
        mel = power.transpose(1,2) @ self.w["logmel_extractor.melW"]
        x = (10*mel.clamp_min(1e-10).log10()).unsqueeze(1)
        x = self.bn(x.transpose(1,3),"bn0").transpose(1,3)
        for i in range(1,5):
            block = f"conv_block{i}"
            x = F.conv2d(x,self.w[block+".conv1.weight"],padding=2)
            x = F.avg_pool2d(F.relu(self.bn(x,block+".bn1")),2)
        return x.mean(dim=3)[0].T.contiguous().cpu().numpy()


def load_sequences(rows):
    CACHE.mkdir(parents=True,exist_ok=True)
    model = None
    speakers = []
    for i,row in enumerate(rows):
        recordings = []
        for task in TASKS:
            path = PRIVATE/"data"/task/f"{row['speaker']}_{task}.wav"
            key = hashlib.sha256(path.read_bytes()).hexdigest()
            dest = CACHE/(key+".npy")
            if not dest.exists():
                if model is None:
                    model = FrozenCNN6("mps" if torch.backends.mps.is_available() else "cpu")
                seq = model.extract(path)
                with dest.with_suffix(".tmp").open("wb") as f:
                    np.save(f,seq)
                dest.with_suffix(".tmp").replace(dest)
            seq = np.load(dest,allow_pickle=False)
            assert seq.ndim==2 and seq.shape[1]==512 and len(seq)>0 and np.isfinite(seq).all()
            recordings.append(torch.from_numpy(seq))
        speakers.append(recordings)
        if (i+1)%20==0:
            print("Sequences ready for",i+1,"speakers",flush=True)
    return speakers


if __name__=="__main__":
    os.umask(0o077)
    load_sequences(reference())
