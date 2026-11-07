from __future__ import annotations

from collections import defaultdict

import numpy as np
from rdkit.Chem.Scaffolds import MurckoScaffold


def scaffold_of(mol) -> str:
    try:
        return MurckoScaffold.MurckoScaffoldSmiles(mol=mol, includeChirality=False)
    except Exception:
        return ""


def scaffold_split(mols, seed: int = 0, frac=(0.8, 0.1, 0.1)):
    groups = defaultdict(list)
    for i, mol in enumerate(mols):
        groups[scaffold_of(mol)].append(i)
    buckets = list(groups.values())
    order = np.random.default_rng(seed).permutation(len(buckets))
    n = len(mols)
    train, valid, test = [], [], []
    for gi in order:
        group = buckets[gi]
        if len(train) + len(group) <= frac[0] * n:
            train += group
        elif len(valid) + len(group) <= frac[1] * n:
            valid += group
        else:
            test += group
    return tuple(np.asarray(x, dtype=int) for x in (train, valid, test))


def random_split(mols, seed: int = 0, frac=(0.8, 0.1, 0.1)):
    n = len(mols)
    order = np.random.default_rng(seed).permutation(n)
    n_train, n_valid = int(frac[0] * n), int(frac[1] * n)
    return order[:n_train], order[n_train : n_train + n_valid], order[n_train + n_valid :]
