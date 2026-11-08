# Blinded top-five validation

Run from `backend/validation` with Python 3.9+. A coordinator prepares packets, two reviewers judge the drugs independently, and the coordinator scores the returned sheets. This CLI reads exports and has no ranking-backend dependency.

## Real exports

Set `D` to an existing private directory outside the checkout. Use a fresh output directory for each round. Export both methods against the same post-exclusion pool and select the seed before inspecting the draw.

```sh
D="$HOME/biohacks-private/validation"
python3 validate.py prepare --backend "$D/backend.csv" --baseline "$D/baseline.csv" --pool "$D/pool.csv" --evidence "$D/evidence.csv" --case "$D/alex.txt" --seed 42 --out "$D/round"
```

Give each reviewer only their own copy of the reviewer directory. Both copies contain the same names, case, evidence, questions and blank sheet. Keep the seed, random draw, method exports and private key with the coordinator. Once each reviewer returns their completed CSV, run:

```sh
python3 validate.py score --key "$D/round/private-key.json" --first "$D/returned-1.csv" --second "$D/returned-2.csv" --out "$D/result.json"
```

## Inputs and blinding

Use UTF-8 CSV with the exact headers below. IDs use the frozen graph format `Compound::DB12345`. Resolve aliases before export.

| File | Header or format |
|---|---|
| backend.csv, baseline.csv | `compound_id`. One row per returned drug in original rank order, up to five. A header alone means zero returned. |
| pool.csv | `compound_id,name`. One row per eligible compound after the shared hard safety exclusions. |
| evidence.csv | `compound_id,supporting,contrary,unknowns,citations`. One row per selected drug required. Preparing the whole pool allows any seed. Use explicit unknowns. |
| alex.txt | Common de-identified case in plain text. |
| review.csv | `packet,neutral_id,reviewer,als_answer,als_rationale,als_experiment,als_readout,ultrasound_answer,ultrasound_rationale,ultrasound_experiment,ultrasound_readout,target_tissue,exposure_evidence` |

**Evidence collection protocol.** Use a method-blinded evidence preparer. For each ingredient search PubMed and ClinicalTrials.gov by generic name and synonyms with ALS, then PubMed with focused ultrasound, tissue exposure or target engagement. Budget 20 minutes per drug, ten for each question. Inspect up to five primary records per question, including negative or stopped studies. Record endpoints, formulation, tissue and conflicting findings with PMID, DOI or registry ID. Record search date and gaps in unknowns. Apply the same budget to every drug. Supply only factual summaries in the four evidence fields. The CLI copies free text verbatim, so manually check names, case, citations and evidence for source method, rank, graph scores and agent conclusions before distribution.

Controls are sampled without replacement from the entire sorted pool, including method selections. A pool smaller than five supplies every available control. The seed also drives shuffling after deduplication. The private key maps neutral IDs to canonical IDs and stores each ordered list (position one is original rank). Vacant slots stay vacant.

## Judgments and report

Use a distinct reviewer identifier per person. Enter yes, no, or insufficient evidence separately for each question, with a rationale. A yes requires an experiment and readout. An ultrasound yes also requires target tissue and compound-specific exposure evidence. Missing rows and completely blank question fields count as missing reviews. Packet fingerprints catch accidental mixing of different packets.

The private JSON report shows pairwise overlap as neutral-ID lists, and both answers per drug in sheet order (null means missing). For each method and question, endorsement requires two yes votes. The denominator is always five, including vacant slots. Insufficient counts cover returned drugs with either reviewer voting insufficient, plus counts per reviewer. Agreement is exact agreement over complete pairs, including matching insufficient votes. With zero pairs it is null. Missing votes and disagreements are listed separately. All methods inherit the same votes for a shared drug.

## Synthetic smoke test

All names, evidence and completed votes under `synthetic/` are invented software fixtures. From this directory:

```sh
T=$(mktemp -d)
python3 validate.py prepare --backend synthetic/backend.csv --baseline synthetic/baseline.csv --pool synthetic/pool.csv --case synthetic/case.txt --evidence synthetic/evidence.csv --seed 42 --out "$T/round"
python3 validate.py score --key "$T/round/private-key.json" --first synthetic/review-1.csv --second synthetic/review-2.csv --out "$T/results.json"
python3 -m unittest -v test_validation
```
