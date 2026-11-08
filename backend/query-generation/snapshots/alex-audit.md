# Alex audit · `8da7881`

The unchanged offline control reproduced the saved pool, five agent rankings, query scores and dispositions. The synthetic replay changed only `facts.current_therapy` from “Riluzole 50 mg BID” to “Not taking riluzole 50 mg BID.” A second check expressed the same status as “No longer taking riluzole 50 mg BID.” All three used the same cached evidence, settings, embeddings and 15 scored candidate IDs. [Full comparison, including every anchor ID, signed relation, vector delta and rank](alex-audit.json)

### Pool counts

| Stage | Count | Search, verification and remaining uncertainty |
|---|---:|---|
| Frozen DRKG | 10,551 canonical compound IDs | Enumerated exact DrugBank IDs in the checksum-verified release. |
| Historical Alex screen | 10,541 | Subtracted current riluzole, eight named riluzole warning-screen drugs and gabapentin for reduced respiratory reserve. This count was never the number of individual trial searches. |
| Human ALS administration | 20 curated ingredients → 19 graph matches and dossiers | The pipeline checked aliases, IDs and recorded human dosing in 21 cached primary-study records. Tofersen had trial evidence but no exact row in the release. Of the 10,541, **16** had a dossier and **10,525** had unknown testing status in this cache. Three dossier IDs had already been removed by the historical screen. Across all 10,551 IDs, 10,532 had no qualifying cached evidence. |
| Scope of literature review | 20 ingredient names | The saved search ledger records 20 ALS-publication queries, 20 delivery queries and 20 registry searches, plus targeted follow-up. Reviewers abstracted 57 reports, 56 linked to the 19 dossier IDs. Searches were bounded by the curated names. |
| Other four dossiers | 19 − 4 = **15 investigational** | **Riluzole** was current therapy and an established comparator. **Edaravone** was an established comparator. **Mexiletine** met the riluzole warning screen. **Gabapentin** met Alex’s respiratory screen. Riluzole, mexiletine and gabapentin are the three outside the historical 10,541. |
| Targeted follow-up in the saved run | 7 ingredients | Of 14 supplementary searches, 13 returned results and the memantine case-condition search timed out. Of 13 cited-source refreshes, 11 found their marker, one melatonin PDF was retrieved for manual verification, and the acetylcysteine publication refresh timed out. Its primary trial was already cached. In contrast, the completed acetylcysteine delivery query returned zero hits for its specified terms. |
| Graph scoring and advancement | 1,350 distances → **0 advanced** | Each of 90 signed, 400-dimensional queries was compared with each of 15 drug embeddings. These are query–drug distances. No candidate cleared the human-outcome gate. Strict intersection and fallback both returned zero. |

### Five-agent personalization

Relation numbers are rows in the frozen relation mapping. L2 below compares the two **query vectors**. The brief is the structured set of patient facts each agent consumed. There is no separate free-text prompt transcript. The four non-safety rows apply to both phrasings.

| Agent | Brief and anchor/relation comparison | Vector L2 | Supported ranks, safety and disposition |
|---|---|---:|---|
| Disease / indications | Same limb-onset ALS fact and MeSH D000690, reverse relations 24 and 35 | 0 for 2/2 | All 9 ranks identical. |
| Genes / targets | Same diagnosis-derived 52 gene IDs, reverse target/binding relations 21 and 69 | 0 for 77/77 | All 4 ranks identical. |
| Safety / interactions / class | Only the medication quote changed. “Not taking” kept DB00740 and both directions of interaction relation 20. “No longer taking” yielded no medication ID or risk query. | Literal: 0 for 2/2. Recognized: undefined for the two removed vectors. | Literal: memantine stayed #1 of 1. Recognized: 0 supported ranks. Both lost seven chart-matched safety reviews. |
| Pathways / processes | Same ALS gene brief and GO IDs 0034392, 0060052, 1901214 and 2001171. Reverse relation 62 followed by 21 or 69 | 0 for 8/8 | All 8 ranks identical. |
| Symptoms / function | Same swallowing and functional observations, MeSH D003680 and reverse relation 35 | 0 for 1/1 | Neither run had a supported drug. |

