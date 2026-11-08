"""Generate whole-passage samples and force-align the known synthesized reference."""
import json
import re
import subprocess
import numpy as np
from pocketsphinx import Decoder
from engine import ROOT, waveform
from passages import PASSAGES

folder = ROOT/"samples"
folder.mkdir(exist_ok=True,parents=True)
for i,(_,passage,edited) in enumerate(PASSAGES):
    prefix = f"p{i}-" if i else ""
    for name,rate,text in [("baseline",170,passage),("slower",127,passage),
                           ("edited",170,edited),("reference",150,passage)]:
        path=folder/f"{prefix}{name}.wav"
        subprocess.run(["say","-v","Samantha","-r",str(rate),"-o",str(path),
                        "--data-format=LEI16@16000",text],check=True)
    tokens=re.findall("[a-z]+",passage.lower())
    dec=Decoder(samprate=16000,loglevel="FATAL")
    dec.set_align_text(" ".join(tokens))
    dec.start_utt()
    dec.process_raw(np.rint(waveform(path.read_bytes())*32767).astype("<i2").tobytes(),False,True)
    dec.end_utt()
    seg=[(re.sub(r"\(\d+\)$","",s.word),s.start_frame/100,(1+s.end_frame)/100)
         for s in dec.seg() if not s.word.startswith(("<","["))]
    if [s[0] for s in seg]!=tokens: raise RuntimeError("Reference alignment failed: "+passage)
    (folder/f"{prefix}reference.json").write_text(json.dumps([s[1:] for s in seg]))
