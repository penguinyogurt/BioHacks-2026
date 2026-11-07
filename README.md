# Patient-constrained drug repurposing for ALS

Rank approved drugs against ALS biology, then disqualify the ones that are unsafe or
unusable for one specific patient. Five stages, and every surviving drug carries a
record of what it passed.

| # | Stage | Question | Removes |
|---|-------|----------|---------|
| 1 | Universe | Which drugs are approved and available? | nothing, this is the input set |
| 2 | KG relevance | Does it touch ALS biology? | no path to ALS in the knowledge graph |
| 3 | BBB gate | Can it physically reach the target tissue? | wrong side of the barrier for its target |
| 4 | Patient filter | Is it safe and usable for Alex? | interactions, his vulnerabilities, routes he cannot manage |
| 5 | Trial history | Has this already been tried and failed? | known failures, flagged rather than silently dropped |

## Layout

```
data/            JSON artifacts, one per module. data/raw/ holds downloads and is gitignored
src/             the modules; nobody imports anybody else's, integration is through files
app/             the frontend. Reads data/pipeline.json and nothing else
artifacts/       cached intermediates (crosswalk, model pickles, metrics)
```

| Module | Writes | Owner |
|--------|--------|-------|
| `src/kg_rank.py` | `data/kg_scores.json` | E1 |
| `src/bbb_model.py` | `data/bbb_scores.json` | E2 |
| `src/patient_filter.py` | `data/patient_filter.json` | E3 |
| `src/merge.py` | `data/pipeline.json` | E4 |
| `app/` | — | E4 |

## Run it

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
```

`requirements.txt` is pinned and verified to co-install on Python 3.12. The package is
`rdkit`, never `rdkit-pypi`; installing both gives you two RDKits and an import that
silently resolves to the wrong one.

## The output contract

`data/pipeline.json` is the only file the frontend reads, and its shape is frozen. The
version committed here is a hand-written 5-drug sample (`meta.is_sample: true`) with real
InChIKeys and SMILES and placeholder scores, so UI work starts before any model exists.
`src/merge.py` overwrites it with the real run.

Check any candidate file against the contract:

```bash
python -m src.contract              # validates data/pipeline.json
python -m src.contract other.json
```

Shape notes that matter to the frontend:

- Eliminated candidates stay in `candidates`, with `verdict: "eliminated"` and
  `eliminated_at` naming the stage that removed them. The UI needs them to animate cards
  leaving, and the graveyard needs them.
- `filters` is an ordered list, not a map, so the UI shows rules in order and highlights
  the first failure.
- `bbb.in_domain: false` must suppress the probability in the UI entirely. Do not display
  a number the model cannot stand behind.

## Data sources

| Source | What it gives us | Licence |
|--------|------------------|---------|
| DRKG | ~97k nodes, ~5.8M typed triples, plus pretrained TransE embeddings | Apache 2.0 |
| B3DB | 7,982 compounds labelled BBB+/BBB−, 1,058 with numeric logBB | CC0 |
| DrugCentral | ~4,805 approved substances, targets, formulations, drug–adverse-event links | CC BY-SA 4.0 |
| repoDB | approved and failed drug–disease pairs | — |
| Health Canada DPD | whether a drug is actually available in Ontario | open |

Two joins that will cost an hour each if done wrong:

1. **Find the ALS node in DRKG by grepping, not guessing.** Disease nodes use several
   ontologies, and the `treats` edges only use one of them.
2. **Join on structure, not names.** DRKG uses DrugBank ids, B3DB uses SMILES,
   DrugCentral uses its own ids. One crosswalk table keyed on an RDKit-computed InChIKey.
   Name matching silently loses half the drugs.
