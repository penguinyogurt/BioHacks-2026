"""Offline transcription, occurrence-aware edit alignment, and MFCC-DTW."""
import io
import json
import math
import re
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy.fft import dct
from scipy.io import wavfile
from scipy.signal import resample_poly
from scipy.spatial.distance import cdist
from pocketsphinx import Decoder
from vosk import KaldiRecognizer, Model, SetLogLevel

ROOT = Path(__file__).resolve().parents[1] / "private" / "speech_demo"
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


def boundaries(pcm,spoken):
    if not spoken:
        return []
    dec=Decoder(samprate=SR,loglevel="FATAL")
    try:
        dec.set_align_text(" ".join(spoken))
        dec.start_utt()
        dec.process_raw(pcm,False,True)
        dec.end_utt()
        segments=[s for s in (dec.seg() or []) if not s.word.startswith(("<","["))]
        if [re.sub(r"\(\d+\)$","",s.word) for s in segments]==spoken:
            return [(s.start_frame/100,(1+s.end_frame)/100) for s in segments]
    except RuntimeError:
        pass
    return [None]*len(spoken)


@lru_cache(8)
def inspect(blob):
    x=waveform(blob)
    pcm=np.rint(x*32767).astype("<i2").tobytes()
    heard=recognize(pcm)
    spoken=[w["word"] for w in heard]
    ops,ambiguous=edits(WORDS,spoken)
    # Align the edit-resolved passage: omit absent words, retain spoken replacements
    # and insertions. Never force a missing expected word onto neighboring audio.
    spans=boundaries(pcm,spoken)
    rows=[]; events=[]
    last=0.
    for i,j,op in ops:
        if j is None:
            row=dict(word=WORDS[i],heard=None,status=op,span=None,time=[last,last],
                     reason="Skipped; estimated position after previous word")
        else:
            h=heard[j]; a,b=h["start"],h["end"]; last=b
            span=spans[j]
            reason=None
            if i in ambiguous:
                reason="Ambiguous occurrence"
            elif span is None or h["conf"]<.55:
                reason="Low alignment confidence"
            else:
                s,e=span
                overlap=max(0,min(b,e)-max(a,s))/max(.001,max(b,e)-min(a,s))
                if overlap<.45 or max(abs(a-s),abs(b-e))>.18 or not .05<=e-s<=2:
                    reason="Uncertain word boundaries"
            row=dict(word=None if i is None else WORDS[i],heard=h["word"],status=op,
                     span=list(span) if not reason and span else None,time=[a,b],reason=reason)
        if i is not None:
            rows.append(row)
        if op!="match":
            events.append(row)
    return dict(transcript=" ".join(spoken),rows=rows,events=events),x


def mfcc(x):
    # Exclude coefficient zero to reduce gain dependence; keep spectral shape.
    frames=np.lib.stride_tricks.sliding_window_view(x,400)[::160]
    power=np.abs(np.fft.rfft(frames*np.hanning(400),512))**2
    hz=np.fft.rfftfreq(512,1/SR)[:,None]
    edges=700*np.expm1(np.linspace(0,np.log1p(8000/700),42))
    bank=np.maximum(0,np.minimum((hz-edges[:-2])/np.diff(edges)[:-1],
                                  (edges[2:]-hz)/np.diff(edges)[1:]))
    return dct(np.log(np.maximum(power@bank,1e-9)),norm="ortho",axis=1)[:,1:14]


def deviation(a,b):
    local=cdist(mfcc(a),mfcc(b))
    n,m=local.shape
    cost=np.full((n+1,m+1),np.inf); length=np.zeros_like(cost,int)
    cost[0,0]=0.
    for i in range(1,n+1):
        for j in range(1,m+1):
            if abs((i-1)/max(1,n-1)-(j-1)/max(1,m-1)) > .2+1/min(n,m):
                continue
            u,v=min(((i-1,j-1),(i-1,j),(i,j-1)),key=lambda p:cost[p])
            cost[i,j]=cost[u,v]+local[i-1,j-1]
            length[i,j]=1+length[u,v]
    return float(cost[n,m]/length[n,m])


def compare(base,repeat):
    ref,x=inspect(base); rep,y=inspect(repeat)
    scores=[]
    for a,b in zip(ref["rows"],rep["rows"]):
        out=dict(distance=None,change=None)
        if a["span"] and b["span"]:
            s,e=a["span"]; t,u=b["span"]
            out=dict(distance=deviation(x[round(SR*s):round(SR*e)],y[round(SR*t):round(SR*u)]),
                     change=round(1000*((u-t)-(e-s))))
        scores.append(out)
    return dict(baseline=ref,repeat=rep,scores=scores,passage=PASSAGE)
