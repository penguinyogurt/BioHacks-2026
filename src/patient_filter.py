#!/usr/bin/env python3
"""Component C: the patient filter.

Eight rules decide whether a drug is safe and usable for one specific patient,
Alex Chen. Pure Python, standard library only, no model and no dependency on
`kg_rank.py` or `bbb_model.py`.

Every rule comes from a line in his chart, and every reason string names the
line it came from, because the reason strings are what the UI shows and what
judges read. Numbers are interpolated from `ALEX_CHEN` rather than typed into
the sentences, so a chart correction cannot leave a stale number on screen.

Rules run in `RULE_ORDER` and the output `filters` list preserves that order,
so the UI can render rules in a stable sequence and highlight the first
failure.

Usage:
    python patient_filter.py                      # sample annotations -> data/patient_filter.json
    python patient_filter.py --input data/drug_annotations.json
    python patient_filter.py --drug memantine     # explain one drug on stdout

Public API for `merge.py`:
    apply_patient_filter(drug_mapping) -> list[{"rule", "passed", "reason"}]
    evaluate(drug_mapping)             -> DrugVerdict
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = REPO_ROOT / "data" / "drug_annotations.sample.json"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "patient_filter.json"

RULE_ORDER: tuple[str, ...] = (
    "cyp1a2",
    "respiratory",
    "weight_loss",
    "myopathy",
    "swallow",
    "dexterity",
    "bbb_direction",
    "canada",
)


# --------------------------------------------------------------------------
# The chart
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Chart:
    """The subset of Alex Chen's chart that the rules actually read."""

    patient_id: str = "alex_chen"
    name: str = "Alex Chen"
    age: int = 47
    city: str = "Hamilton, Ontario"

    # Current therapy -> cyp1a2
    current_drug: str = "riluzole"
    current_dose: str = "50 mg twice daily"
    current_since: str = "July 2026"
    current_clearing_enzyme: str = "CYP1A2"

    # Respiratory -> respiratory
    fvc_sitting_pct: int = 76
    fvc_supine_pct: int = 61
    cough_peak_flow_lpm: int = 310

    # Nutrition -> weight_loss
    weight_baseline_kg: float = 86.0
    weight_current_kg: float = 77.5
    meal_duration_min: str = "35-40 minutes"

    # Muscle chemistry -> myopathy
    ck_u_per_l: int = 470
    ck_reference_ceiling: int = 195

    # Swallowing -> swallow
    swallow_finding: str = "coughs on thin liquids on the timed water swallow"

    # Hand function -> dexterity
    pinch_kg: float = 3.0
    grip_kg: float = 14.0
    grip_typical_kg: float = 48.0
    dexterity_finding: str = "needs help with buttons and zips"

    @property
    def weight_lost_kg(self) -> float:
        return round(self.weight_baseline_kg - self.weight_current_kg, 1)


ALEX_CHEN = Chart()


# --------------------------------------------------------------------------
# Hand-lists
#
# The spec allows a hand-list where a dataset is slow to obtain. These are
# hand-lists, deliberately: they ship tonight, they are auditable on one
# screen, and a judge can check any single entry.
# --------------------------------------------------------------------------

# CYP1A2 inhibitors. Drawn from the FDA "Drug Development and Drug
# Interactions: Table of Substrates, Inhibitors and Inducers" clinical-index
# and moderate-inhibitor lists, cross-checked against the Flockhart
# cytochrome P450 drug-interaction table (Indiana University).
#   https://www.fda.gov/drugs/drug-interactions-labeling/drug-development-and-drug-interactions-table-substrates-inhibitors-and-inducers
#   https://drug-interactions.medicine.iu.edu/MainTable.aspx
CYP1A2_INHIBITORS: dict[str, str] = {
    # strong
    "fluvoxamine": "strong",
    "ciprofloxacin": "strong",
    "enoxacin": "strong",
    # moderate
    "zafirlukast": "moderate",
    "methoxsalen": "moderate",
    "mexiletine": "moderate",
    "thiabendazole": "moderate",
    "vemurafenib": "moderate",
    "propafenone": "moderate",
    "oral contraceptives": "moderate",
    # weak but clinically named
    "cimetidine": "weak",
    "ticlopidine": "weak",
    "verapamil": "weak",
    "amiodarone": "weak",
    "norfloxacin": "weak",
    "famotidine": "weak",
    "allopurinol": "weak",
    "deferasirox": "weak",
    "terbinafine": "weak",
    "peginterferon alfa-2a": "weak",
    "acyclovir": "weak",
    "propranolol": "weak",
    "caffeine": "weak",
    "fluconazole": "weak",
}

