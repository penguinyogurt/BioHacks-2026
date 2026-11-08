# Alex research candidates

Strict first pass: **five-way ranking unavailable** at K=100. Five-way overlap: 0.

Disease / indications: 9 | Genes / targets: 4 | Safety / interactions / class: 1 | Pathways / processes: 8 | Symptoms / function: 0

ALS administration gate: 10,551 canonical ingredients → 19 with documented human exposure in the frozen graph → 15 eligible investigational IDs after case and comparator exclusions.

Bounded primary-study cache covering established treatments, previous shortlist ingredients, and additional interventional or symptomatic trials. Ingredients without verified administration have unknown testing status. Coverage is not a census of ALS research.

[Query traces and complete agent rankings](query-traces.md)

### Established ALS treatments

- Riluzole (Compound::DB00740), reported separately. [dailymed.nlm.nih.gov](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=b117b981-476c-f9b8-e053-2995a90aee5f)
- Edaravone (Compound::DB12243), reported separately. [www.fda.gov](https://www.fda.gov/drugs/news-events-human-drugs/fda-approves-oral-form-treatment-adults-amyotrophic-lateral-sclerosis-als)
- Tofersen: no exact ingredient ID in frozen graph.
- The ALS pilot did not establish administration of zinc chloride, zinc acetate or elemental zinc metal. [www.neurology.org](https://www.neurology.org/doi/10.1212/WNL.78.1_supplement.P04.153)

Abstaining agents: symptoms-function
Zero-overlap pairs: disease-indications / symptoms-function, genes-targets / safety-interactions-class, genes-targets / symptoms-function, safety-interactions-class / symptoms-function, pathways-processes / symptoms-function

Evaluated 15 eligible IDs; 12 had a qualifying graph rationale. Reviewed 5 provisional leaders. Fixed prior exclusions: 10.

A category counts when it supplies a sourced rank. A disease, target or pathway rank supports a research hypothesis. A missing rank contributes zero. Negative trial evidence appears beside the rankings and does not enter this graph score.

Adequate local delivery is assumed for research retrieval. No passive BBB permeability feature, filter, or score.

| Rank | Research candidate | Categories | Disease | Gene | Safety | Pathway | Symptom | Penalty | Score |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | [Arimoclomol](DB05025.md) | 3/5 | 0.2829 | 0.2600 | 0.0000 | 0.1222 | 0.0000 | −0.0400 | 0.6251 |
| 2 | [Minocycline](DB01017.md) | 3/5 | 0.2475 | 0.2043 | 0.0000 | 0.1571 | 0.0000 | −0.0400 | 0.5689 |
| 3 | [Memantine](DB01043.md) | 3/5 | 0.2329 | 0.0000 | 0.1300 | 0.1467 | 0.0000 | −0.0000 | 0.5096 |
| 4 | [Acetylcysteine](DB06151.md) | 2/5 | 0.3300 | 0.0000 | 0.0000 | 0.1833 | 0.0000 | −0.0400 | 0.4733 |
| 5 | [Melatonin](DB01065.md) | 2/5 | 0.2640 | 0.0000 | 0.0000 | 0.2000 | 0.0000 | −0.0400 | 0.4240 |

### Review findings

- Arimoclomol (Compound::DB05025): **safety unresolved**. Decreased weight and diarrhea occurred in the labeled NPC setting with miglustat. Further loss matters after Alex fell from 86 to 77.5 kg; incidence in ALS or local delivery is unknown. ORARIALS-01 found no improvement in combined function and survival; gastrointestinal events and discontinuations were more frequent with arimoclomol. [dailymed.nlm.nih.gov](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=5feffc0e-453d-47fa-91dd-38d4952309bc) [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/38782015/)
- Minocycline (Compound::DB01017): **safety unresolved**. Documented harm in ALS: the treated group lost 1.30 ALSFRS-R points/month versus 1.04 on placebo (p=0.005). Preserving function is directly relevant to Alex's limb-onset disease. The larger phase III trial found faster functional decline. The limited pairwise tolerability data do not resolve that harm. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/17980667/) [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/16193258/)
  Medication-pair graph alert: [['Compound::DB00740', 'DRUGBANK::ddi-interactor-in::Compound:Compound', 'Compound::DB01017']]. Observed medication-pair interaction edge. Clinical significance requires independent verification.
- Acetylcysteine (Compound::DB06151): **safety unresolved**. The inhalation label warns about bronchospasm and an increased volume of liquefied secretions that may require suction if cough is inadequate. Reduced supine FVC makes airway clearance consequential; coughing on liquids does not prove an ineffective cough. A 110-person ALS trial of subcutaneous acetylcysteine found no significant overall survival or progression benefit. The limb-onset subgroup estimate included no effect. [dailymed.nlm.nih.gov](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=c90fca12-12fb-4cf6-bd6f-83bc0d95df81) [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/7763202/)
- Memantine (Compound::DB01043): **safety unresolved**. Kidney function and tolerability under the assumed route remain unknown. The randomized phase 2B study found no difference in ALS progression or neuropsychiatric outcomes. [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/39511965/) [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/20839903/) [dailymed.nlm.nih.gov](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=65c9e7bc-71f0-4113-8de1-4fcaa591735f)
- Melatonin (Compound::DB01065): **safety unresolved**. The Circadin prolonged-release formulation must be swallowed whole. Feasibility is uncertain in Alex, who coughs on thin liquids. This is a formulation warning, not a blanket veto on melatonin. A human ALS study of rectal melatonin reported tolerability and a biomarker change. Clinical functional benefit was not established. The whole-tablet issue concerns the separate prolonged-release oral formulation. [www.ema.europa.eu](https://www.ema.europa.eu/en/documents/product-information/circadin-epar-product-information_en.pdf) [pubmed.ncbi.nlm.nih.gov](https://pubmed.ncbi.nlm.nih.gov/17014688/) Source check limitations: PDF retrieved; text verified in manual review only  at https://www.ema.europa.eu/en/documents/product-information/circadin-epar-product-information_en.pdf
  Medication-pair graph alert: [['Compound::DB00740', 'DRUGBANK::ddi-interactor-in::Compound:Compound', 'Compound::DB01065']]. Observed medication-pair interaction edge. Clinical significance requires independent verification.

### Exclusions before ranking

- Riluzole (Compound::DB00740): Current therapy [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- ciprofloxacin (Compound::DB00537): Exclude named compounds with a verified label warning for increased riluzole exposure under this conservative research screen. A label warning does not establish an adverse event or an absolute contraindication. [dailymed.nlm.nih.gov](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=b117b981-476c-f9b8-e053-2995a90aee5f)
- enoxacin (Compound::DB00467): Exclude named compounds with a verified label warning for increased riluzole exposure under this conservative research screen. A label warning does not establish an adverse event or an absolute contraindication. [dailymed.nlm.nih.gov](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=b117b981-476c-f9b8-e053-2995a90aee5f)
- fluvoxamine (Compound::DB00176): Exclude named compounds with a verified label warning for increased riluzole exposure under this conservative research screen. A label warning does not establish an adverse event or an absolute contraindication. [dailymed.nlm.nih.gov](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=b117b981-476c-f9b8-e053-2995a90aee5f)
- methoxsalen (Compound::DB00553): Exclude named compounds with a verified label warning for increased riluzole exposure under this conservative research screen. A label warning does not establish an adverse event or an absolute contraindication. [dailymed.nlm.nih.gov](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=b117b981-476c-f9b8-e053-2995a90aee5f)
- mexiletine (Compound::DB00379): Exclude named compounds with a verified label warning for increased riluzole exposure under this conservative research screen. A label warning does not establish an adverse event or an absolute contraindication. [dailymed.nlm.nih.gov](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=b117b981-476c-f9b8-e053-2995a90aee5f)
- thiabendazole (Compound::DB00730): Exclude named compounds with a verified label warning for increased riluzole exposure under this conservative research screen. A label warning does not establish an adverse event or an absolute contraindication. [dailymed.nlm.nih.gov](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=b117b981-476c-f9b8-e053-2995a90aee5f)
- vemurafenib (Compound::DB08881): Exclude named compounds with a verified label warning for increased riluzole exposure under this conservative research screen. A label warning does not establish an adverse event or an absolute contraindication. [dailymed.nlm.nih.gov](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=b117b981-476c-f9b8-e053-2995a90aee5f)
- zileuton (Compound::DB00744): Exclude named compounds with a verified label warning for increased riluzole exposure under this conservative research screen. A label warning does not establish an adverse event or an absolute contraindication. [dailymed.nlm.nih.gov](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=b117b981-476c-f9b8-e053-2995a90aee5f)
- gabapentin (Compound::DB00996): Conservative exclusion for reduced respiratory reserve in this case. Section 5.8 warns of respiratory depression with underlying respiratory impairment; this is a monitoring warning, not an absolute contraindication. [dailymed.nlm.nih.gov](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=1045db4e-4c76-4a0d-bf12-019bd96a8f59)

New hard exclusions: none. Displaced from provisional five: none. Backfilled: none.

[Detailed machine-readable report](../alex-gated.json)
