"""ALS-specific criteria a sub-agent can define a target drug profile for.

M* = disease mechanisms (what a disease-modifying drug would act on).
S* = ALS symptoms (what a symptomatic drug would relieve).
Delivery, formulation and safety aren't criteria. They reach sub-agents as
brief constraints and land in each profile's required/avoid properties.
"""

CRITERIA: dict[str, tuple[str, str]] = {
    # ── disease mechanisms ──────────────────────────────────────────────────
    "M1": ("Glutamate excitotoxicity", "Excess glutamate signalling at motor neurons: release, AMPA/NMDA receptor calcium entry, loss of astrocytic EAAT2 uptake."),
    "M2": ("Motor neuron hyperexcitability", "Cortical and peripheral axon hyperexcitability: persistent sodium current, reduced potassium conductance, loss of inhibitory interneuron tone."),
    "M3": ("SOD1 toxicity", "Gain-of-function toxicity of misfolded mutant SOD1 (SOD1-ALS)."),
    "M4": ("C9orf72 repeat expansion", "G4C2 repeat RNA foci, dipeptide-repeat proteins, and C9orf72 haploinsufficiency."),
    "M5": ("FUS / TARDBP / other ALS genes", "Mutant FUS, TARDBP and other familial-ALS genes; ATXN2 intermediate repeats as a modifier."),
    "M6": ("TDP-43 proteinopathy", "TDP-43 mislocalisation and aggregation, and loss of its splicing function (cryptic exons in STMN2, UNC13A). Present in ~97% of ALS."),
    "M7": ("Neuroinflammation", "Microglial and astrocyte activation, peripheral immune and T-cell infiltration, complement."),
    "M8": ("Oxidative stress", "Reactive oxygen species, NRF2 antioxidant response, lipid peroxidation."),
    "M9": ("Mitochondrial dysfunction / energy metabolism", "Mitochondrial respiration, calcium buffering, hypermetabolism, bioenergetic failure of motor neurons."),
    "M10": ("Proteostasis / autophagy / ER stress", "Protein aggregate clearance, autophagy-lysosome pathway, heat-shock response, unfolded protein response."),
    "M11": ("Axonal transport / cytoskeleton", "Microtubule-based transport, neurofilament accumulation, axon integrity."),
    "M12": ("Neuromuscular junction / denervation", "NMJ stability and reinnervation (agrin-LRP4-MuSK), early distal axon retraction."),
    "M13": ("RNA metabolism / stress granules", "Aberrant stress granule dynamics, RNA-binding protein phase separation."),
    "M14": ("Nucleocytoplasmic transport", "Nuclear pore and importin/exportin defects that trap TDP-43 and other proteins in the cytoplasm."),
    "M15": ("Neurotrophic support", "Trophic signalling that keeps motor neurons alive: BDNF, GDNF, IGF-1, VEGF."),
    "M16": ("Cell death pathways", "Apoptosis, necroptosis (RIPK1), ferroptosis in motor neurons."),
    "M17": ("Blood-brain / blood-spinal cord barrier", "Barrier breakdown in ALS, and the barrier as an obstacle to CNS drug exposure."),
    "M18": ("Skeletal muscle function", "Muscle-intrinsic targets that preserve strength as innervation falls: contractility, mass, metabolism."),
    # ── ALS symptoms ────────────────────────────────────────────────────────
    "S1": ("Muscle cramps", "Painful cramps from hyperexcitable denervated motor units."),
    "S2": ("Spasticity", "Upper motor neuron stiffness and spasms."),
    "S3": ("Sialorrhea", "Drooling from impaired swallowing of normal saliva."),
    "S4": ("Thick secretions", "Tenacious bronchial and pharyngeal mucus with a weak cough."),
    "S5": ("Pseudobulbar affect", "Involuntary laughing or crying from corticobulbar disinhibition."),
    "S6": ("Pain", "Musculoskeletal, contracture and neuropathic pain in ALS."),
    "S7": ("Respiratory insufficiency / dyspnea", "Breathlessness and air hunger from respiratory muscle weakness."),
    "S8": ("Weight loss / hypermetabolism", "Unintended weight loss, cachexia and raised energy expenditure, an independent poor prognostic sign."),
    "S9": ("Fatigue", "Central and peripheral fatigue."),
    "S10": ("Sleep disruption", "Insomnia from cramps, discomfort, nocturnal hypoventilation or mood."),
    "S11": ("Depression / anxiety", "Mood and anxiety symptoms in ALS."),
    "S12": ("Constipation", "Reduced mobility, diet change and anticholinergic burden."),
    "S13": ("Cognitive / behavioural (ALS-FTD)", "Executive dysfunction, apathy, disinhibition."),
}


def catalog_text() -> str:
    return "\n".join(f"{cid}: {label} — {focus}" for cid, (label, focus) in CRITERIA.items())


def label(cid: str) -> str:
    return CRITERIA.get(cid, (cid, ""))[0]