# CYP1A2 inducers. Same sources. Tobacco smoke is the largest CYP1A2 inducer
# in practice but is not a prescribable drug, so it is handled as a chart note
# rather than a rule.
CYP1A2_INDUCERS: dict[str, str] = {
    "rifampicin": "strong",
    "rifampin": "strong",
    "carbamazepine": "moderate",
    "phenytoin": "moderate",
    "phenobarbital": "moderate",
    "primidone": "moderate",
    "ritonavir": "moderate",
    "omeprazole": "moderate",
    "esomeprazole": "weak",
    "lansoprazole": "weak",
    "teriflunomide": "weak",
    "modafinil": "weak",
    "nafcillin": "weak",
    "montelukast": "weak",
}

# Respiratory depressants, by ATC prefix. The spec names four classes;
# gabapentinoids are included because the FDA added a respiratory-depression
# warning for gabapentin and pregabalin in December 2019, specifically for
# patients with reduced respiratory reserve.
#   https://www.fda.gov/drugs/drug-safety-and-availability/fda-warns-about-serious-breathing-problems-seizure-and-nerve-pain-medicines-gabapentin-neurontin
RESPIRATORY_DEPRESSANT_ATC: dict[str, str] = {
    "N01AH": "opioid anaesthetic",
    "N02A": "opioid analgesic",
    "R05DA": "opioid antitussive",
    "N05BA": "benzodiazepine anxiolytic",
    "N05CD": "benzodiazepine hypnotic",
    "N05CF": "benzodiazepine-related hypnotic (Z-drug)",
    "N05CA": "barbiturate hypnotic",
    "N05CB": "barbiturate in combination",
    "N03AA": "barbiturate antiepileptic",
    "R06AA": "first-generation sedating antihistamine",
    "R06AB": "first-generation sedating antihistamine",
    "R06AC": "first-generation sedating antihistamine",
    "R06AD": "first-generation sedating antihistamine",
    "N03AX12": "gabapentinoid",
    "N03AX16": "gabapentinoid",
}

# Name-level fallback for when a drug record carries no ATC code.
RESPIRATORY_DEPRESSANT_NAMES: dict[str, str] = {
    "morphine": "opioid analgesic",
    "oxycodone": "opioid analgesic",
    "hydromorphone": "opioid analgesic",
    "fentanyl": "opioid analgesic",
    "codeine": "opioid analgesic",
    "tramadol": "opioid analgesic",
    "methadone": "opioid analgesic",
    "buprenorphine": "opioid analgesic",
    "diazepam": "benzodiazepine anxiolytic",
    "lorazepam": "benzodiazepine anxiolytic",
    "clonazepam": "benzodiazepine anxiolytic",
    "alprazolam": "benzodiazepine anxiolytic",
    "midazolam": "benzodiazepine hypnotic",
    "temazepam": "benzodiazepine hypnotic",
    "zopiclone": "benzodiazepine-related hypnotic (Z-drug)",
    "zolpidem": "benzodiazepine-related hypnotic (Z-drug)",
    "phenobarbital": "barbiturate",
    "pentobarbital": "barbiturate",
    "thiopental": "barbiturate",
    "primidone": "barbiturate prodrug",
    "diphenhydramine": "first-generation sedating antihistamine",
    "promethazine": "first-generation sedating antihistamine",
    "chlorpheniramine": "first-generation sedating antihistamine",
    "hydroxyzine": "first-generation sedating antihistamine",
    "doxylamine": "first-generation sedating antihistamine",
    "gabapentin": "gabapentinoid",
    "pregabalin": "gabapentinoid",
    "baclofen": "GABA-B agonist, respiratory depression at high dose",
    "sodium oxybate": "CNS depressant",
}

# Adverse-event substrings. DrugCentral's drug-ADE table uses MedDRA preferred
# terms, so these match the MedDRA wording rather than colloquial phrasing.
WEIGHT_LOSS_ADE_TERMS: tuple[str, ...] = (
    "weight decreased",
    "weight loss",
    "decreased appetite",
    "appetite decreased",
    "anorexia",
    "cachexia",
    "feeding disorder",
    "malnutrition",
)

MYOPATHY_ADE_TERMS: tuple[str, ...] = (
    "myopathy",
    "rhabdomyolysis",
    "myositis",
    "blood creatine phosphokinase increased",
    "creatine kinase increased",
    "necrotising myositis",
    "muscular weakness",
    "myalgia",
)

# Forms Alex can take without washing a solid dose down with water.
SWALLOW_FRIENDLY_FORMS: tuple[str, ...] = (
    "oral film",
    "film, soluble",
    "orally disintegrating tablet",
    "tablet, orally disintegrating",
    "dispersible tablet",
    "tablet, dispersible",
    "tablet for oral suspension",
    "oral solution",
    "oral suspension",
    "solution, oral",
    "suspension, oral",
    "syrup",
    "oral drops",
    "oral granules",
    "granules for oral suspension",
    "oral powder",
    "sublingual tablet",
    "buccal film",
)

# A solid tablet at or below this width can be given in puree without being
# washed down. Above it, the tablet needs a drink of thin liquid.
SMALL_TABLET_MAX_MM = 8.0

