# DRKG queries for ALS research

From the BioHacks root, run with Python 3.9+ and NumPy:

```sh
python3 backend/query-generation/run.py --top-k 100
```

The first run downloads the official DRKG TransE-L2 release and two terminology tables. The loader checks SHA-256 hashes of the graph, ID mappings, glossary, matrices and terminology. Subsequent runs reuse those files. Internet access refreshes the documentary checks on provisional leaders. `--offline` uses the local data and adjudicated records. No credentials are required. [DRKG release](https://github.com/gnn4dr/DRKG) · [MeSH descriptors](https://www.nlm.nih.gov/databases/download/mesh.html) · [Hetionet nodes](https://github.com/hetio/hetionet/tree/main/hetnet/tsv)

Open `reports/alex-gated-research/summary.md` for the shortlist, individual dossiers and one worked query per agent. `reports/alex-gated.json` holds every computed distance, trial record, eligibility decision, review and rank. The generated files and downloaded inputs stay local. [Saved Alex run](snapshots/alex-gated-research/summary.md)

## Eligibility before scoring

The versioned `examples/als-study-cache.json` contains adjudicated primary studies, tested ingredient aliases, dosage forms, co-treatments, populations, study status, clinical results and sources. A study must document administration in a human ALS interventional cohort. Positive, negative, inconclusive and unreported outcomes can all meet the exposure criterion. Results are specific to the tested population, endpoint and formulation.

The gate normalizes case, punctuation and explicit aliases. It checks each identified ingredient of a combination separately. It never strips salts, infers an ingredient from a class or transfers a trial to a different preparation. Each reviewed alias has a canonical DrugBank ID. Missing evidence means testing status is unknown. This is a curated evidence snapshot with bounded coverage. To extend it, add an exact ingredient identity and a qualifying administration record with a primary citation. Use `--trials` to select a different snapshot.

The workflow intersects that evidence with canonical IDs in the frozen release, then separates established ALS comparators and applies the patient-specific exclusions. All five concurrent agents, the strict intersection and the fallback receive the same immutable investigational pool. Neither trial results nor eligibility queries consume a DRKG distance.

## From record to query

`--profile` takes a case ID, a source URL, short source quotations in `facts` and optional source locations in `pointers`. The structured fields cover diagnosis, genotype, current therapy, respiratory function, weight, muscle, swallowing, hand function and other symptoms. The example quotes the project's source record. Anchor IDs are derived at runtime. [Source case](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)

Terms resolve through MeSH descriptor names and entry terms, Hetionet gene and compound names, and reviewed ingredient aliases. All hits must exist in the frozen entity mapping. The resolver uses longest unique term matches and withholds negated or uncertain text. Coughing while drinking can suggest dysphagia for retrieval. The output labels this as a hypothesis. Numeric findings without an attributable mapping stay in the record for review.

| Agent | How it selects anchors and establishes support |
|---|---|
| Disease / indications | Resolve the diagnosis to MeSH. Reverse observed compound–disease treatment predicates. A supported drug has a corresponding typed edge. |
| Genes / targets | Ground an explicit gene if provided. Also traverse typed disease–gene association, causal mutation, course-modifying mutation and pathogenesis edges from the diagnosis. Keep every resulting gene with a target or binding relation. The chart need not establish a patient's genotype to explore disease-level biology. |
| Safety / interactions / class | Resolve current medication, then translate through its observed incoming and outgoing drug-interaction predicates. A suitability rank also requires documentary review and no unresolved exact-pair interaction edge. Preserve chart observations for conditional review. |
| Pathways / processes | Traverse the grounded genes into GO biological processes. Choose up to five by `linked_genes² / all_genes_in_process`, breaking ties by linked-gene count then process ID. This balances specificity and breadth before seeing drug scores. Project back through gene participation and compound target/binding. Retain compound–gene–process witnesses. |
| Symptoms / function | Resolve affirmative observations or labeled proxies and reverse observed treatment predicates. A numeric distance can exist even if no tested ingredient has the required supporting edge. |

Every translation uses the original 400-dimensional arrays. For an observed triple `(drug, r, target)`, use `q = e[target] − r`. For `(anchor, r, drug)`, use `q = e[anchor] + r`. Multi-hop paths add one signed relation per traversal. Each constructed query scores every eligible compound with Euclidean distance. The JSON records the quotation, source pointer, grounded entity IDs, derivation edges, relation names and row indices, directions, formula, scores and winning witness.

Multiple anchors denote alternative mechanistic hypotheses. A positive agent takes each drug's **smallest supported distance** and sorts ascending. This preserves one inspectable path and avoids averaging unrelated anchors into an unsupported vector. For safety, the closest risk query represents the strongest modeled concern. Only independently reviewed drugs receive a safety rank, ordered by that minimum distance descending. The model makes no safety inference from an absent edge or a large distance. It assumes adequate local delivery and uses no passive BBB feature.

## Strict ranking and fallback

First intersect all five supported top-100 lists. A missing list causes an explicit abstention. With five populated lists, a strict survivor's mean rank, worst rank and canonical ID determine its position. An empty strict result preserves its status and invokes a separately labeled research fallback.

The fallback evaluates the full eligible pool. Entry requires a cited disease, target or pathway query and supporting graph witness. Each supported category contributes

```text
(category weight / sum of all five weights) × (offset + 1) / (offset + rank) × coverage^exponent
```

Coverage is the fraction of the five weights carrying evidence. Missing categories contribute zero. The prespecified weights are 0.36 disease, 0.26 genes, 0.13 safety, 0.20 pathways and 0.05 symptoms. Offset is 10 and the default coverage exponent is zero. Use `--policy` to change these settings. A case-matched hard veto overrides all scores. A documented lesser concern costs 0.04 once. Negative clinical outcomes are reported explicitly. The resulting graph score is a research retrieval score and has no calibrated clinical meaning.

Provisional leaders receive a source review against the case, directed medication-pair graph checks and targeted Europe PMC searches. Search hits alone cannot adjudicate an interaction. Labels and primary studies are scoped to the reviewed formulation. `--review` sets the original exclusion screen and `--leader-review` selects case-matched adjudications. After each veto or deduction, the workflow examines challengers until their unpenalized score is strictly below the fifth accepted score, handling ties by canonical ID. It returns fewer than five if necessary. The output records changes, unresolved evidence, cost, Canadian availability, regulatory status and patient acceptance separately.

## Alex run

Of 10,551 canonical graph IDs, 19 had verified human ALS exposure in this cache. Alex's current riluzole and the established comparator edaravone were separated. Mexiletine and gabapentin met the original case exclusion screen. Tofersen had study evidence and no compound row in this release. The common investigational pool contained 15 IDs. The supported category counts were 9, 4, 1, 8 and 0. The symptoms agent grounded the swallowing observation but found no eligible treatment edge. Twelve IDs qualified for provisional fusion and five were returned. All five have unresolved safety. Minocycline's randomized trial documented faster functional decline. [Primary trial](https://pubmed.ncbi.nlm.nih.gov/17980667/)

Run the deterministic tests from this directory:

```sh
python3 -m unittest discover -s tests -v
```
