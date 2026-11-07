from __future__ import annotations

from .featurize import descriptors


def pajouhesh_lenz(mol) -> int:
    d = descriptors(mol)
    return int(d["mw"] < 450 and d["tpsa"] < 90 and d["hbd"] < 3 and d["hba"] < 7 and d["logp"] < 5)


def rule_scores(mols):
    import numpy as np
    return np.array([pajouhesh_lenz(m) for m in mols], dtype=int)