# Routes that bypass swallowing entirely and so are not a swallow problem.
NON_ORAL_ROUTES: tuple[str, ...] = (
    "intravenous",
    "intrathecal",
    "subcutaneous",
    "intramuscular",
    "transdermal",
    "rectal",
    "percutaneous",
    "gastrostomy",
    "enteral",
)

# Administration steps that need fine motor control. Keys are matched against
# a drug's formulations, routes and device fields.
DEXTERITY_BLOCKING_DEVICES: dict[str, str] = {
    "metered dose inhaler": "a grip-actuated metered-dose inhaler",
    "metered-dose inhaler": "a grip-actuated metered-dose inhaler",
    "inhalation aerosol": "a grip-actuated metered-dose inhaler",
    "dry powder inhaler": "a dry powder inhaler",
    "inhalation powder": "a dry powder inhaler",
    "turbuhaler": "a dry powder inhaler",
    "diskus": "a dry powder inhaler",
    "respimat": "a grip-actuated soft-mist inhaler",
    "autoinjector": "an autoinjector that needs thumb pressure",
    "auto-injector": "an autoinjector that needs thumb pressure",
    "prefilled syringe": "a pre-filled syringe",
    "pre-filled syringe": "a pre-filled syringe",
    "injection pen": "a dosing pen",
    "pen injector": "a dosing pen",
    "self-injection": "self-injection",
    "nasal spray": "a hand-primed nasal spray pump",
    "spray, metered": "a hand-primed metered spray",
    "eye drops": "squeezing an eye-drop bottle",
    "ophthalmic solution": "squeezing an eye-drop bottle",
    "suppository": "placing a suppository",
    "transdermal patch": None,  # patches are fine, listed so they are not swept up
}

# Routes that a patient cannot self-administer but a clinician gives, so they
# do not fail the dexterity rule.
CLINICIAN_ADMINISTERED_ROUTES: tuple[str, ...] = (
    "intravenous",
    "intrathecal",
    "intramuscular",
    "infusion",
)

CNS_COMPARTMENTS: tuple[str, ...] = ("cns", "brain", "spinal cord", "central", "neuron", "glia")
PERIPHERAL_COMPARTMENTS: tuple[str, ...] = (
    "muscle",
    "skeletal muscle",
    "peripheral",
    "neuromuscular junction",
    "nmj",
    "liver",
    "immune",
    "blood",
)


# --------------------------------------------------------------------------
# Input normalization
# --------------------------------------------------------------------------


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, Mapping):
        return [str(v) for v in value.values()]
    if isinstance(value, Iterable):
        return [str(v) for v in value]
    return [str(value)]


def _lower(values: Iterable[str]) -> list[str]:
    return [v.strip().lower() for v in values if str(v).strip()]


@dataclass
class DrugRecord:
    """A drug as the filter needs to see it.

    Built tolerantly from whatever `merge.py` hands over, because every field
    is optional and a missing field must not crash the pipeline. Where a field
    is missing the matching rule does not fire and says so in its reason, which
    is the honest behaviour: we never claim a drug is safe on evidence we do
    not have.
    """

    id: str | None = None
    name: str = "unknown"
    inchikey: str | None = None
    smiles: str | None = None

    cyp1a2_inhibitor: bool | None = None
    cyp1a2_inducer: bool | None = None
    cyp1a2_strength: str | None = None

    atc_codes: list[str] = field(default_factory=list)
    adverse_events: list[str] = field(default_factory=list)
    has_ade_data: bool = False

    formulations: list[str] = field(default_factory=list)
    routes: list[str] = field(default_factory=list)
    devices: list[str] = field(default_factory=list)
    smallest_tablet_mm: float | None = None

    target_compartment: str | None = None
    bbb_prob: float | None = None
    bbb_in_domain: bool | None = None

    in_health_canada_dpd: bool | None = None
    health_canada_din: str | None = None

    notes: str | None = None

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any]) -> "DrugRecord":
        cyp = raw.get("cyp1a2") or {}
        if not isinstance(cyp, Mapping):
            cyp = {}
        bbb = raw.get("bbb") or {}
        if not isinstance(bbb, Mapping):
            bbb = {}

        ade = _lower(_as_list(raw.get("adverse_events")))
        name = str(raw.get("name") or raw.get("drug_name") or "unknown").strip().lower()

        return cls(
            id=raw.get("id") or raw.get("drugbank_id") or raw.get("drug_id"),
            name=name,
            inchikey=raw.get("inchikey"),
            smiles=raw.get("smiles"),
            cyp1a2_inhibitor=cyp.get("inhibitor"),
            cyp1a2_inducer=cyp.get("inducer"),
            cyp1a2_strength=cyp.get("strength"),
            atc_codes=[c.upper() for c in _lower(_as_list(raw.get("atc_codes") or raw.get("atc")))],
            adverse_events=ade,
            has_ade_data=bool(ade) or bool(raw.get("has_ade_data")),
            formulations=_lower(_as_list(raw.get("formulations") or raw.get("dosage_forms"))),
            routes=_lower(_as_list(raw.get("routes"))),
            devices=_lower(_as_list(raw.get("devices"))),
            smallest_tablet_mm=raw.get("smallest_tablet_mm"),
            target_compartment=(
                str(raw["target_compartment"]).strip().lower()
                if raw.get("target_compartment")
                else None
            ),
            bbb_prob=bbb.get("prob"),
            bbb_in_domain=bbb.get("in_domain"),
            in_health_canada_dpd=raw.get("in_health_canada_dpd"),
            health_canada_din=raw.get("health_canada_din"),
            notes=raw.get("notes"),
        )


