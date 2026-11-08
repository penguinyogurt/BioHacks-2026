"""BBBP structures absent from B3DB -> data/external_bbbp.json"""
import json, sys, urllib.request
from collections import defaultdict
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from bbb.featurize import canonical_smiles, standardize_or_none
from bbb.train import fetch_b3db

BBBP_URL = "https://deepchemdata.s3.us-west-1.amazonaws.com/datasets/BBBP.csv"
OUT = ROOT / "data" / "external_bbbp.json"

def main():
    b3db = pd.read_csv(fetch_b3db(), sep="\t")
    keys = {}
    for smi, lab in zip(b3db["SMILES"], b3db["BBB+/BBB-"]):
        m = standardize_or_none(smi)
        if m is not None:
            keys[canonical_smiles(m)] = 1
    if not (ROOT / "data/raw/BBBP.csv").exists():
        urllib.request.urlretrieve(BBBP_URL, ROOT / "data/raw/BBBP.csv")
    bbbp = pd.read_csv(ROOT / "data/raw/BBBP.csv")
    groups = defaultdict(list)
    names = {}
    for _, row in bbbp.iterrows():
        m = standardize_or_none(str(row["smiles"]))
        if m is None:
            continue
        k = canonical_smiles(m)
        if standardize_or_none(k) is None:
            continue
        groups[k].append(int(row["p_np"]))
        names[k] = str(row["name"])
    absent = [k for k in groups if k not in keys and len(set(groups[k])) == 1]
    compounds = [{"name": names[k], "smiles": k, "label": groups[k][0]} for k in sorted(absent)]
    OUT.write_text(json.dumps({"compounds": compounds, "n": len(compounds)}, indent=2) + "\n")
    print(len(compounds), OUT)

if __name__ == "__main__":
    main()
