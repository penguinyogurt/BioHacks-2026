"""Research criteria the orchestrator can dispatch a sub-agent for.
Ids match docs/RESEARCH_AGENT_SPEC.md §3."""

CRITERIA: dict[str, tuple[str, str]] = {
    # A. disease-modifying / survival
    "A1": ("Extend survival / slow progression", "Drugs with survival or ALSFRS-R slope evidence in ALS."),
    "A2": ("Genetic subtype", "Therapies specific to an ALS gene (SOD1, C9orf72, FUS, TARDBP, ATXN2)."),
    "A3": ("Glutamate excitotoxicity", "Modulators of glutamate release, receptors or EAAT2 uptake."),
    "A4": ("Oxidative stress", "Free-radical scavengers, NRF2 activators."),
    "A5": ("TDP-43 proteinopathy", "TDP-43 aggregation, nuclear import, cryptic exon (STMN2, UNC13A) rescue."),
    "A6": ("Neuroinflammation", "Microglia/astrocyte-modulating immunomodulators."),
    "A7": ("Mitochondria / metabolism", "Bioenergetics, hypermetabolism, mitochondrial protection."),
    "A8": ("Proteostasis / autophagy", "Autophagy inducers, heat-shock response modulators."),
    "A9": ("Axonal transport / NMJ", "Cytoskeleton, axonal transport, neuromuscular-junction stability."),
    "A10": ("Neurofilament-lowering", "Drugs with evidence of lowering neurofilament light (NfL)."),
    # B. symptom relief
    "B1": ("Pain", "Musculoskeletal, neuropathic or contracture pain in ALS."),
    "B2": ("Muscle cramps", "Cramp relief in motor neuron disease."),
    "B3": ("Spasticity", "Antispasticity agents."),
    "B4": ("Sialorrhea", "Drooling / excess saliva."),
    "B5": ("Thick secretions", "Mucolytics and secretion management."),
    "B6": ("Pseudobulbar affect", "Involuntary laughing/crying."),
    "B7": ("Depression / anxiety", "Mood treatment suited to ALS."),
    "B8": ("Insomnia", "Sleep, with attention to respiratory safety of sedatives."),
    "B9": ("Fatigue", "Fatigue in neuromuscular disease."),
    "B10": ("Dyspnea / air hunger", "Symptomatic breathlessness relief."),
    "B11": ("Constipation", "Bowel management with reduced mobility."),
    "B12": ("Weight loss", "Weight and appetite preservation, hypermetabolism."),
    "B13": ("Cognitive / behavioural", "ALS-FTD cognitive or behavioural symptoms."),
    # C. body region
    "C1": ("Brain / upper motor neuron", "Targets in motor cortex; requires BBB penetration."),
    "C2": ("Spinal cord / lower motor neuron", "Spinal targets; BBB/BSCB or intrathecal routes."),
    "C3": ("Peripheral nerve / NMJ", "Peripherally acting drugs that don't need to cross the BBB."),
    "C4": ("Skeletal muscle", "Muscle-directed drugs (e.g. troponin activators) and their ALS trial record."),
    "C5": ("Respiratory muscles", "Diaphragm / respiratory function preservation."),
    "C6": ("Bulbar", "Tongue, lip and swallowing function."),
    # D. delivery
    "D1": ("BBB penetration", "CNS-penetrant drugs; P-gp efflux; physicochemical BBB likelihood."),
    "D2": ("Usable route / formulation", "Liquid, dispersible, film, transdermal or other non-tablet forms."),
    "D3": ("Dosing burden", "Once-daily, long half-life, no titration."),
    "D4": ("Pharmacogenomics", "CYP2D6 / CYP1A2-dependent drugs and their implications."),
    # E. safety
    "E1": ("Safety audit", "Interactions, respiratory depression, QT, anticholinergic burden, hepatotoxicity."),
    # F. evidence and trials
    "F1": ("Prior ALS trial failures", "Which candidates already failed in ALS trials, and why."),
    "F2": ("Recruiting ALS trials", "Recruiting interventional ALS trials and their key eligibility criteria."),
    "F3": ("Human-genetics support", "Targets with genetic association evidence for ALS."),
    "F4": ("Preclinical-only leads", "Promising preclinical candidates, with the translation gap stated."),
    "F5": ("Expanded access", "Compassionate-use / expanded-access programmes."),
    # G. access
    "G1": ("Practical access", "Approval status, generic availability, off-label feasibility."),
}


def catalog_text() -> str:
    return "\n".join(f"{cid}: {label} — {focus}" for cid, (label, focus) in CRITERIA.items())


def label(cid: str) -> str:
    return CRITERIA.get(cid, (cid, ""))[0]