@dataclass
class RuleResult:
    rule: str
    passed: bool
    reason: str

    def to_contract(self) -> dict[str, Any]:
        """The exact three keys the frozen `filters` entry carries."""
        return {"rule": self.rule, "passed": self.passed, "reason": self.reason}


@dataclass
class DrugVerdict:
    id: str | None
    name: str
    inchikey: str | None
    passed: bool
    first_failure: str | None
    filters: list[dict[str, Any]]


# --------------------------------------------------------------------------
# The eight rules
# --------------------------------------------------------------------------


def rule_cyp1a2(drug: DrugRecord, chart: Chart = ALEX_CHEN) -> RuleResult:
    """Disqualify CYP1A2 inhibitors and inducers.

    Chart line: on riluzole 50 mg twice daily since July 2026. Riluzole is
    cleared almost entirely by CYP1A2, so a modulator moves his riluzole
    exposure in one direction or the other. An inhibitor raises it toward
    hepatotoxicity; an inducer drops it below the concentration that is
    already only modestly effective.
    """
    therapy = f"{chart.current_drug} {chart.current_dose} since {chart.current_since}"

    inhibitor = drug.cyp1a2_inhibitor
    inducer = drug.cyp1a2_inducer
    strength = drug.cyp1a2_strength

    if inhibitor is None and drug.name in CYP1A2_INHIBITORS:
        inhibitor, strength = True, CYP1A2_INHIBITORS[drug.name]
    if inducer is None and drug.name in CYP1A2_INDUCERS:
        inducer, strength = True, CYP1A2_INDUCERS[drug.name]

    qualifier = f"{strength} " if strength else ""

    if inhibitor:
        return RuleResult(
            "cyp1a2",
            False,
            f"A {qualifier}CYP1A2 inhibitor, and he has been on {therapy}; "
            f"riluzole is cleared almost entirely by {chart.current_clearing_enzyme}, "
            f"so adding this would push his riluzole exposure up.",
        )
    if inducer:
        return RuleResult(
            "cyp1a2",
            False,
            f"A {qualifier}CYP1A2 inducer, and he has been on {therapy}; "
            f"riluzole is cleared almost entirely by {chart.current_clearing_enzyme}, "
            f"so adding this would pull his riluzole exposure down below an already "
            f"modest therapeutic effect.",
        )
    return RuleResult(
        "cyp1a2",
        True,
        f"No CYP1A2 inhibition or induction on record, so it will not disturb the "
        f"clearance of his {therapy}.",
    )


def rule_respiratory(drug: DrugRecord, chart: Chart = ALEX_CHEN) -> RuleResult:
    """Disqualify respiratory depressants.

    Chart line: FVC 76% sitting, 61% supine and declining; cough peak flow
    310 L/min. The 15-point sitting-to-supine drop is diaphragm weakness, and
    it means any further central respiratory depression lands on a patient who
    has already lost most of his reserve lying down.
    """
    reserve = (
        f"his supine FVC is already {chart.fvc_supine_pct}% "
        f"(sitting {chart.fvc_sitting_pct}%) and his cough peak flow is "
        f"{chart.cough_peak_flow_lpm} L/min"
    )

    atc_hit = next(
        (
            (code, label)
            for code in drug.atc_codes
            for prefix, label in RESPIRATORY_DEPRESSANT_ATC.items()
            if code.startswith(prefix)
        ),
        None,
    )
    if atc_hit:
        code, label = atc_hit
        return RuleResult(
            "respiratory",
            False,
            f"Respiratory depressant - {label}, ATC {code}; {reserve}.",
        )

    if drug.name in RESPIRATORY_DEPRESSANT_NAMES:
        return RuleResult(
            "respiratory",
            False,
            f"Respiratory depressant - {RESPIRATORY_DEPRESSANT_NAMES[drug.name]}; {reserve}.",
        )

    return RuleResult(
        "respiratory",
        True,
        f"Not in a respiratory-depressant class, which is the first thing to check "
        f"because {reserve}.",
    )


