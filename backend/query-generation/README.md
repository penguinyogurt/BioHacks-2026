# Five-agent DRKG research retrieval

From the BioHacks repository root, with Python 3.9+ and NumPy installed:

```sh
python3 backend/query-generation/run.py --top-k 100
```

This downloads the public [official DRKG TransE-L2 release](https://github.com/gnn4dr/DRKG#download-drkg) on the first run, verifies the archive, and extracts six allowlisted files. Subsequent runs verify the individual files against the release manifest. No credentials or LLM service are required. Use `--offline` to prohibit downloading. Options include `--data`, `--profile`, `--review`, and `--output`. The default detailed report is `reports/alex.json` beside the script. Downloads, matrices and generated reports are Git-ignored.

## How a compound qualifies

The shared pool uses the release's exact DrugBank compound IDs. Other namespaces are not implicitly merged. This pool includes research compounds and existing-indication comparators; a DrugBank identifier alone establishes neither approval nor suitability. Current therapy and confirmed research-screen conflicts are removed for all agents before ranking. Alex's example profile is sourced to the project case at a pinned revision. Gene/pathway and symptom mappings are explicitly hypotheses. No genetic subtype is assigned to Alex.

Five deterministic agents run concurrently over the same pool and read-only graph. Each relation's endpoint **types** must match its glossary pair; the source sometimes writes the pair in the opposite order and has two spelling variants. The ordered relation suffix and actual head/tail types determine **direction**. Invalid triples are quarantined and counted. Unknown IDs are errors. For a validated forward traversal from a head, add its relation vector. For a reverse traversal from a tail, subtract it. For multiple hops, compose these signed translations. Compare the resulting point with frozen compound rows using ordinary L2 distance. No projection training, vector normalization, external coordinates, BBB score, or generative model is involved.

| Agent | Anchor and support policy |
|---|---|
| Disease indications | Project ALS backward through observed treatment relations. Support requires a direct treatment assertion or a treatment assertion for a DRKG-related disease. |
| Genes and targets | Intersect literature-supported SOD1 and TARDBP anchors with actual disease–gene associations. Require a compound binding or target edge. These are biology hypotheses, without a claim about the individual's genotype. |
| Safety, interactions and class | Use the current therapy's observed directed DDI neighborhood. A separate source review is required for each ranked compound. Withhold candidates with an unresolved exact-pair graph DDI; withhold unreviewed candidates as unknown. For Alex the review emphasizes CYP1A2 and flags a sourced respiratory warning against reduced FVC. The review file includes the label sections, checked IDs, remaining risks and policy judgments. |
| Pathways and processes | Require an ALS-associated gene participating in the literature-supported oxidative-stress response. Project the process backward through participation and targeting/binding; retain a concrete two-edge witness for each compound. |
| Symptoms and function | Map the reported thin-liquid swallowing difficulty to the MeSH deglutition-disorder concept for retrieval. Require a matching treatment assertion. This does not diagnose a cause or validate the reported treatment. |

Each agent keeps the nearest applicable query for each supported ID. Positive agents rank smaller L2 distances first. Safety ranks **larger nearest-risk distances first**, within the independently reviewed subset only. A label warning excluded by the conservative screen is not automatically a formal contraindication. Safe administration, especially under a different route, is not established by a large distance. Adequate local delivery is a modeling assumption.

## Strict aggregation and evidence

Cut each supported, eligible list to K **before** intersecting; short lists contribute all their entries. Ties within a list use canonical ID. Survivors are ordered by mean of five one-based ranks, then smallest worst rank, then ID. Each survivor row carries all five ranks. An empty supported list returns “five-way ranking unavailable” with the agent name. Nonempty lists with empty intersection return “no five-way overlap at K”. Neither condition triggers a union, a larger K, or an omitted agent.

The JSON report contains the case and its source, the release identity and validation counts, each selected query with glossary entries and traversal directions, individual ranked IDs with L2 distances and evidence, exclusions, individual and pairwise sizes, and the final survivors. `context_fields` separates cost, Canadian availability, regulatory status and patient acceptance for compounds appearing in any ranking; absent evidence is explicitly unknown. A past authorization does not establish today's local supply. The review is deliberately bounded; the report includes unresolved risks and trial evidence where available.

## Actual Alex run

The frozen release contained 97,238 entities, 107 relations and 5,874,261 triples, with zero type/direction quarantines. Of 10,551 canonical compounds, 10,541 remained after removing current therapy and nine policy conflicts. All five agents ran. The supported list sizes were **30, 15, 2, 1,176 and 5**, respectively; at K=100 the contributing sizes were **30, 15, 2, 100 and 5**. The five-way intersection was **empty**. The disease and swallowing lists alone had zero overlap. Safety support covered two candidates for a limited documentary review; all other eligible IDs were unknown on that screen. This result is specific to the named anchors and support rules.

Run the deterministic tests from this directory:

```sh
python3 -m unittest discover -s tests -v
```
