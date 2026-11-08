# ALS discovery and human-outcome reassessment

**0 advanced for Alex.** 10,551 frozen compound IDs, 20 with verified human ALS administration, 10540 in the investigational graph pool.

Bounded primary-study cache covering established treatments, previous shortlist ingredients, and additional interventional or symptomatic trials. Ingredients without verified administration have unknown testing status. Coverage is not a census of ALS research. Study history annotates the full discovery pool. Compounds without a matching trial remain eligible for mechanistic research.

Strict top-100 after clinical and patient-safety review: five-way ranking unavailable. Five-way overlap: 0.
No investigational ingredient cleared both the human outcomes and case safety rules.
The fallback returned 0.

Graph-only supported counts before clinical selection: Disease / indications 29, Genes / targets 0, Safety / interactions / class 1, Pathways / processes 0, Symptoms / function 5.

[Patient-specific queries and agent rankings](query-traces.md) · [Saved final report](final.json) · [Medication comparison](medication-check.json)

## Discovery pool

All five researchers received 10,540 identical compound IDs. 16 have verified human ALS administration in the cache. Testing status is unknown here for the other 10,524.

Adequate local delivery is a research assumption. Passive BBB permeability is outside ranking. Exposure, engagement and focused-ultrasound feasibility require separate evidence.

## Previous finalists

| Previous rank | Ingredient | Previous internal ranking score | Current disposition | Decisive human evidence | Why change delivery? |
|---:|---|---:|---|---|---|
| 1 | [Arimoclomol](DB05025.md) | 0.6251 | negative efficacy; retained only | No improvement in the primary function/survival endpoint. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/38782015/) | Oral dose escalation raised CSF drug levels. The phase III trial left motor-neuron HSP engagement uncertain. No measurement establishes that insufficient exposure caused its negative result. |
| 2 | [Minocycline](DB01017.md) | 0.5689 | excluded for human harm | Function declined faster on minocycline: 1.30 versus 1.04 ALSFRS-R points/month, p=0.005. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/17980667/) | Increasing regional exposure has no demonstrated basis for reversing the faster functional decline observed at the tested systemic regimen. |
| 3 | [Memantine](DB01043.md) | 0.5096 | negative efficacy; retained only | No significant difference in progression. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/39511965/) Neither arm slowed functional decline or improved survival. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/39307154/) No difference in primary or secondary measures. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/20565333/) | Controlled trials at different oral doses showed no functional benefit. A small riluzole add-on study measured CSF tau, not a therapeutic receptor-occupancy deficit. |
| 4 | [Acetylcysteine](DB06151.md) | 0.4733 | negative efficacy; retained only | Survival was 65% versus 54%; HR 0.74, 95% CI 0.41–1.33. Progression also showed no significant benefit. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/7763202/) | The subcutaneous trial did not demonstrate deficient motor-neuron exposure. CSF measurements after oral dosing in Parkinson disease cannot establish an exposure deficit or an ALS target level for this regimen. |
| 5 | [Melatonin](DB01065.md) | 0.4240 | unresolved | A serum oxidative-stress marker fell. Human functional or survival benefit remains unresolved. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/17014688/) Oral tolerability was reported. No usable comparative efficacy estimate was available. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/12220335/) An association with longer survival and slower functional decline is vulnerable to confounding and selection bias. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/33428242/) Mean ALSFRS-R was 34.4 at month three before treatment (14 measured) and 30.8 at month nine (13 measured). The design cannot establish a causal treatment effect. [clinicaltrials.gov](https://clinicaltrials.gov/study/NCT06429059) | A serum oxidation marker changed during rectal treatment; neither that marker nor the uncontrolled pilot identifies a concentration needed for functional benefit. |

## Decisions for every tested ingredient in the graph

Within each evidence category, the internal ranking score orders the rows that have graph evidence. An empty agent rank means missing support. Each drug dossier gives its delivery assessment.

### Excluded for human harm

| Ingredient | Disposition | Internal ranking score | Decisive human finding |
|---|---|---:|---|
| [Minocycline](DB01017.md) | excluded for human harm | 0.1184 | Function declined faster on minocycline: 1.30 versus 1.04 ALSFRS-R points/month, p=0.005. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/17980667/) |
| [Ceftriaxone](DB01212.md) | excluded for human harm | 0.1165 | No phase III efficacy and a material excess of serious hepatobiliary events at the tested regimen. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/25297012/) |
| [Topiramate](DB00273.md) | excluded for human harm | 0.0000 | Arm strength declined faster on topiramate (p=0.012). [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/12939417/) |
| [Dexpramipexole](DB15130.md) | excluded for human harm | 0.0000 | No prespecified clinical efficacy endpoint improved. Neutropenia occurred in 8% versus 2% (37 versus 8 people). [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/24067398/) |

