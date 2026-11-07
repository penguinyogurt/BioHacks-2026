from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem, Crippen, Descriptors, rdMolDescriptors

RDLogger.DisableLog("rdApp.*")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
TRAIN_MW_P99 = 1027.0
ORGANIC = {"H", "B", "C", "N", "O", "F", "Si", "P", "S", "Cl", "Se", "Br", "I"}
CACHE = ROOT / "data" / "molblock_cache.json"


class InvalidSmiles(ValueError):
    pass


def _model():
    try:
        m = importlib.import_module("bbb_model")
        for n in ("predict", "predict_smiles", "predict_one"):
            fn = getattr(m, n, None)
            if callable(fn):
                return fn
    except Exception:
        pass
    return None


def standardize(smiles: str):
    mol = Chem.MolFromSmiles((smiles or "").strip())
    if mol is None:
        raise InvalidSmiles("Could not parse that SMILES.")
    foreign = {a.GetSymbol() for a in mol.GetAtoms() if a.GetSymbol() not in ORGANIC}
    frags = Chem.GetMolFrags(mol, asMols=True, sanitizeFrags=True)
    if len(frags) > 1:
        mol = max(frags, key=lambda m: m.GetNumHeavyAtoms())
    reason = None
    if foreign:
        reason = f"Contains {', '.join(sorted(foreign))}; outside organic chemistry this model was trained on."
    elif not any(a.GetSymbol() == "C" for a in mol.GetAtoms()):
        reason = "No carbon in the parent fragment."
    return mol, reason


def descriptors(mol):
    return {
        "mw": round(Descriptors.MolWt(mol), 1),
        "logp": round(Crippen.MolLogP(mol), 2),
        "tpsa": round(rdMolDescriptors.CalcTPSA(mol), 1),
        "hbd": rdMolDescriptors.CalcNumHBD(mol),
        "hba": rdMolDescriptors.CalcNumHBA(mol),
        "rotb": rdMolDescriptors.CalcNumRotatableBonds(mol),
    }


def mpo_lite(d):
    def ramp(x, g, b):
        return 1.0 if x <= g else 0.0 if x >= b else (b - x) / (b - g)

    parts = {
        "cLogP": ramp(d["logp"], 3, 5),
        "MW": ramp(d["mw"], 360, 500),
        "TPSA": 1.0 if 40 <= d["tpsa"] <= 90 else 0.5 if d["tpsa"] < 120 else 0.0,
        "HBD": ramp(d["hbd"], 0.5, 3.5),
    }
    return {"score": round(sum(parts.values()), 2), "max": 4, "parts": parts}


def molblock(mol):
    try:
        cache = {}
        if CACHE.exists():
            cache = json.loads(CACHE.read_text())
        smi = Chem.MolToSmiles(mol)
        if smi in cache:
            return cache[smi]
        mh = Chem.AddHs(Chem.Mol(mol))
        if AllChem.EmbedMolecule(mh, randomSeed=0xF00D, useRandomCoords=True) != 0:
            return ""
        if mol.GetNumHeavyAtoms() <= 150:
            try:
                AllChem.MMFFOptimizeMolecule(mh, maxIters=200)
            except Exception:
                pass
        block = Chem.MolToMolBlock(mh)
        cache[smi] = block
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(cache))
        return block
    except Exception:
        return ""


def predict(smiles: str) -> dict:
    mol, inorganic = standardize(smiles)
    desc = descriptors(mol)
    mpo = mpo_lite(desc)
    fn = _model()
    if fn:
        try:
            raw = fn(smiles) or {}
            src = "bbb_model.py"
        except Exception as e:
            raw = {"prob": mpo["score"] / 4, "in_domain": True, "error": str(e)}
            src = "CNS-MPO-lite fallback (B errored)"
    else:
        raw = {"prob": mpo["score"] / 4, "in_domain": True}
        src = "CNS-MPO-lite rule baseline (B not wired)"

    in_domain = bool(raw.get("in_domain", True))
    refusal = raw.get("refusal")
    if inorganic:
        in_domain, refusal = False, inorganic
    elif desc["mw"] > TRAIN_MW_P99:
        in_domain, refusal = False, f"MW {desc['mw']:,.0f} Da exceeds training-set 99th percentile ({TRAIN_MW_P99:,.0f} Da)."
    prob = raw.get("prob")
    prob = float(prob) if in_domain and isinstance(prob, (int, float)) else None
    return {
        "smiles": Chem.MolToSmiles(mol),
        "input_smiles": smiles,
        "inchikey": Chem.MolToInchiKey(mol),
        "prob": prob,
        "in_domain": in_domain,
        "refusal": refusal,
        "nearest_tanimoto": raw.get("nearest_tanimoto"),
        "descriptors": desc,
        "mpo_lite": mpo,
        "molblock": molblock(mol),
        "model_source": src,
        "warning": raw.get("error"),
    }


def model_available():
    return _model() is not None