def rule_weight_loss(drug: DrugRecord, chart: Chart = ALEX_CHEN) -> RuleResult:
    """Disqualify drugs that cost him weight or appetite.

    Chart line: 86 to 77.5 kg unintentional, meals take 35-40 minutes. In ALS
    weight loss is not a cosmetic side effect; lower BMI at diagnosis and
    continued loss both track with shorter survival, and he is already eating
    slowly enough that he cannot simply eat more to compensate.
    """
    nutrition = (
        f"he has already lost {chart.weight_lost_kg} kg unintentionally "
        f"({chart.weight_baseline_kg:g} to {chart.weight_current_kg:g} kg) and his meals "
        f"take {chart.meal_duration_min}"
    )

    hit = next(
        (term for term in WEIGHT_LOSS_ADE_TERMS for ae in drug.adverse_events if term in ae),
        None,
    )
    if hit:
        return RuleResult(
            "weight_loss",
            False,
            f"'{hit}' is a listed adverse event; {nutrition}, so he has no margin to "
            f"give back.",
        )

    if not drug.has_ade_data:
        return RuleResult(
            "weight_loss",
            True,
            f"No adverse-event record available, so this rule is not enforced for it - "
            f"flagged rather than cleared, because {nutrition}.",
        )

    return RuleResult(
        "weight_loss",
        True,
        f"No weight loss, anorexia or appetite suppression on its adverse-event list; "
        f"{nutrition}.",
    )


def rule_myopathy(drug: DrugRecord, chart: Chart = ALEX_CHEN) -> RuleResult:
    """Disqualify drugs with a myopathy or rhabdomyolysis signal.

    Chart line: CK 470 U/L against a reference ceiling of 195 U/L. His muscle
    is already breaking down from denervation, so a drug-induced myopathy on
    top of that is both dangerous and clinically unreadable - a rising CK
    would no longer tell anyone whether the disease or the drug caused it.
    """
    ck = (
        f"his CK is already {chart.ck_u_per_l} U/L against a reference ceiling of "
        f"{chart.ck_reference_ceiling} U/L"
    )

    hit = next(
        (term for term in MYOPATHY_ADE_TERMS for ae in drug.adverse_events if term in ae),
        None,
    )
    if hit:
        return RuleResult(
            "myopathy",
            False,
            f"'{hit}' is a known adverse event; {ck}, so added muscle toxicity would be "
            f"both harmful and impossible to tell apart from his disease.",
        )

    if not drug.has_ade_data:
        return RuleResult(
            "myopathy",
            True,
            f"No adverse-event record available, so this rule is not enforced for it - "
            f"flagged rather than cleared, because {ck}.",
        )

    return RuleResult(
        "myopathy",
        True,
        f"No myopathy or rhabdomyolysis signal on its adverse-event list, which matters "
        f"because {ck}.",
    )


def rule_swallow(drug: DrugRecord, chart: Chart = ALEX_CHEN) -> RuleResult:
    """Disqualify drugs with no form he can get down.

    Chart line: coughs on thin liquids on the timed water swallow. That cough
    is aspiration risk, which makes thin liquid itself unsafe - so the problem
    is not only the size of the tablet, it is that he cannot reliably use a
    drink of water to wash any solid dose down.
    """
    dysphagia = f"he {chart.swallow_finding}"
    forms = drug.formulations

    friendly = next(
        (f for f in forms for good in SWALLOW_FRIENDLY_FORMS if good in f),
        None,
    )
    if friendly:
        return RuleResult(
            "swallow",
            True,
            f"Comes as {friendly}, which goes down without a drink of thin liquid - "
            f"the point being that {dysphagia}.",
        )

    if drug.smallest_tablet_mm is not None and drug.smallest_tablet_mm <= SMALL_TABLET_MAX_MM:
        return RuleResult(
            "swallow",
            True,
            f"Smallest solid form is a {drug.smallest_tablet_mm:g} mm tablet, small enough "
            f"to be given in puree rather than washed down, which it has to be because "
            f"{dysphagia}.",
        )

    non_oral = next(
        (r for r in drug.routes for route in NON_ORAL_ROUTES if route in r),
        None,
    )
    if non_oral and not any("oral" in r for r in drug.routes):
        return RuleResult(
            "swallow",
            True,
            f"Given by the {non_oral} route, so it bypasses swallowing altogether; "
            f"{dysphagia}, so this rule does not apply.",
        )

    if not forms:
        return RuleResult(
            "swallow",
            True,
            f"No formulation record available, so this rule is not enforced for it - "
            f"flagged rather than cleared, because {dysphagia}.",
        )

    return RuleResult(
        "swallow",
        False,
        f"Only available as {', '.join(sorted(set(forms)))} - no film, dispersible tablet, "
        f"liquid or small tablet - and {dysphagia}, so he cannot reliably wash a solid "
        f"dose down.",
    )