The four non-safety agents had identical facts and dossier evaluations. They issue no independent medication safety flags. All 15 final dispositions were identical. The disease query was exactly unchanged.

In the audited code, `Terms.match` checks a negation list that omits “not.” With the literal edit it still resolved riluzole, so the safety agent built the same two queries and the original case exclusions persisted. Separately, `run.run` and `reviewer` match the **entire chart** to reuse a case review. The edited quote broke that match. Five cautions disappeared (arimoclomol, acetylcysteine, trehalose, minocycline and melatonin), as did two reviews already marked unknown (creatine and memantine). The minocycline and melatonin review records had contained graph interaction flags. Missing review records confer no safety clearance. [Term resolver](../shared/terms.py) · [Case matching](../run.py) · [Safety queries](../agents/safety-interactions-class/agent.py)

With the literal edit, each lost caution removed a 0.04 deduction. Acetylcysteine rose from 0.4733 to 0.5133, moving from third to second among retained negative trials, ahead of memantine at 0.5096. All other within-category orderings were unchanged. Exact chart matching also suppressed the five-row historical comparison in both synthetic reports. [Internal score calculation](../ranking/fallback.py)

With “No longer taking,” the safety agent had an unresolved medication phrase and no medicine over which to construct an interaction query. Memantine lost its 0.13 safety contribution (0.5096 → 0.3796). The other 88 vectors were identical, giving 1,320 query–drug distances. The native eligibility screen now also admitted mexiletine. The audit kept the original 15 at the agent and final-selection boundaries, so mexiletine was never scored in this comparison.

### Candidate dispositions

“Retained” means a negative efficacy result with insufficient evidence for both an original exposure/engagement shortfall and a drug-specific delivery change that could correct it. “No” means the decisive rule would apply to any ALS case using this evidence and these delivery criteria.

| Previously tested drug | Disposition and decisive human finding | Alex-specific? |
|---|---|---|
| Arimoclomol | Retained. Phase III function/survival endpoint was neutral. | No |
| Acetylcysteine | Retained. No significant overall survival benefit. | No |
| Celecoxib | Retained. No improvement in measured arm strength. | No |
| Creatine | Retained. No survival or functional benefit. | No |
| Memantine | Retained. Controlled studies found no slowing of functional decline. | No |
| Pioglitazone | Retained. Riluzole add-on trial stopped for futility on survival. | No |
| Rasagiline | Retained. No primary survival benefit; faster-progressor signal was exploratory. | No |
| Trazodone | Retained. No functional or survival benefit in MND-SMART. | No |
| Trehalose | Retained. No benefit on the combined progression/survival endpoint. | No |
| Ceftriaxone | Excluded for harm. Serious hepatobiliary events occurred in 12% versus none on placebo. | No |
| Dexpramipexole | Excluded for harm. Neutropenia occurred in 8% versus 2%. | No |
| Minocycline | Excluded for harm. ALSFRS-R declined 1.30 versus 1.04 points/month. | No |
| Topiramate | Excluded for harm. Arm strength declined faster on treatment. | No |
| Levetiracetam | Unresolved. Cramp improvement came from an uncontrolled pilot. | No |
| Melatonin | Unresolved. Biomarker, observational and uncontrolled pilot findings did not establish clinical benefit. | No |

**Coverage and personalization.** The zero is explained by nine retained negative trials, four harm exclusions and two unresolved outcomes among the 15. The earlier pool screen did depend on Alex. Within the fixed pool, all decisive advancement rules were evidence-wide. This wording test exposed a negation error and sensitivity to exact chart text. Only the medication safety queries responded to the recognized negation. The native 16-drug cohort was not ranked in this fixed-pool experiment. Testing status beyond the curated cache and evidence behind timed-out or unindexed lookups remain unknown. [Outcome dossiers and primary citations](alex-outcomes-research/summary.md)

```sh
cd ~/Documents/BioHacks && python3 -B backend/query-generation/audit_alex.py
```
