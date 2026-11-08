# Reassessment of previously tested ALS drugs

From the BioHacks root, run with Python 3.9+ and NumPy:

```sh
python3 backend/query-generation/run.py --top-k 100
```

The first run downloads the official DRKG TransE-L2 release and two terminology tables. The loader checks SHA-256 hashes of the graph, ID mappings, glossary, matrices and terminology. Subsequent runs reuse those files. Internet access refreshes the documentary checks for candidates with case review records or a potentially advancing human outcome. `--offline` uses the local data and adjudicated records. No credentials are required. [DRKG release](https://github.com/gnn4dr/DRKG) · [MeSH descriptors](https://www.nlm.nih.gov/databases/download/mesh.html) · [Hetionet nodes](https://github.com/hetio/hetionet/tree/main/hetnet/tsv)

Open `reports/alex-outcomes-research/summary.md` for the shortlist, individual dossiers and one worked query per agent. `reports/alex-outcomes.json` holds every computed distance, trial record, eligibility decision, review and rank. The generated files and downloaded inputs stay local. [Current Alex reassessment](snapshots/alex-outcomes-research/summary.md) · [Previous five finalists](snapshots/alex-gated-research/summary.md)

## Eligibility before scoring

The versioned `examples/als-study-cache.json` contains adjudicated primary studies, tested ingredient aliases, dosage forms, co-treatments, populations, study status, clinical results and sources. A study must document administration in a human ALS interventional cohort. Positive, negative, inconclusive and unreported outcomes can all meet the exposure criterion. Results are specific to the tested population, endpoint and formulation.

The gate normalizes case, punctuation and explicit aliases. It checks each identified ingredient of a combination separately. It never strips salts, infers an ingredient from a class or transfers a trial to a different preparation. Each reviewed alias has a canonical DrugBank ID. Missing evidence means testing status is unknown. This is a curated evidence snapshot with bounded coverage. To extend it, add an exact ingredient identity and a qualifying administration record with a primary citation. Use `--trials` to select a different snapshot.

The workflow intersects that evidence with canonical IDs in the frozen release, then separates established ALS comparators and applies the patient-specific exclusions. Untested ingredients stay outside the project. All five agents use the same immutable investigational pool to compute the patient-specific L2 audit. Before this calculation, the workflow reviews the study outcomes and assigns each ingredient an evidence category. Both advancement paths share the resulting evidence and case-safety gates.

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

Multiple anchors denote alternative mechanistic hypotheses. A positive agent takes each drug's **smallest supported distance** and sorts ascending. This preserves one inspectable path and avoids averaging unrelated anchors into an unsupported vector. For safety, the closest risk query represents the strongest modeled concern. Only independently reviewed drugs receive a safety rank, ordered by that minimum distance descending. The model makes no safety inference from an absent edge or a large distance. Passive BBB characteristics do not enter the graph score. Local exposure and focused-ultrasound delivery are separate evidence questions.

## Human evidence and advancement

The versioned [clinical review](examples/clinical-reassessment.json) records the design, population, formulation and route, primary endpoint, observed result, safety findings, other signals, and primary source for each abstracted report. It also records the Europe PMC and ClinicalTrials.gov search queries and hit IDs for the ingredient set. Some reports describe the same cohort. Adjudication compares endpoint, design and applicability without counting publications as independent votes. Primary human clinical results determine the category. Separate entries identify combination, biomarker, pharmacokinetic, observational, safety and exploratory findings. Animal findings stay in the contextual evidence. Searches are bounded and are dated in the cache. To incorporate a new study, update the exposure cache and its outcome abstraction. A newly verified trial without an abstraction holds advancement pending review. Use `--clinical` to select the review.

| Human evidence | Selection rule |
|---|---|
| Credible harm | Exclude after controlled evidence of worse clinical function or consequential comparative toxicity. Record the harm, population, regimen and source. |
| Negative clinical efficacy | Retain for reporting. Delivery research requires a separate source plausibly identifying inadequate exposure or engagement in the failed trial, and drug-specific evidence that the proposed change can correct that limitation at the same site. Generic ultrasound feasibility and unmeasured exposure earn no credit. |
| Inconclusive, conflicting, safety-only or biomarker-only | Hold. Preserve both directions of conflicting controlled evidence for the same clinical question. A symptom endpoint is identified separately from disease progression. |
| Favorable clinical endpoint | Eligible for research review on that clinical question after a documented case-specific safety pass. The dossier independently evaluates focused ultrasound. |

The safety review requires an exact chart match, explicit pass, a finding and cited sources confirmed by the review. A flagged medication pair additionally needs a documented adjudication. An unknown safety review cannot advance a drug. Case exclusions remain binding. Cost, Canadian availability, regulatory status and patient acceptance are reported separately.

## Internal ranking score

Five-agent ranks are calculated on the common reference pool for reproducible comparison with the previous run. Each dossier shows each agent's rank, normalized weight, contribution and missing evidence. Missing support contributes zero. The existing rank-fusion calculation is

```text
normalized agent weight × (offset + 1) / (offset + supported rank) × coverage^exponent
```

The normalized weights are 0.36 disease, 0.26 genes, 0.13 safety, 0.20 pathways and 0.05 symptoms. The default offset is 10, and the coverage exponent is zero. A sourced lesser concern deducts 0.04 once. `--policy` configures these values. The **internal ranking score** measures relative graph retrieval and has no probability interpretation.

Both selection paths start from the same drugs that passed the clinical and patient-safety rules. Each agent's eligible list gives precedence to favorable clinical evidence, followed by negative trials with a supported delivery rationale. Within a category it retains the agent's rank. Intersect the five top-K lists first. If the intersection is empty, the fallback considers the whole cleared pool. A qualifying human clinical or delivery finding supplies a sourced disease rationale even when every graph rank is missing. The clinical category precedes the internal ranking score on both paths, with canonical ID breaking ties. Both may return zero.

## Alex run

Nineteen of 10,551 frozen compound IDs met the verified-administration gate. Two established comparators and two case exclusions left 15 investigational drugs. Of those, **zero advanced**. Four had credible evidence of harm, nine had negative clinical outcomes without the two required delivery links, and two remained unresolved. The five prior finalists and their current dispositions are linked in the [saved summary](snapshots/alex-outcomes-research/summary.md). The shared human focused-ultrasound evidence concerns transient motor-cortex barrier opening in four ALS participants. [Primary feasibility study](https://pubmed.ncbi.nlm.nih.gov/31558719/)

Run the tests from this directory:

```sh
python3 -m unittest discover -s tests -v
```