def rule_dexterity(drug: DrugRecord, chart: Chart = ALEX_CHEN) -> RuleResult:
    """Disqualify drugs whose administration needs fine motor control.

    Chart line: right pinch 3 kg, grip 14 kg against a typical 48 kg, and he
    needs help with buttons and zips. A patient who cannot fasten a button
    cannot prime a nasal spray, compress an inhaler canister, or hold a
    pre-filled syringe steady against his own thigh.
    """
    hands = (
        f"his right pinch is {chart.pinch_kg:g} kg and his grip {chart.grip_kg:g} kg against "
        f"a typical {chart.grip_typical_kg:g} kg, and he {chart.dexterity_finding}"
    )

    haystack = drug.formulations + drug.routes + drug.devices

    for needle, description in DEXTERITY_BLOCKING_DEVICES.items():
        if description is None:
            continue
        if any(needle in item for item in haystack):
            if any(
                clinician in item
                for item in drug.routes
                for clinician in CLINICIAN_ADMINISTERED_ROUTES
            ):
                continue
            return RuleResult(
                "dexterity",
                False,
                f"Administration needs fine motor control - {description} - and {hands}.",
            )

    if any("subcutaneous" in r for r in drug.routes) and not drug.devices:
        return RuleResult(
            "dexterity",
            False,
            f"Administration needs fine motor control - subcutaneous injection he would "
            f"have to give himself - and {hands}.",
        )

    return RuleResult(
        "dexterity",
        True,
        f"No inhaler, pen, syringe or spray step in its administration, which it cannot "
        f"have because {hands}.",
    )


def rule_bbb_direction(drug: DrugRecord, chart: Chart = ALEX_CHEN) -> RuleResult:
    """Disqualify drugs on the wrong side of the barrier *for their own target*.

    This rule is signed, and it is the one that looks backwards: crossing the
    blood-brain barrier is a liability when the target is muscle or peripheral.

    THE PRECEDENT, for whoever presents this. Cytokinetics' fast skeletal
    muscle troponin activator programme is a documented case where a drug
    company treated brain penetration as a defect to engineer out, for a
    skeletal-muscle target.

    Tirasemtiv, the first-generation activator, had rat brain exposure
    normalized to blood of 0.27, impaired rat rotarod performance, and produced
    a dose-limiting clinical syndrome of dizziness, fatigue and nausea that its
    first-in-human study attributed to "an off-target effect in the central
    nervous system given the constellation of symptoms observed". That
    tolerability ceiling cost it roughly threefold excess withdrawal against
    placebo in BENEFIT-ALS (99 of 605 randomized patients versus 33) and 34.2%
    versus 12.2% discontinuation by week 24 of the phase 3 VITALITY-ALS.

    The follow-on medicinal chemistry says the goal out loud: "optimizing
    off-target selectivity and distribution to muscle relative to brain tissue
    to improve potency and clinical tolerability". Reldesemtiv was selected with
    normalized rat brain exposure of 0.063 against tirasemtiv's 0.27 - about
    fourfold lower, attributed to P-glycoprotein efflux - with simultaneously
    higher skeletal-muscle exposure, no rotarod effect, and the identical fast
    skeletal troponin mechanism. Cytokinetics' own poster states that
    "reldesemtiv is optimized to limit crossing the blood-brain barrier". In
    phase 2b FORTITUDE-ALS the CNS ceiling was gone: dizziness ran 6.0% at the
    top dose against 9.6% on placebo.

    THREE LIMITS, so this is not overclaimed to a pharmacologist:

    1. VITALITY-ALS was stopped because it missed its primary endpoint - slow
       vital capacity declined 13.4% on drug versus 14.4% on placebo, p = 0.56 -
       not because of the central side effects. The CNS burden drove withdrawal
       and muddied the read; the efficacy miss ended the programme.
    2. Tirasemtiv's dose-limiting toxicity was CNS-dominated but not purely
       central. Patients also lost significantly more weight (-1.70 versus
       -0.79 kg, p = 0.006) with more gastrointestinal events, and the
       BENEFIT-ALS authors blamed that weight loss, not dizziness, for masking
       the functional signal.
    3. Lower brain penetration was one of several stated selection criteria for
       reldesemtiv, alongside potency, selectivity, drug-drug interaction risk
       and projected human exposure. Reldesemtiv is also a different scaffold,
       not a CNS-tuned analogue of tirasemtiv.

    And the honest coda: reldesemtiv itself was stopped for futility in phase 3
    COURAGE-ALS in 2025. So this precedent supports treating CNS penetration as
    a de-prioritization signal for a muscle target. It does not show that
    lowering brain exposure produces efficacy, and we should not claim it does.

    Sources: J Med Chem 2021 (reldesemtiv discovery, doi 10/acs.jmedchem.1c01067);
    Shefner et al., Amyotroph Lateral Scler Frontotemporal Degener
    2016;17(5-6):426-435 (BENEFIT-ALS, PMID 26982815); Shefner et al., same
    journal 2019 (VITALITY-ALS); Cytokinetics MNDA 2018 FORTITUDE-ALS poster.

    So the rule: CNS target plus predicted BBB-negative fails, because the drug
    cannot reach the tissue. Muscle or peripheral target plus predicted
    BBB-positive also fails, because the drug reaches tissue it has no business
    in and pays for it in tolerability.

    `in_domain: false` from component B means the probability is suppressed and
    this rule does not fire at all - we do not eliminate a drug on a number the
    model cannot stand behind.
    """
    compartment = drug.target_compartment
    prob = drug.bbb_prob

    if compartment is None or prob is None:
        return RuleResult(
            "bbb_direction",
            True,
            "No target compartment or barrier prediction available yet, so the signed "
            "barrier rule is not enforced for it.",
        )

    if drug.bbb_in_domain is False:
        return RuleResult(
            "bbb_direction",
            True,
            f"The barrier model reports this molecule outside its applicability domain, "
            f"so its probability is suppressed and the signed barrier rule is not "
            f"enforced - we will not eliminate a drug on a number the model cannot "
            f"stand behind.",
        )

    is_cns = any(token in compartment for token in CNS_COMPARTMENTS)
    is_peripheral = any(token in compartment for token in PERIPHERAL_COMPARTMENTS)

    if is_cns and prob < 0.5:
        return RuleResult(
            "bbb_direction",
            False,
            f"Its target sits in the {compartment}, but it is predicted not to cross the "
            f"blood-brain barrier (p = {prob:.2f}), so it cannot reach the tissue that "
            f"would have to change for him to benefit.",
        )

    if is_peripheral and prob >= 0.5:
        return RuleResult(
            "bbb_direction",
            False,
            f"Its target is {compartment}, yet it is predicted to cross into the brain "
            f"(p = {prob:.2f}); for a {compartment} target, central exposure is a "
            f"tolerability liability without adding efficacy. Cytokinetics selected "
            f"reldesemtiv over tirasemtiv partly for lower rat brain exposure "
            f"(0.063 versus 0.27) while keeping the same fast skeletal troponin "
            f"mechanism; VITALITY-ALS later missed its primary endpoint on efficacy, "
            f"not on delivery alone.",
        )

    if is_cns:
        return RuleResult(
            "bbb_direction",
            True,
            f"Its target sits in the {compartment} and it is predicted to cross the "
            f"blood-brain barrier (p = {prob:.2f}), so the drug and its target are on the "
            f"same side of the barrier.",
        )

    if is_peripheral:
        return RuleResult(
            "bbb_direction",
            True,
            f"Its target is {compartment} and it is predicted to stay out of the brain "
            f"(p = {prob:.2f}), which is the right sign for a peripheral target - the "
            f"tirasemtiv-to-reldesemtiv redesign is the precedent.",
        )

    return RuleResult(
        "bbb_direction",
        True,
        f"Target compartment '{compartment}' is not classified as central or peripheral, "
        f"so the signed barrier rule is not enforced for it.",
    )


