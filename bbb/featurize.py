"""Standardization and featurization for the BBB permeability model."""

from __future__ import annotations

import numpy as np
from rdkit import Chem, RDLogger
from rdkit.Chem import Crippen, Descriptors, rdFingerprintGenerator, rdMolDescriptors
from rdkit.Chem.MolStandardize import rdMolStandardize

RDLogger.DisableLog("rdApp.*")

MORGAN_RADIUS = 2
MORGAN_BITS = 2048
DESCRIPTOR_NAMES = ("mw", "logp", "tpsa", "hbd", "hba", "rotb")

_UNCHARGER = rdMolStandardize.Uncharger()
_LARGEST_FRAGMENT = rdMolStandardize.LargestFragmentChooser()
_MORGAN = rdFingerprintGenerator.GetMorganGenerator(radius=MORGAN_RADIUS, fpSize=MORGAN_BITS)


class UnparseableSmilesError(ValueError):
    def __init__(self, smiles: str, detail: str = "") -> None:
        self.smiles = smiles
        suffix = f" {detail}" if detail else ""
        super().__init__(
            f"RDKit could not parse {smiles!r} as a molecule.{suffix} "
            "Expected a SMILES string such as 'Nc1nc2ccc(OC(F)(F)F)cc2s1' "
            "(riluzole), not a drug name."
        )


def standardize(smiles: str):
    if not isinstance(smiles, str) or not smiles.strip():
        raise UnparseableSmilesError(smiles, "Input was empty.")
    mol = Chem.MolFromSmiles(smiles.strip())
    if mol is None:
        raise UnparseableSmilesError(smiles)
    try:
        mol = _LARGEST_FRAGMENT.choose(mol)
        mol = rdMolStandardize.Cleanup(mol)
        mol = _UNCHARGER.uncharge(mol)
    except Exception as exc:
        raise UnparseableSmilesError(smiles, f"Standardization failed: {exc}") from exc
    if mol is None or mol.GetNumAtoms() == 0:
        raise UnparseableSmilesError(smiles, "Nothing left after salt stripping.")
    return mol


def standardize_or_none(smiles: str):
    try:
        return standardize(smiles)
    except UnparseableSmilesError:
        return None


def canonical_smiles(mol) -> str:
    return Chem.MolToSmiles(mol)


def descriptors(mol) -> dict[str, float]:
    return {
        "mw": round(float(Descriptors.MolWt(mol)), 2),
        "logp": round(float(Crippen.MolLogP(mol)), 2),
        "tpsa": round(float(rdMolDescriptors.CalcTPSA(mol)), 2),
        "hbd": int(rdMolDescriptors.CalcNumHBD(mol)),
        "hba": int(rdMolDescriptors.CalcNumHBA(mol)),
        "rotb": int(rdMolDescriptors.CalcNumRotatableBonds(mol)),
    }


def fingerprint_bits(mol) -> np.ndarray:
    return np.asarray(_MORGAN.GetFingerprintAsNumPy(mol), dtype=np.uint8)


def featurize(mol) -> np.ndarray:
    desc = np.array([descriptors(mol)[k] for k in DESCRIPTOR_NAMES], dtype=float)
    fp = fingerprint_bits(mol).astype(float)
    return np.concatenate([desc, fp])
