from __future__ import annotations

import os
import threading
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable

import joblib
import numpy as np

from . import domain
from .baselines import pajouhesh_lenz
from .featurize import UnparseableSmilesError, canonical_smiles, descriptors, featurize, fingerprint_bits, standardize

DEFAULT_ARTIFACT = Path(__file__).resolve().parent.parent / "artifacts" / "bbb_model.joblib"
_LOCK = threading.Lock()
_CACHE: dict[Path, "BBBModel"] = {}


class ModelNotTrainedError(RuntimeError):
    pass


@dataclass
class Prediction:
    smiles: str
    canonical_smiles: str
    prob: float | None
    in_domain: bool
    nearest_tanimoto: float
    nearest_training_smiles: str
    descriptors: dict[str, float]
    call: str
    threshold: float
    domain_reason: str
    raw_prob: float
    rule_baseline: dict[str, Any] = field(default_factory=dict)

    def to_contract(self) -> dict[str, Any]:
        return {
            "prob": self.prob,
            "in_domain": self.in_domain,
            "nearest_tanimoto": self.nearest_tanimoto,
            "descriptors": self.descriptors,
        }

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class BBBModel:
    def __init__(self, bundle: dict[str, Any]) -> None:
        self._clf = bundle["model"]
        self.threshold = float(bundle["threshold"])
        self.metrics = bundle.get("metrics", {})
        self.train_mw_p99 = float(bundle["train_mw_p99"])
        self.version = bundle.get("version", "unknown")
        self._train_packed = bundle["train_fp_packed"]
        self._train_popcount = bundle["train_fp_popcount"].astype(float)
        self._train_smiles = bundle["train_smiles"]

    @property
    def n_train(self) -> int:
        return len(self._train_smiles)

    def predict(self, smiles: str) -> Prediction:
        mol = standardize(smiles)
        desc = descriptors(mol)
        bits = fingerprint_bits(mol)
        nearest_tanimoto, nearest_idx = domain.max_tanimoto(
            domain.pack_bits(bits), self._train_packed, self._train_popcount
        )
        in_domain, reason = domain.assess(nearest_tanimoto, desc["mw"], self.train_mw_p99)
        raw = float(self._clf.predict_proba(featurize(mol).reshape(1, -1))[0, 1])
        if in_domain:
            call = "BBB+" if raw >= self.threshold else "BBB-"
        else:
            call = "OUT_OF_DOMAIN"
        return Prediction(
            smiles=smiles,
            canonical_smiles=canonical_smiles(mol),
            prob=round(raw, 4) if in_domain else None,
            in_domain=in_domain,
            nearest_tanimoto=round(nearest_tanimoto, 4),
            nearest_training_smiles=self._train_smiles[nearest_idx],
            descriptors=desc,
            call=call,
            threshold=round(self.threshold, 4),
            domain_reason=reason,
            raw_prob=round(raw, 4),
            rule_baseline={"pajouhesh_lenz_pass": bool(pajouhesh_lenz(mol))},
        )


def load_model(path: str | os.PathLike | None = None) -> BBBModel:
    artifact = Path(path) if path else DEFAULT_ARTIFACT
    artifact = artifact.resolve()
    if artifact in _CACHE:
        return _CACHE[artifact]
    with _LOCK:
        if artifact in _CACHE:
            return _CACHE[artifact]
        if not artifact.exists():
            raise ModelNotTrainedError(f"No model at {artifact}. Run: python -m bbb.train")
        model = BBBModel(joblib.load(artifact))
        _CACHE[artifact] = model
        return model


def predict_smiles(smiles: str, model_path: str | os.PathLike | None = None) -> dict[str, Any]:
    return load_model(model_path).predict(smiles).to_dict()


def predict_many(smiles_list: Iterable[str], model_path: str | os.PathLike | None = None) -> list[dict[str, Any]]:
    model = load_model(model_path)
    out = []
    for smiles in smiles_list:
        try:
            out.append(model.predict(smiles).to_dict())
        except UnparseableSmilesError as exc:
            out.append({"smiles": smiles, "error": str(exc)})
    return out