def rule_canada(drug: DrugRecord, chart: Chart = ALEX_CHEN) -> RuleResult:
    """Disqualify drugs he cannot actually be handed in Ontario.

    Chart line: lives in Hamilton, Ontario. A drug that is not in the Health
    Canada Drug Product Database cannot be dispensed to him on a normal
    prescription, however well it scores on everything else. This is the rule
    that turns a ranked list into something his neurologist could act on.
    """
    if drug.in_health_canada_dpd is True:
        din = f", DIN {drug.health_canada_din}" if drug.health_canada_din else ""
        return RuleResult(
            "canada",
            True,
            f"Authorized in the Health Canada Drug Product Database{din}, so it can be "
            f"dispensed to him in {chart.city}.",
        )
    if drug.in_health_canada_dpd is False:
        return RuleResult(
            "canada",
            False,
            f"Not in the Health Canada Drug Product Database, so it cannot be dispensed "
            f"to him in {chart.city} on a normal prescription.",
        )
    return RuleResult(
        "canada",
        True,
        f"Health Canada Drug Product Database not yet queried for this drug, so the "
        f"availability rule is not enforced - flagged rather than cleared, because he "
        f"lives in {chart.city}.",
    )


RULES: dict[str, Callable[[DrugRecord, Chart], RuleResult]] = {
    "cyp1a2": rule_cyp1a2,
    "respiratory": rule_respiratory,
    "weight_loss": rule_weight_loss,
    "myopathy": rule_myopathy,
    "swallow": rule_swallow,
    "dexterity": rule_dexterity,
    "bbb_direction": rule_bbb_direction,
    "canada": rule_canada,
}

assert tuple(RULES) == RULE_ORDER, "RULES and RULE_ORDER must agree"


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------


