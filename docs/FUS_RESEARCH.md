# MRgFUS and the blood–brain barrier — verified citations for the pitch

Compiled 2026-11-07 for the Devpost pitch and the expo table. Every citation
below was opened and read (PubMed/PMC/Europe PMC records, ClinicalTrials.gov
API). Anything not confirmed in a primary source is marked **unverified**.

Answers the open question in `DISCOVERY_SPEC.md` §4.4.

---

## TL;DR for the pitch

- **BBB opening over the motor cortex in ALS has been done in humans, and it
  is safe and reversible** — 4 patients at Sunnybrook, gadolinium confirmed
  opening, normalized within 24 h, no serious adverse events (Abrahao et al.,
  *Nat Commun* 2019). **No drug was delivered in that trial.**
- **Drug delivery through FUS-opened BBB has been shown in humans in other
  diseases** — trastuzumab into HER2+ brain metastases with a measured ~101%
  SUVR increase (Meng et al., *Sci Transl Med* 2021), aducanumab in Alzheimer's
  (Rezai et al., *NEJM* 2024), recombinant glucocerebrosidase in Parkinson's
  (Meng et al., *Mov Disord* 2022). All n = 3–4, phase I.
- **ALS drug-delivery trials are now registered and running** — Sunnybrook
  IVIg + FUS (NCT07193953, phase I, n = 6, active not recruiting) and Son-ALS
  with an implanted SonoCloud-4 (NCT07571486, phase I/2a, n = 23, recruiting).
  So the premise is live, not hypothetical — but no efficacy has been shown.

---

## 1. The Sunnybrook first-in-human ALS trial — verified

