"""Offline checks on the installed whole-passage samples."""
import numpy as np
from engine import ROOT, WORDS, compare, edits

samples=ROOT/"samples"
def read(name):
    return (samples/(name+".wav")).read_bytes()

base=read("baseline")
for name in ("baseline","slower","edited"):
    result=compare(base,read(name))
    rows=result["repeat"]["rows"]
    scores=result["scores"]
    valid=[s for s in scores if s["distance"] is not None]
    assert len(rows)==len(WORDS) and len(valid)>=8
    for row,s in zip(rows,scores):
        if row["reason"]:
            assert s["distance"] is None
    if name=="baseline":
        assert all(s["distance"]<1e-8 and s["change"]==0 for s in valid)
    if name=="slower":
        assert np.median([s["change"] for s in valid])>0
    if name=="edited":
        assert rows[1]["status"]=="omission" and scores[1]["distance"] is None
        assert rows[9]["heard"]=="door" and rows[9]["status"]=="substitution"
    occurrences=[rows[i] for i,w in enumerate(WORDS) if w=="the"]
    assert len(occurrences)==4 and all(r["heard"]=="the" for r in occurrences)
    assert all(a["time"][1]<=b["time"][0] for a,b in zip(occurrences,occurrences[1:]))
    print(name,len(valid),"scored; median duration change",np.median([s["change"] for s in valid]),"ms")
ops,amb=edits("the red bird saw the tree".split(),"the red bird saw a tall tree".split())
assert any(op=="insertion" for _,_,op in ops)
assert edits(["the","the"],["the"])[1]=={0,1}
