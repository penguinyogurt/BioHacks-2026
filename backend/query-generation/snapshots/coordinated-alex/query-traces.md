# Queries and investigational rankings

Each query scores all eligible compounds in 400 frozen dimensions. The handoff rankings include predictions without direct edges. The tables here show the narrower graph-witness or documentary ranks used for final fusion.

## Disease / indications

- “Amyotrophic Lateral Sclerosis” — reported. Disease::MESH:D000690 (patient_profile.summary). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)

**Example trace**. “Amyotrophic Lateral Sclerosis” → Amyotrophic Lateral Sclerosis (`Disease::MESH:D000690`, frozen entity row 25880). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
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
| 5 | Compound::DB11846 (Compound::DB11846) | 10.468664 |
| 6 | Pridopidine (Compound::DB11947) | 10.500629 |
| 7 | Melatonin (Compound::DB01065) | 10.532325 |
| 8 | Testosterone (Compound::DB00624) | 10.603622 |
| 9 | Compound::DB03614 (Compound::DB03614) | 10.676634 |
| 10 | Compound::DB02530 (Compound::DB02530) | 10.702107 |
| 11 | Compound::DB03128 (Compound::DB03128) | 10.732637 |
| 12 | Sirolimus (Compound::DB00877) | 10.769591 |
| 13 | Compound::DB11094 (Compound::DB11094) | 10.809077 |
| 14 | Valproic Acid (Compound::DB00313) | 10.836759 |
| 15 | Minocycline (Compound::DB01017) | 10.902138 |
| 16 | Memantine (Compound::DB01043) | 10.920689 |
| 17 | Quinidine (Compound::DB00908) | 10.934999 |
| 18 | Compound::DB08844 (Compound::DB08844) | 11.069215 |
| 19 | Guanidine (Compound::DB00536) | 11.145794 |
| 20 | Verapamil (Compound::DB00661) | 11.204856 |
| 21 | Baclofen (Compound::DB00181) | 11.232203 |
| 22 | Compound::DB09421 (Compound::DB09421) | 11.261211 |
| 23 | Selegiline (Compound::DB01037) | 11.263516 |
| 24 | Ceftriaxone (Compound::DB01212) | 11.277060 |
| 25 | Rasagiline (Compound::DB01367) | 11.350569 |
| 26 | L-Threonine (Compound::DB00156) | 11.356723 |
| 27 | Dextromethorphan (Compound::DB00514) | 11.515594 |
| 28 | Tauroursodeoxycholic acid (Compound::DB08834) | 11.707761 |
| 29 | Compound::DB14509 (Compound::DB14509) | 11.833156 |

## Genes / targets

- “Amyotrophic Lateral Sclerosis” — reported. Gene::6506 (patient_profile.summary). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)

**Example trace**. “Amyotrophic Lateral Sclerosis” → SLC1A2 (`Gene::6506`, frozen entity row 1293). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- Relation row 30, reverse: `GNBR::E+::Compound:Gene`
- `q = e[Gene::6506] - r[GNBR::E+::Compound:Gene]`
- `||e[Compound::DB00145] - q||₂ = 10.814427` (Glycine).
- Exploratory distance only. No eligible ingredient has a supporting witness for a category rank.

| Rank | Ingredient | L2 |
|---:|---|---:|
| — | Agent abstained | — |

## Safety / interactions / class

- “Active therapy with a labeled CYP1A2 interaction concern.” — reported. Gene::1544 (patient_profile.findings[0].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “Lower supine than sitting vital capacity is reported.” — reported.  (patient_profile.findings[1].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “Unintentional weight loss is reported.” — reported.  (patient_profile.findings[2].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “Muscle-enzyme value above the reported reference limit.” — reported.  (patient_profile.findings[3].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “Swallowing or cough with liquids is reported.” — reported.  (patient_profile.findings[4].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “Grip and pinch findings recorded.” — reported.  (patient_profile.findings[5].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)

**Example trace**. “Active therapy with a labeled CYP1A2 interaction concern.” → CYP1A2 (`Gene::1544`, frozen entity row 196). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- Relation row 27, reverse: `GNBR::N::Compound:Gene`
- `q = e[Gene::1544] - r[GNBR::N::Compound:Gene]`
- `||e[Compound::DB01043] - q||₂ = 11.534088` (Memantine).
- Documentary support: Section 12.3 reports minimal CYP1A2 inhibition in vitro. This supports only a narrow interaction review. [dailymed.nlm.nih.gov](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=65c9e7bc-71f0-4113-8de1-4fcaa591735f)

| Rank | Ingredient | L2 |
|---:|---|---:|
| 1 | Memantine (Compound::DB01043) | 11.534088 |

## Pathways / processes

- “Amyotrophic Lateral Sclerosis” — reported. Biological Process::GO:0015813 (patient_profile.summary). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)

**Example trace**. “Amyotrophic Lateral Sclerosis” → L-glutamate transport (`Biological Process::GO:0015813`, frozen entity row 71642). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- Observed anchor evidence: Gene::6506 → Hetionet::GpBP::Gene:Biological Process → Biological Process::GO:0015813
- Relation row 62, reverse: `Hetionet::GpBP::Gene:Biological Process`
- Relation row 30, reverse: `GNBR::E+::Compound:Gene`
- `q = e[Biological Process::GO:0015813] - r[Hetionet::GpBP::Gene:Biological Process] - r[GNBR::E+::Compound:Gene]`
- `||e[Compound::DB00138] - q||₂ = 12.607830` (L-Cystine).
- Exploratory distance only. No eligible ingredient has a supporting witness for a category rank.

| Rank | Ingredient | L2 |
|---:|---|---:|
| — | Agent abstained | — |

## Symptoms / function

- “Swallowing or cough with liquids is reported.” — reported. Disease::MESH:D003680 (patient_profile.findings[4].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “Grip and pinch findings recorded.” — reported.  (patient_profile.findings[5].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “Lower supine than sitting vital capacity is reported.” — reported.  (patient_profile.findings[1].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- “Unintentional weight loss is reported.” — reported.  (patient_profile.findings[2].value). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)

**Example trace**. “Swallowing or cough with liquids is reported.” → Deglutition Disorders (`Disease::MESH:D003680`, frozen entity row 43786). [github.com](https://github.com/penguinyogurt/BioHacks-2026/blob/da0eb26f5e774491ad5b9502aa5d110168c829de/data/pipeline.json)
- Relation row 35, reverse: `GNBR::T::Compound:Disease`
- `q = e[Disease::MESH:D003680] - r[GNBR::T::Compound:Disease]`
- `||e[Compound::DB00898] - q||₂ = 10.545600` (Ethanol).
- Observed support: Compound::DB00898 → GNBR::T::Compound:Disease → Disease::MESH:D003680

| Rank | Ingredient | L2 |
|---:|---|---:|
| 1 | Ethanol (Compound::DB00898) | 10.545600 |
| 2 | Compound::DB06774 (Compound::DB06774) | 10.625277 |
| 3 | Compound::DB11783 (Compound::DB11783) | 11.089624 |
| 4 | Isosorbide Dinitrate (Compound::DB00883) | 11.130301 |
| 5 | Cisapride (Compound::DB00604) | 11.139059 |