**Abrahao A, Meng Y, Llinas M, Huang Y, Hamani C, Mainprize T, Aubert I,
Heyn C, Black SE, Hynynen K, Lipsman N, Zinman L.** "First-in-human trial of
blood-brain barrier opening in amyotrophic lateral sclerosis using MR-guided
focused ultrasound." *Nature Communications* 2019;10(1):4373.
DOI [10.1038/s41467-019-12426-9](https://doi.org/10.1038/s41467-019-12426-9) ·
PMID 31558719 · PMC6763482 · ClinicalTrials.gov **NCT03321487** (completed,
sponsor InSightec, enrollment 4).

Specifics:

| Question | Answer |
|---|---|
| n patients | **4** (2 women, 2 men; median age 61, range 56–70) |
| Target | **Right primary motor cortex (precentral gyrus)**, non-dominant side, contralateral to the weaker limb; arm region in 2, leg region in 2; targets individualized by motor-task fMRI |
| Volume | Two targets of 5 × 5 × 7 mm (175 mm³ each, **350 mm³** total); stated design ceiling 1 cm³ |
| Sessions | **One procedure per patient**; 1–2 sonication cycles per target, 2–4 cycles total. Repeat dosing discussed only as future work |
| Microbubbles | Definity (perflutren lipid), 4 µL/kg per cycle, ≤20 µL/kg total |
| Opening confirmed? | **Yes — new gadolinium enhancement on T1 immediately post-sonication in all 4** |
| How long open? | Enhancement **normalized by the 24 h MRI** |
| Drug delivered? | **No.** Gadolinium was an imaging marker only |
| Safety | **No serious adverse events through 60 days.** Mild/moderate: headache (3), one vagal response, scalp pain/bruising, petechial scalp rash, one transient FLAIR hyperintensity resolved by day 30. No hemorrhage, ischemia or gliosis to 30 days. No accelerated ALSFRS-R decline to day 60; no significant MoCA or EEG change, no epileptiform discharges at 30 days |

Authors' own limitations: small open-label single-centre; only limb-onset
patients with severe target-limb weakness; small targeted volume; contrast
assessment qualitative/semi-quantitative; cortical reorganization in ALS
complicates functional targeting; trace extravasation cannot be excluded on
GRE. Their forward-looking sentence: MRgFUS "can be coupled with promising
therapeutics providing a targeted delivery platform in ALS."

Companion paper, same cohort/era, worth knowing a judge may raise it:
**Meng Y et al.,** "Glymphatics Visualization after Focused Ultrasound-Induced
Blood-Brain Barrier Opening in Humans," *Ann Neurol* 2019; PMID 31525269
(DOI **unverified** — not shown in the record I read).

---

## 2. Has a therapeutic actually been delivered across the BBB in humans?

Yes — in three neurological/neuro-oncological settings, all phase I, all tiny.

**Brain metastases (clearest evidence of delivery).** Meng Y, Reilly RM,
Pezo RC, Trudeau M, Sahgal A, Singnurkar A, Perry J, Myrehaug S, Pople CB,
Davidson B, Llinas M, Heyn C, Huang Y, Hamani C, Suppiah S, Hynynen K,
Lipsman N. "MR-guided focused ultrasound enhances delivery of trastuzumab to
Her2-positive brain metastases." *Sci Transl Med* 2021;13(615):eabj4011.
DOI [10.1126/scitranslmed.abj4011](https://doi.org/10.1126/scitranslmed.abj4011) ·
PMID 34644145 · NCT03714243. **4 patients, 20 outpatient treatments.**
Radiolabelled-trastuzumab SPECT: SUVR **+101 ± 71%** in treated lesions vs
**−18 ± 26%** in control lesions; >20% uptake increase in 87 ± 17% of
sonicated voxels (up to +450% voxel-wise); tumour measurements −19 ± 12%.
**No treatment-related serious adverse events.**

**Alzheimer's.** Rezai AR, D'Haese PF, Finomore V, Carpenter J, Ranjan M,
Wilhelmsen K, Mehta RI, Wang P, Najib U, Vieira Ligo Teixeira C, Arsiwala T,
Tarabishy A, Tirumalai P, Claassen DO, Hodder S, Haut MW. "Ultrasound
Blood-Brain Barrier Opening and Aducanumab in Alzheimer's Disease."
*N Engl J Med* 2024;390(1):55–62.
DOI [10.1056/NEJMoa2308719](https://doi.org/10.1056/NEJMoa2308719) ·
PMID 38169490. **3 participants**, FUS with each
of **six monthly aducanumab infusions** over ~6 months; amyloid reduction on
¹⁸F-florbetaben PET **"numerically greater in regions treated with focused
ultrasound"** than in untreated homologous contralateral regions. The widely
quoted **~32% greater reduction at 26 weeks** and the per-participant
centiloid drops come from secondary coverage, not from the abstract I could
read — the paper itself is paywalled, so those figures are **unverified**;
quote only the "numerically greater" wording on stage. Registration is
plausibly NCT05469009 (Exablate BBB disruption with standard-of-care mAb,
sponsor Ali Rezai, n = 15, active not recruiting, started 2022-07-14) but the
link to this publication is **unverified**.

**Parkinson's (enzyme).** Meng Y, Pople CB, Huang Y, Jones RM, Ottoy J,
Goubran M, Oliveira LM, Davidson B, Lawrence LSP, Lau AZ, Bethune A,
Maralani P, Abrahao A, Hamani C, Hynynen K, Kalia SK, Lipsman N, Kalia LV.
"Putaminal Recombinant Glucocerebrosidase Delivery with MR-Guided Focused
Ultrasound in Parkinson's Disease: A Phase I Study." *Mov Disord*
2022;37(10):2134–2139.
DOI [10.1002/mds.29190](https://doi.org/10.1002/mds.29190) · PMID 36089809.
**4 GBA1-mutation patients**, IV recombinant GCase at 15/30/60 IU/kg every
2 weeks with putaminal BBB opening. No serious adverse events; transient
dyskinesia in 2. Important caveat: **drug concentration in tissue was not
measured** — only BBB permeability by DCE-MRI. Exploratory MDS-UPDRS off-med
−12% at 6 months (26 ± 9 → 22 ± 6).

**Alzheimer's, opening only (no drug).** Lipsman N, Meng Y, Bethune AJ,
Huang Y, Lam B, Masellis M, Herrmann N, Heyn C, Aubert I, Boutet A, Smith GS,
Hynynen K, Black SE. *Nat Commun* 2018;9(1):2336.
DOI [10.1038/s41467-018-04529-6](https://doi.org/10.1038/s41467-018-04529-6) ·
PMID 30046032 · PMC6060168 · NCT02986932. **5 patients, two sessions ~1 month
apart** (4 of 5 completed both), right superior frontal gyrus white matter,
enhancement resolved by 24 h, no SAEs. Useful as the repeated-session
precedent.

---

## 3. Registered ALS FUS trials (ClinicalTrials.gov API, queried 2026-11-07)

| NCT | What | Status | n |
|---|---|---|---|
| **NCT03321487** | BBB opening with MRgFUS in ALS (the Abrahao trial; sponsor InSightec) | **Completed** (2018-04-13 → 2023-09-11) | 4 |
| **NCT07193953** | "Targeting Neuroinflammation With Enhanced Delivery of **IVIg** to the Motor Cortex Using Next Generation Dome Helmet Focused Ultrasound in ALS," phase I open-label, Sunnybrook | **Active, not recruiting** (started 2025-04-15; primary completion 2026-11-30) | 6 |
| **NCT07571486** | **Son-ALS** — repeated transient BBB opening via implanted **SonoCloud-4**, AP-HP Paris, phase 1/2a | **Recruiting** (start 2026-07-15) | 23 |

NCT07193953 detail: bilateral primary motor cortex (arm, leg and bulbar
regions), IVIg 0.4 g/kg (cohort 1) then 0.8 g/kg (cohort 2) split over two
doses, **one BBB-opening procedure** performed with the second dose, Definity
microbubbles, 24-week follow-up. Primaries are IVIg safety, microbubble
safety, feasibility of bilateral gadolinium enhancement with normalization,
and FUS safety (including ≥6-point ALSFRS-R decline by week 8). Secondary:
plasma and CSF NfL, plus inflammatory markers.

NCT07571486 detail: SonoCloud-4 implanted under local anaesthesia; **9
sonications over 24 weeks** (first 2 weeks post-implant, then 8 at 3-week
intervals) targeting upper motor neuron area and adjacent SMA; **no
concomitant drug in phase 1**; phase 2a primary is change in blood NfL to
week 26.

**Edaravone + FUS: no such registered trial found.** A query for edaravone
AND ultrasound returned nothing relevant. Do not claim one exists.

---

## 4. Known risks and limits

**Duration of opening is short.** Gadolinium enhancement normalized within
24 h in both the ALS and the Alzheimer's cohorts — the therapeutic window is
hours, so the drug must be circulating at the time of sonication (Abrahao
2019; Lipsman 2018, above).

**Focal volume is small.** 350 mm³ across two targets in the ALS trial,
against a design ceiling of 1 cm³ (Abrahao 2019). ALS is diffuse; covering
the motor system is not the same problem as covering one target. (A reported
FDA limit of ~40 cc in the Alzheimer's lecanemab phase is **unverified** —
secondary source only.)

**Repeated sessions: precedent exists but is thin.** Two sessions a month
apart in Alzheimer's (Lipsman 2018), 20 treatments across 4 patients in brain
metastases (Meng 2021), biweekly dosing in Parkinson's (Meng 2022). In ALS the
published trial was **single-session**; repeated opening in ALS is exactly
what NCT07193953 and NCT07571486 are testing now.

**Opening is not selective — it exposes brain to everything circulating, and
may itself provoke inflammation.** Kovacs ZI, Kim S, Jikaria N, Qureshi F,
Milo B, Lewis BK, Bresler M, Burks SR, Frank JA. "Disrupting the blood-brain
barrier by focused ultrasound induces sterile inflammation." *PNAS*
2017;114(1):E75–E84.
DOI [10.1073/pnas.1614777114](https://doi.org/10.1073/pnas.1614777114) ·
PMID 27994152 · PMC5224365. **Rats** (female Sprague–Dawley): FUS +
microbubbles raised HSP70, IL-1, IL-18 and TNFα for ~24 h with NF-κB pathway
induction, parenchymal albumin, TUNEL+ neurons, activated astrocytes and
microglia, and CD68+ macrophage infiltration at 6 days; the authors compare
the response to ischemia or mild TBI and state that further investigation is
required before wide clinical implementation. This is an animal result and was
contested in correspondence (Kovacs et al., *PNAS* 2017;114(33):E6737–E6738,
DOI 10.1073/pnas.1711544114) — present it as the open safety question it is,
not as a settled human finding.

---

## 5. On stage

**Honest claim:** "Focal, reversible BBB opening over the motor cortex has
been shown safe in four people with ALS at Sunnybrook, and FUS-assisted
delivery of real therapeutics — trastuzumab, aducanumab, glucocerebrosidase —
has been demonstrated in humans in other diseases, with ALS drug-delivery
trials now registered and running; so we built the screen for the drugs that
were only ever excluded on delivery."

**Must not claim:** that any drug has been delivered to the ALS motor cortex
by FUS, that FUS has improved any ALS outcome, that a FUS + edaravone trial
exists, or that opening the barrier makes a non-CNS drug safe once it is in.