### Favorable clinical evidence

| Ingredient | Disposition | Internal ranking score | Decisive human finding |
|---|---|---:|---|
| [Mexiletine](DB00379.md) | excluded by case screen | — | Controlled evidence supports fewer symptomatic cramps. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/29510461/) |
| [Riluzole](DB00740.md) | established treatment; comparator only | — | Survival favored riluzole. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/8302340/) Adjusted survival analyses favored riluzole at 100 mg/day. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/8676624/) |

### Negative efficacy; retained only

| Ingredient | Disposition | Internal ranking score | Decisive human finding |
|---|---|---:|---|
| [Creatine](DB00148.md) | negative efficacy; retained only | 0.3600 | No survival or functional benefit. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/12666111/) No measured strength or functional benefit over six months. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/15534251/) Motor, respiratory and functional measures did not significantly improve. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/18608103/) |
| [Acetylcysteine](DB06151.md) | negative efficacy; retained only | 0.2900 | Survival was 65% versus 54%; HR 0.74, 95% CI 0.41–1.33. Progression also showed no significant benefit. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/7763202/) |
| [Memantine](DB01043.md) | negative efficacy; retained only | 0.2823 | No significant difference in progression. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/39511965/) Neither arm slowed functional decline or improved survival. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/39307154/) No difference in primary or secondary measures. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/20565333/) |
| [Trehalose](DB12310.md) | negative efficacy; retained only | 0.2646 | No evidence of slower disease progression. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/40409314/) |
| [Pridopidine](DB11947.md) | negative efficacy; retained only | 0.2475 | The joint progression endpoint did not improve relative to placebo. Disease rate ratio 0.99 (95% credible interval 0.80 to 1.21). [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/40067755/) |
| [Arimoclomol](DB05025.md) | negative efficacy; retained only | 0.2429 | No improvement in the primary function/survival endpoint. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/38782015/) |
| [Rasagiline](DB01367.md) | negative efficacy; retained only | 0.1131 | No significant difference in primary survival outcome. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/29934198/) No improvement in functional slope or convincing peripheral target engagement. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/30192007/) |
| [Celecoxib](DB00482.md) | negative efficacy; retained only | 0.0000 | No measured functional or survival benefit. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/16802291/) |
| [Trazodone](DB00656.md) | negative efficacy; retained only | 0.0000 | Neither arm slowed functional decline or improved survival. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/39307154/) |
| [Pioglitazone](DB01132.md) | negative efficacy; retained only | 0.0000 | Stopped for futility. No survival improvement. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/22715372/) |
| [Gabapentin](DB00996.md) | excluded by case screen | — | No strength, survival or functional benefit. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/11294919/) |

### Unresolved

| Ingredient | Disposition | Internal ranking score | Decisive human finding |
|---|---|---:|---|
| [Melatonin](DB01065.md) | unresolved | 0.1929 | A serum oxidative-stress marker fell. Human functional or survival benefit remains unresolved. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/17014688/) Oral tolerability was reported. No usable comparative efficacy estimate was available. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/12220335/) An association with longer survival and slower functional decline is vulnerable to confounding and selection bias. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/33428242/) Mean ALSFRS-R was 34.4 at month three before treatment (14 measured) and 30.8 at month nine (13 measured). The design cannot establish a causal treatment effect. [clinicaltrials.gov](https://clinicaltrials.gov/study/NCT06429059) |
| [Levetiracetam](DB01202.md) | unresolved | 0.0000 | Cramp and phasic spasticity measures improved without a concurrent placebo group. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/18821142/) |
| [Edaravone](DB12243.md) | established treatment; comparator only | — | Decline was smaller in the selected early-stage cohort. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/28522181/) The between-arm difference was 0.65 points, p=0.411. The later positive study selected a narrower cohort. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/25286015/) |

