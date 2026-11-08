"""Local unprompted recognition and occurrence-aware transcript alignment."""
import io
import json
import math
import re
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly
from vosk import KaldiRecognizer, Model, SetLogLevel

ROOT = Path(__file__).resolve().parent / "private" / "speech_demo"
PASSAGE = "The morning light filled the room. We opened the window and watched the birds."
WORDS = re.findall("[a-z]+", PASSAGE.lower())
SR = 16000
SetLogLevel(-1)


@lru_cache(1)
def model():
    return Model(str(ROOT/"vosk-model-small-en-us-0.15"))


def waveform(blob):
    sr,x = wavfile.read(io.BytesIO(blob))
    if not 4000 <= sr <= 192000 or not 0.2 <= len(x)/sr <= 60:
        raise ValueError("Use a WAV between 0.2 and 60 seconds.")
    if x.dtype == np.uint8:
        x = (x.astype(float)-128)/128
    elif x.dtype.kind == 'i':
        x = x.astype(float)/float(2**(8*x.dtype.itemsize-1))
    if x.ndim==2:
        x = x.mean(axis=1)
    if not np.isfinite(x).all():
        raise ValueError("Invalid WAV samples.")
    g = math.gcd(sr,SR)
    return resample_poly(x.astype(float),SR//g,sr//g).clip(-1,1)


def recognize(pcm):
    # No grammar, passage, expected tokens or language-model adaptation.
    rec = KaldiRecognizer(model(), SR)
    rec.SetWords(True)
    words = []
    for pos in range(0,len(pcm),8000):
        if rec.AcceptWaveform(pcm[pos:pos+8000]):
            words.extend(json.loads(rec.Result()).get("result",[]))
    return words+json.loads(rec.FinalResult()).get("result",[])


def edits(expected,actual):
    """Trace minimum word edits; mark positions with competing optimal mappings."""
    n,m = len(expected),len(actual)
    def costs(e,a):
        d=np.zeros((len(e)+1,len(a)+1),int)
        d[:,0]=np.arange(len(e)+1)
        d[0]=np.arange(len(a)+1)
        for i,w in enumerate(e,1):
            for j,v in enumerate(a,1):
                d[i,j]=min(d[i-1,j]+1,d[i,j-1]+1,d[i-1,j-1]+(w!=v))
        return d
    d=costs(expected,actual)
    rev=costs(expected[::-1],actual[::-1])[::-1,::-1]
    ambiguous=set()
    for i,w in enumerate(expected):
        options={j for j,v in enumerate(actual) if d[i,j]+(w!=v)+rev[i+1,j+1]==d[n,m]}
        if any(d[i,j]+1+rev[i+1,j]==d[n,m] for j in range(m+1)):
            options.add(None)
        if len(options)>1:
            ambiguous.add(i)
    ops=[]
    i,j=n,m
    while i or j:
        if i and j and d[i,j]==d[i-1,j-1]+(expected[i-1]!=actual[j-1]):
            i-=1; j-=1
            ops.append((i,j,"match" if expected[i]==actual[j] else "substitution"))
        elif i and d[i,j]==d[i-1,j]+1:
            i-=1
            ops.append((i,None,"omission"))
        else:
            j-=1
            ops.append((None,j,"insertion"))
    return ops[::-1],ambiguous
