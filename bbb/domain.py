from __future__ import annotations

import numpy as np

TANIMOTO_THRESHOLD = 0.40
_POPCOUNT = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint16)


def pack_bits(bits: np.ndarray) -> np.ndarray:
    return np.packbits(np.asarray(bits, dtype=np.uint8), axis=-1)


def max_tanimoto(query_packed: np.ndarray, train_packed: np.ndarray, train_popcount: np.ndarray) -> tuple[float, int]:
    q = np.asarray(query_packed, dtype=np.uint8).reshape(1, -1)
    qpop = float(_POPCOUNT[q].sum())
    intersection = _POPCOUNT[np.bitwise_and(train_packed, q)].sum(axis=-1).astype(float)
    union = train_popcount + qpop - intersection
    with np.errstate(divide="ignore", invalid="ignore"):
        sims = np.where(union > 0, intersection / union, 0.0)
    nearest = int(np.argmax(sims))
    return float(sims[nearest]), nearest


def assess(nearest_tanimoto: float, mw: float, train_mw_p99: float) -> tuple[bool, str]:
    if mw > train_mw_p99:
        return False, (
            f"Molecular weight {mw:,.0f} Da exceeds the 99th percentile of the "
            f"training set ({train_mw_p99:,.0f} Da)."
        )
    if nearest_tanimoto < TANIMOTO_THRESHOLD:
        return False, (
            f"Nearest training compound has Tanimoto similarity "
            f"{nearest_tanimoto:.2f}, below the {TANIMOTO_THRESHOLD:.2f} cutoff."
        )
    return True, f"Nearest training compound has Tanimoto similarity {nearest_tanimoto:.2f}."
