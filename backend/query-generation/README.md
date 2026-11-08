# ALS case coordinator and five research agents

Run the saved Sonnet/Haiku experiment from the BioHacks root:

```sh
cd backend/query-generation && .venv/bin/python run.py --offline --planner claude --medication-check
```

Open `reports/alex-coordinated-research/summary.md`. Each category has a `handoff/<category>/` directory with its brief, research/query trace and top-K ranking. The full JSON includes every distance for every eligible ingredient. The companion `alex-coordinated-medication-check.json` compares the two records, signed query vectors, rankings, eligibility screens and final decisions. [Saved result and handoffs](snapshots/coordinated-alex/summary.md)

## Setup and live operation

Use Python 3.11+ and install the pinned dependencies with `python3.11 -m venv .venv && .venv/bin/pip install -r requirements-coordinator.txt` in this directory. For a fresh installation the online CLI downloads and verifies the DRKG TransE-L2 matrices, triples, row mappings, glossary and terminology tables. `--data PATH` can point to an existing verified release.

A live invocation uses `run.py --planner claude --agent-env /path/to/BioHacks/agent/.env --medication-check`. The loader reads the selected model settings and Anthropic credential locally. It does not enable external trace upload from that file. Use `CLAUDE_ORCHESTRATOR_MODEL=claude-sonnet-5-5` and `CLAUDE_SUBAGENT_MODEL=claude-haiku-5-5`. Cached public receipts and successful hosted research are reused by content key. The offline command replays Alex's included de-identified hosted receipts, rebuilds the signed vectors and reruns both selection paths. A missing hosted replay fails explicitly. `--planner local` is an explicitly labeled deterministic option for the same workflow and adjudicated search protocols.

## Coordinator and source boundaries

This is the fixed-category adaptation of Neo's pushed LangGraph coordinator at `99458b4321133d93242b2f29ab744d2c85caab58`. The planner, structured Claude client, sanitized Brief, Send fan-out, tool-using sub-agent, target-profile schemas, privacy and drug-name scrubber come from that branch. The coordinator graph runs **load patient → plan → five parallel researchers → verify → synthesize**. Synthesis uses the existing human-outcome and safety policies. [Upstream coordinator](https://github.com/penguinyogurt/BioHacks-2026/blob/99458b4321133d93242b2f29ab744d2c85caab58/agent/graph.py)

The default synthetic input is the same abbreviated Alex record used by the previous DRKG runs, `examples/alex.json`. It lacks an explicit personal goal or genetic subtype. The coordinator decodes the case file once and routes overlapping source-referenced abstractions, objectives, unknowns and hypotheses. Its local source ledger preserves the exact quotation. Only the sanitized brief enters a research worker. Drug identities used to check personal interactions stay on the coordinator side. Public evidence may name trial agents; those mentions never select candidate IDs. Medication-independent cautions are retained only for explicitly adjudicated unchanged chart findings. Medication-pair conclusions and safety clearances require their applicable chart. The medication counterfactual changes one field, reuses identical unaffected planner/research outputs and fixes the scoring pool to baseline. Natural eligibility changes are also reported.

## Research and retrieval

Every category searches primary literature (MED-indexed Europe PMC), ClinicalTrials.gov and either a ChEMBL target or openFDA label index. Exact primary-record, label and registry checks are recorded separately from discovery hits. Hosted workers also have Neo's PubMed, registry and Open Targets tools. Identifier checks require a returned source. A citation verifies provenance; interpretation of a paper remains visible for review. Profiles with unsupported sources or unmappable directions are recorded as dead ends. Public receipts include query URLs, retrieval status, IDs and timestamps. An empty response and a failed retrieval have different statuses.

- **Disease/indications** searches human clinical endpoints and relevant populations and maps the supported diagnosis to treatment predicates.
- **Genes/targets** investigates desired target actions, matching signed expression or pharmacological predicates. A genotype-specific treatment goal requires evidence relevant to the brief.
- **Safety/interactions/class** researches harmful directions arising from active therapies or chart concerns. The scored CYP1A2 inhibition hypothesis and the independently documented medication-pair screen have different purposes.
- **Pathways/processes** resolves researched biological processes using target annotations and an observed gene–GO participation edge. Unsupported free-text pathway names remain unscored.
- **Symptoms/function** researches functional endpoints and their measurement limitations. Cough on liquids supports a swallowing hypothesis only. A clinical outcome can be mapped even when its causal mechanism is unknown.

The deterministic matcher resolves exact release IDs from researched terms, direction-specific predicates and independently checked annotations. For `(drug,r,target)`, `q=e[target]−r`; for `(anchor,r,drug)`, `q=e[anchor]+r`. Multi-hop paths compose signed translations. Distinct hypotheses about the same outcome are alternatives: the smallest L2 across compatible queries sets each drug's retrieval rank. Duplicate projections combine evidence once. A missing typed mapping leaves a category unscored. The immutable 400-dimensional embedding rows are never trained, normalized or replaced. Adequate local delivery is a research assumption. Passive BBB permeability does not enter a distance, rank or score. [Official DRKG release](https://github.com/gnn4dr/DRKG)

## Candidate scope and decisions

Start from every canonical DrugBank compound in the frozen graph. Separate established ALS comparators and apply the case exclusions. Prior human ALS administration is an evidence annotation, **not a requirement for discovery or mechanistic research review**. An ingredient absent from the bounded cache has unknown testing status. The five agents use the same remaining IDs. Each scored query measures the distance to **every** candidate, including drugs with no observed candidate edge and no paper mentioning them. Each top-K row includes the ID, rank, L2, query evidence and witness status. Benefit rank 1 is closest predicted fit. Risk rank 1 is greatest predicted concern.

The final selector consumes all five outputs. Its supported ranks and the full-pool retrieval ranks are saved separately. An observed positive path supplies graph credit. For the safety contribution only independently reviewed candidates without unresolved pair edges receive a suitability rank, ordered by decreasing distance from the closest risk. Missing support earns no credit. An unreviewed drug cannot gain a safety pass by being far away.

Credible human harm vetoes a drug on both paths. A negative clinical trial requires the two independent delivery links already specified in `shared/outcomes.py`. Inconclusive, conflicting or biomarker-only results remain unresolved. The additional discovery category permits a drug without established ALS trial history to advance for **mechanistic research** when it has a sourced graph rationale and an explicit case-matched safety pass. It ranks after the existing favorable-clinical and supported-delivery categories. The top-K intersection is tried first. The fallback searches the same cleared pool and returns up to five. The existing weights (0.36, 0.26, 0.13, 0.20, 0.05), missing-evidence policy, concern deduction and deterministic ties remain in force. Scores are internal retrieval measures.

Run `.venv/bin/python -m unittest discover -s tests -v` here for the deterministic tests. Historical outcomes and the audit at `8da7881` remain in their original snapshots. Run a historical audit from its pinned revision; its input-integrity check deliberately detects this refactor.
