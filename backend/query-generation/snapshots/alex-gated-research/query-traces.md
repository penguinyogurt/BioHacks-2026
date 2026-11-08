# Queries and investigational rankings

Each query scores every eligible ingredient. A reported category rank also requires a witness or documentary review. Distance uses the 400 frozen dimensions.

## Disease / indications

- “Limb-onset ALS, diagnosed 2026.” — exact terminology match. Disease::MESH:D000690 (patient_profile.summary). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)

**Example trace**. “Limb-onset ALS, diagnosed 2026.” → Amyotrophic Lateral Sclerosis (`Disease::MESH:D000690`, frozen entity row 25880). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- Relation row 35, reverse: `GNBR::T::Compound:Disease`
- `q = e[Disease::MESH:D000690] - r[GNBR::T::Compound:Disease]`
- `||e[Compound::DB00148] - q||₂ = 10.229743` (Creatine).
- Observed support: Compound::DB00148 → GNBR::T::Compound:Disease → Disease::MESH:D000690

| Rank | Ingredient | L2 |
|---:|---|---:|
| 1 | Creatine (Compound::DB00148) | 10.229743 |
| 2 | Acetylcysteine (Compound::DB06151) | 10.337566 |
| 3 | Trehalose (Compound::DB12310) | 10.363054 |
| 4 | Arimoclomol (Compound::DB05025) | 10.404753 |
| 5 | Melatonin (Compound::DB01065) | 10.532325 |
| 6 | Minocycline (Compound::DB01017) | 10.902138 |
| 7 | Memantine (Compound::DB01043) | 10.920689 |
| 8 | Ceftriaxone (Compound::DB01212) | 11.277060 |
| 9 | Rasagiline (Compound::DB01367) | 11.350569 |

## Genes / targets

- “Limb-onset ALS, diagnosed 2026.” — exact terminology match. Disease::MESH:D000690 (patient_profile.summary). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)

**Example trace**. “Limb-onset ALS, diagnosed 2026.” → SOD1 (`Gene::6647`, frozen entity row 464). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- Observed anchor evidence: Disease::MESH:D000690 → Hetionet::DaG::Disease:Gene → Gene::6647
- Relation row 21, reverse: `DRUGBANK::target::Compound:Gene`
- `q = e[Gene::6647] - r[DRUGBANK::target::Compound:Gene]`
- `||e[Compound::DB05025] - q||₂ = 9.719035` (Arimoclomol).
- Observed support: Compound::DB05025 → DRUGBANK::target::Compound:Gene → Gene::6647

| Rank | Ingredient | L2 |
|---:|---|---:|
| 1 | Arimoclomol (Compound::DB05025) | 9.719035 |
| 2 | Celecoxib (Compound::DB00482) | 10.096464 |
| 3 | Topiramate (Compound::DB00273) | 10.702314 |
| 4 | Minocycline (Compound::DB01017) | 11.139761 |

## Safety / interactions / class

- “Riluzole 50 mg BID” — exact terminology match. Compound::DB00740 (patient_profile.findings[0].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “FVC 76% sitting, 61% supine” — no graph mapping.  (patient_profile.findings[1].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “86 → 77.5 kg, unintentional” — no graph mapping.  (patient_profile.findings[2].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “470 U/L (ref < 195)” — no graph mapping.  (patient_profile.findings[3].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “Coughs on thin liquids” — swallowing-difficulty hypothesis; cough with liquids. Disease::MESH:D003680 (patient_profile.findings[4].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “Right pinch 3 kg, grip 14 kg” — no graph mapping.  (patient_profile.findings[5].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)

**Example trace**. “Riluzole 50 mg BID” → Riluzole (`Compound::DB00740`, frozen entity row 10680). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- Observed anchor evidence: Compound::DB00740 → DRUGBANK::ddi-interactor-in::Compound:Compound → Compound::DB00744
- Relation row 20, forward: `DRUGBANK::ddi-interactor-in::Compound:Compound`
- `q = e[Compound::DB00740] + r[DRUGBANK::ddi-interactor-in::Compound:Compound]`
- `||e[Compound::DB01043] - q||₂ = 11.478287` (Memantine).
- Documentary support: Section 12.3 reports minimal CYP1A2 inhibition in vitro. This supports only a narrow interaction review. [dailymed.nlm.nih.gov](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=65c9e7bc-71f0-4113-8de1-4fcaa591735f)

| Rank | Ingredient | L2 |
|---:|---|---:|
| 1 | Memantine (Compound::DB01043) | 11.478287 |

## Pathways / processes

- “Limb-onset ALS, diagnosed 2026.” — exact terminology match. Disease::MESH:D000690 (patient_profile.summary). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)

**Example trace**. “Limb-onset ALS, diagnosed 2026.” → regulation of neuron death (`Biological Process::GO:1901214`, frozen entity row 64954). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- Observed anchor evidence: Disease::MESH:D000690 → Hetionet::DaG::Disease:Gene → Gene::10280
- Observed anchor evidence: Gene::10280 → Hetionet::GpBP::Gene:Biological Process → Biological Process::GO:1901214
- Relation row 62, reverse: `Hetionet::GpBP::Gene:Biological Process`
- Relation row 69, reverse: `Hetionet::CbG::Compound:Gene`
- `q = e[Biological Process::GO:1901214] - r[Hetionet::GpBP::Gene:Biological Process] - r[Hetionet::CbG::Compound:Gene]`
- `||e[Compound::DB01065] - q||₂ = 12.115724` (Melatonin).
- Observed support: Gene::2099 → Hetionet::GpBP::Gene:Biological Process → Biological Process::GO:1901214
- Observed support: Compound::DB01065 → Hetionet::CbG::Compound:Gene → Gene::2099

| Rank | Ingredient | L2 |
|---:|---|---:|
| 1 | Melatonin (Compound::DB01065) | 12.115724 |
| 2 | Acetylcysteine (Compound::DB06151) | 12.147284 |
| 3 | Topiramate (Compound::DB00273) | 12.731752 |
| 4 | Minocycline (Compound::DB01017) | 12.868723 |
| 5 | Memantine (Compound::DB01043) | 13.018803 |
| 6 | Rasagiline (Compound::DB01367) | 13.136274 |
| 7 | Pioglitazone (Compound::DB01132) | 13.656400 |
| 8 | Arimoclomol (Compound::DB05025) | 13.850897 |

## Symptoms / function

- “FVC 76% sitting, 61% supine” — no graph mapping.  (patient_profile.findings[1].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “86 → 77.5 kg, unintentional” — no graph mapping.  (patient_profile.findings[2].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “470 U/L (ref < 195)” — no graph mapping.  (patient_profile.findings[3].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “Coughs on thin liquids” — swallowing-difficulty hypothesis; cough with liquids. Disease::MESH:D003680 (patient_profile.findings[4].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “Right pinch 3 kg, grip 14 kg” — no graph mapping.  (patient_profile.findings[5].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)

**Example trace**. “Coughs on thin liquids” → Deglutition Disorders (`Disease::MESH:D003680`, frozen entity row 43786). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- Relation row 35, reverse: `GNBR::T::Compound:Disease`
- `q = e[Disease::MESH:D003680] - r[GNBR::T::Compound:Disease]`
- `||e[Compound::DB01065] - q||₂ = 11.597966` (Melatonin).
- Exploratory distance only. No eligible ingredient has a supporting witness for a category rank.

| Rank | Ingredient | L2 |
|---:|---|---:|
| — | Agent abstained | — |