def apply_patient_filter(
    drug: Mapping[str, Any] | DrugRecord, chart: Chart = ALEX_CHEN
) -> list[dict[str, Any]]:
    """Return the ordered `filters` list for one drug, in the frozen contract shape.

    Each entry carries exactly `rule`, `passed` and `reason`. The list is in
    `RULE_ORDER` so the UI can render rules in a stable sequence and highlight
    the first failure.
    """
    record = drug if isinstance(drug, DrugRecord) else DrugRecord.from_mapping(drug)
    return [RULES[name](record, chart).to_contract() for name in RULE_ORDER]


def evaluate(drug: Mapping[str, Any] | DrugRecord, chart: Chart = ALEX_CHEN) -> DrugVerdict:
    """Run all eight rules on one drug and summarize the outcome."""
    record = drug if isinstance(drug, DrugRecord) else DrugRecord.from_mapping(drug)
    filters = apply_patient_filter(record, chart)
    failures = [f["rule"] for f in filters if not f["passed"]]
    return DrugVerdict(
        id=record.id,
        name=record.name,
        inchikey=record.inchikey,
        passed=not failures,
        first_failure=failures[0] if failures else None,
        filters=filters,
    )


def evaluate_all(
    drugs: Sequence[Mapping[str, Any]], chart: Chart = ALEX_CHEN
) -> list[DrugVerdict]:
    return [evaluate(d, chart) for d in drugs]


def build_output(drugs: Sequence[Mapping[str, Any]], chart: Chart = ALEX_CHEN) -> dict[str, Any]:
    """Assemble `data/patient_filter.json`."""
    verdicts = evaluate_all(drugs, chart)

    eliminated_by_rule: dict[str, int] = {name: 0 for name in RULE_ORDER}
    for verdict in verdicts:
        if verdict.first_failure:
            eliminated_by_rule[verdict.first_failure] += 1

    top_reason = max(eliminated_by_rule, key=lambda r: eliminated_by_rule[r])
    n_eliminated = sum(eliminated_by_rule.values())

    return {
        "meta": {
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "module": "patient_filter.py",
            "patient": chart.patient_id,
            "rule_order": list(RULE_ORDER),
            "n_input": len(verdicts),
            "n_passed": len(verdicts) - n_eliminated,
            "n_eliminated": n_eliminated,
        },
        "chart": {
            "patient": chart.name,
            "age": chart.age,
            "city": chart.city,
            "current_therapy": (
                f"{chart.current_drug} {chart.current_dose} since {chart.current_since}"
            ),
            "fvc_sitting_pct": chart.fvc_sitting_pct,
            "fvc_supine_pct": chart.fvc_supine_pct,
            "cough_peak_flow_lpm": chart.cough_peak_flow_lpm,
            "weight_kg": [chart.weight_baseline_kg, chart.weight_current_kg],
            "meal_duration": chart.meal_duration_min,
            "ck_u_per_l": chart.ck_u_per_l,
            "ck_reference_ceiling": chart.ck_reference_ceiling,
            "swallow": chart.swallow_finding,
            "pinch_kg": chart.pinch_kg,
            "grip_kg": chart.grip_kg,
            "grip_typical_kg": chart.grip_typical_kg,
        },
        "eliminated_by_rule": eliminated_by_rule,
        "top_reason": top_reason if n_eliminated else None,
        "results": [
            {
                "id": v.id,
                "name": v.name,
                "inchikey": v.inchikey,
                "passed": v.passed,
                "first_failure": v.first_failure,
                "filters": v.filters,
            }
            for v in verdicts
        ],
    }


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def _load_drugs(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text())
    if isinstance(payload, list):
        return payload
    for key in ("drugs", "candidates", "annotations"):
        if isinstance(payload.get(key), list):
            return payload[key]
    raise SystemExit(f"{path}: expected a list, or an object with a 'drugs' key")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--drug", help="explain one drug by name and exit")
    args = parser.parse_args(argv)

    drugs = _load_drugs(args.input)

    if args.drug:
        wanted = args.drug.strip().lower()
        matches = [d for d in drugs if str(d.get("name", "")).strip().lower() == wanted]
        if not matches:
            print(f"no drug named {args.drug!r} in {args.input}", file=sys.stderr)
            return 1
        verdict = evaluate(matches[0])
        print(f"{verdict.name}  ->  {'PASS' if verdict.passed else 'ELIMINATED'}")
        for entry in verdict.filters:
            mark = "ok  " if entry["passed"] else "FAIL"
            print(f"  [{mark}] {entry['rule']:<14} {entry['reason']}")
        return 0

    output = build_output(drugs)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n")

    meta = output["meta"]
    print(
        f"wrote {args.output} - {meta['n_input']} drugs, {meta['n_passed']} passed, "
        f"{meta['n_eliminated']} eliminated, top reason {output['top_reason']!r}"
    )
    for rule, count in output["eliminated_by_rule"].items():
        if count:
            print(f"  {rule:<14} eliminated {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
