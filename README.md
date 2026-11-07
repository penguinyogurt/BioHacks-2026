# BioHacks 2026 — BBB permeability (component B)

Predicts blood–brain barrier permeability from SMILES. Outputs `data/bbb_scores.json`.

## Setup

```bash
pip install -r requirements.txt
```

## Train (downloads B3DB to `data/raw/`)

```bash
python bbb_model.py train
```

Artifacts: `artifacts/bbb_model.joblib`, `artifacts/bbb_metrics.json`.

## Score candidates and ALS trial graveyard

```bash
python bbb_model.py score
```

## Predict one SMILES

```python
from bbb_model import predict_smiles
predict_smiles("Nc1nc2ccc(OC(F)(F)F)cc2s1")
```

## Metrics (scaffold split, 5 seeds)

See `artifacts/bbb_metrics.json`. Random-split contrast included for slides.

## External B3clf comparison

```bash
python3 scripts/build_external_set.py
python3 scripts/b3clf_benchmark.py
```