## Why would changing delivery change the result?

For each negative trial, the dossier examines whether exposure or engagement limited the original regimen and whether focused ultrasound could correct that limitation for the same ingredient. Human ALS feasibility evidence demonstrates transient focal opening measured by contrast enhancement. Drug-specific exposure, target engagement and a clinical response require separate evidence. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/31558719/)

## Five-agent breakdown

Agent cells show supported rank / normalized weight / contribution. Missing support earns zero. Rows are alphabetical for lookup.

| Ingredient | Disease / indications | Genes / targets | Safety / interactions / class | Pathways / processes | Symptoms / function | Concern deduction |
|---|---|---|---|---|---|---:|
| [Acetylcysteine](DB06151.md) | 2 / 0.36 / 0.3300 | missing / 0.26 / 0.0000 | missing / 0.13 / 0.0000 | missing / 0.20 / 0.0000 | missing / 0.05 / 0.0000 | 0.0400 |
| [Arimoclomol](DB05025.md) | 4 / 0.36 / 0.2829 | missing / 0.26 / 0.0000 | missing / 0.13 / 0.0000 | missing / 0.20 / 0.0000 | missing / 0.05 / 0.0000 | 0.0400 |
| [Ceftriaxone](DB01212.md) | 24 / 0.36 / 0.1165 | missing / 0.26 / 0.0000 | missing / 0.13 / 0.0000 | missing / 0.20 / 0.0000 | missing / 0.05 / 0.0000 | 0.0000 |
| [Celecoxib](DB00482.md) | missing / 0.36 / 0.0000 | missing / 0.26 / 0.0000 | missing / 0.13 / 0.0000 | missing / 0.20 / 0.0000 | missing / 0.05 / 0.0000 | 0.0000 |
| [Creatine](DB00148.md) | 1 / 0.36 / 0.3600 | missing / 0.26 / 0.0000 | missing / 0.13 / 0.0000 | missing / 0.20 / 0.0000 | missing / 0.05 / 0.0000 | 0.0000 |
| [Dexpramipexole](DB15130.md) | missing / 0.36 / 0.0000 | missing / 0.26 / 0.0000 | missing / 0.13 / 0.0000 | missing / 0.20 / 0.0000 | missing / 0.05 / 0.0000 | 0.0000 |
| [Levetiracetam](DB01202.md) | missing / 0.36 / 0.0000 | missing / 0.26 / 0.0000 | missing / 0.13 / 0.0000 | missing / 0.20 / 0.0000 | missing / 0.05 / 0.0000 | 0.0000 |
| [Melatonin](DB01065.md) | 7 / 0.36 / 0.2329 | missing / 0.26 / 0.0000 | missing / 0.13 / 0.0000 | missing / 0.20 / 0.0000 | missing / 0.05 / 0.0000 | 0.0400 |
| [Memantine](DB01043.md) | 16 / 0.36 / 0.1523 | missing / 0.26 / 0.0000 | 1 / 0.13 / 0.1300 | missing / 0.20 / 0.0000 | missing / 0.05 / 0.0000 | 0.0000 |
| [Minocycline](DB01017.md) | 15 / 0.36 / 0.1584 | missing / 0.26 / 0.0000 | missing / 0.13 / 0.0000 | missing / 0.20 / 0.0000 | missing / 0.05 / 0.0000 | 0.0400 |
| [Pioglitazone](DB01132.md) | missing / 0.36 / 0.0000 | missing / 0.26 / 0.0000 | missing / 0.13 / 0.0000 | missing / 0.20 / 0.0000 | missing / 0.05 / 0.0000 | 0.0000 |
| [Pridopidine](DB11947.md) | 6 / 0.36 / 0.2475 | missing / 0.26 / 0.0000 | missing / 0.13 / 0.0000 | missing / 0.20 / 0.0000 | missing / 0.05 / 0.0000 | 0.0000 |
| [Rasagiline](DB01367.md) | 25 / 0.36 / 0.1131 | missing / 0.26 / 0.0000 | missing / 0.13 / 0.0000 | missing / 0.20 / 0.0000 | missing / 0.05 / 0.0000 | 0.0000 |
| [Topiramate](DB00273.md) | missing / 0.36 / 0.0000 | missing / 0.26 / 0.0000 | missing / 0.13 / 0.0000 | missing / 0.20 / 0.0000 | missing / 0.05 / 0.0000 | 0.0000 |
| [Trazodone](DB00656.md) | missing / 0.36 / 0.0000 | missing / 0.26 / 0.0000 | missing / 0.13 / 0.0000 | missing / 0.20 / 0.0000 | missing / 0.05 / 0.0000 | 0.0000 |
| [Trehalose](DB12310.md) | 3 / 0.36 / 0.3046 | missing / 0.26 / 0.0000 | missing / 0.13 / 0.0000 | missing / 0.20 / 0.0000 | missing / 0.05 / 0.0000 | 0.0400 |

## Five-category retrieval

Each scored category searched the full eligible pool. The risk column reports concern; a small distance does not verify a conflict.

| Category | Queries | Scored | Closest compound | Distance |
|---|---:|---:|---|---:|
| [Disease / indications](handoff/disease-indications/trace.json) | 3 | 10540 | Creatine (Compound::DB00148) | 10.22974 |
| [Genes / targets](handoff/genes-targets/trace.json) | 1 | 10540 | Glycine (Compound::DB00145) | 10.81443 |
| [Safety / interactions / class](handoff/safety-interactions-class/trace.json) | 2 | 10540 | Compound::DB06732 (Compound::DB06732) | 9.51138 |
| [Pathways / processes](handoff/pathways-processes/trace.json) | 1 | 10540 | L-Cystine (Compound::DB00138) | 12.60783 |
| [Symptoms / function](handoff/symptoms-function/trace.json) | 3 | 10540 | Ethanol (Compound::DB00898) | 10.54560 |

## Discovery leads outside the administration cache

These graph-supported research hypotheses have unverified ALS testing status. Their disposition records whether case-specific safety review allowed advancement.

| Lead | Compound | Internal ranking score | Decision |
|---:|---|---:|---|
| 1 | Compound::DB11846 (Compound::DB11846) | 0.2640 | unresolved patient safety |
| 2 | Testosterone (Compound::DB00624) | 0.2200 | unresolved patient safety |
| 3 | Compound::DB03614 (Compound::DB03614) | 0.2084 | unresolved patient safety |
| 4 | Compound::DB02530 (Compound::DB02530) | 0.1980 | unresolved patient safety |
| 5 | Compound::DB03128 (Compound::DB03128) | 0.1886 | unresolved patient safety |
| 6 | Sirolimus (Compound::DB00877) | 0.1800 | unresolved patient safety |
| 7 | Compound::DB11094 (Compound::DB11094) | 0.1722 | unresolved patient safety |
| 8 | Valproic Acid (Compound::DB00313) | 0.1650 | unresolved patient safety |
| 9 | Quinidine (Compound::DB00908) | 0.1467 | unresolved patient safety |
| 10 | Compound::DB08844 (Compound::DB08844) | 0.1414 | unresolved patient safety |
| 11 | Guanidine (Compound::DB00536) | 0.1366 | unresolved patient safety |
| 12 | Verapamil (Compound::DB00661) | 0.1320 | unresolved patient safety |
| 13 | Baclofen (Compound::DB00181) | 0.1277 | unresolved patient safety |
| 14 | Compound::DB09421 (Compound::DB09421) | 0.1237 | unresolved patient safety |
| 15 | Selegiline (Compound::DB01037) | 0.1200 | unresolved patient safety |
| 16 | L-Threonine (Compound::DB00156) | 0.1100 | unresolved patient safety |
| 17 | Dextromethorphan (Compound::DB00514) | 0.1070 | unresolved patient safety |
| 18 | Tauroursodeoxycholic acid (Compound::DB08834) | 0.1042 | unresolved patient safety |
| 19 | Compound::DB14509 (Compound::DB14509) | 0.1015 | unresolved patient safety |
