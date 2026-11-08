"""Shapes passed between the orchestrator, the sub-agents and the frontend."""
from typing import Literal

from pydantic import BaseModel, Field


# ── patient record (parsed from a chart PDF; orchestrator-only) ─────────────
# Structured output can't express free-form dicts, so every section is an
# explicit list. Values stay strings: charts mix "470", "< 195", "76%".
# Missing values are "" (not None): optional unions blow up the output grammar.
class Identifiers(BaseModel):
    full_name: str = Field(description="Patient's full name exactly as written")
    date_of_birth: str = ""
    mrn: str = Field("", description="Medical record number / chart id")
    health_card: str = Field("", description="Health card / insurance / social id number")
    address: str = ""
    city: str = ""
    province_or_state: str = ""
    phone: str = ""
    email: str = ""
    clinicians: list[str] = Field(default_factory=list, description="Names of every clinician, author or cc'd person in the document")
    other: list[str] = Field(default_factory=list, description="Any other identifying string: next of kin, employer, clinic name, accession numbers")


class Medication(BaseModel):
    name: str = Field(description="Generic name, lowercase")
    dose: str = ""
    since: str = ""


class Lab(BaseModel):
    test: str
    value: str
    unit: str = ""
    ref: str = ""
    date: str = ""


class Measurement(BaseModel):
    name: str = Field(description="e.g. 'ALSFRS-R total', 'FVC sitting %', 'weight kg', 'grip right kg', 'swallowing'")
    value: str
    date: str = ""


class Symptom(BaseModel):
    name: str
    severity: int = Field(-1, description="0-5 if stated or clearly implied, otherwise -1")
    note: str = ""


class TrialHistory(BaseModel):
    nct_id: str = ""
    name: str = ""
    role: str = Field(description="enrolled, screened, completed, withdrawn, interested")
    outcome: str = ""


class PatientRecord(BaseModel):
    identifiers: Identifiers
    diagnosis: str = Field(description="Diagnosis with onset site and dates as written")
    genetics: list[Measurement] = Field(default_factory=list, description="Gene tests and pharmacogenomic phenotypes")
    medications: list[Medication] = Field(default_factory=list)
    allergies: list[str] = Field(default_factory=list)
    labs: list[Lab] = Field(default_factory=list)
    function: list[Measurement] = Field(default_factory=list, description="ALSFRS-R and subscores, FVC, weight, grip, swallowing, etc.")
    symptoms: list[Symptom] = Field(default_factory=list)
    trials: list[TrialHistory] = Field(default_factory=list)
    goals: str = ""


# ── orchestrator → sub-agent ────────────────────────────────────────────────
# Deliberately has no "patient context" field. Everything a sub-agent learns
# about the patient is a pharmacological constraint, and privacy.sanitize_brief
# still scrubs every string before it leaves the orchestrator.
class Brief(BaseModel):
    criterion: str = Field(description="Criterion id from the catalog, e.g. 'B2'")
    objective: str = Field(description="What to find, phrased without any patient facts")
    constraints: list[str] = Field(default_factory=list, description="Properties a drug must have, e.g. 'available as liquid or dispersible form'")
    avoid: list[str] = Field(default_factory=list, description="Pharmacological properties to avoid, e.g. 'respiratory depressants', 'CYP1A2 inhibitors or inducers'")


class Plan(BaseModel):
    rationale: str = Field(description="Why these criteria, for this patient (stays with the orchestrator)")
    briefs: list[Brief]



# ── sub-agent → orchestrator ────────────────────────────────────────────────
# A sub-agent describes what an ideal drug would DO for one criterion. It never
# names drugs. A separate step embeds these profiles and matches real drugs.
class Evidence(BaseModel):
    source: Literal["pubmed", "clinicaltrials", "opentargets"]
    id: str = Field(description="PMID, NCT id, or Open Targets Ensembl/MONDO id, exactly as a tool returned it")
    url: str
    claim: str = Field(description="One sentence this source supports, without naming any drug")


class MolecularTarget(BaseModel):
    symbol: str = Field(description="HGNC gene symbol where one exists (e.g. SOD1, GRIN2B, CHRM3), otherwise the named molecular entity")
    desired_action: Literal["inhibit", "activate", "antagonize", "agonize", "block", "open", "reduce_expression", "increase_expression", "stabilize", "degrade", "modulate"]
    rationale: str = Field(description="Why acting on this target helps in ALS, in one or two sentences")


class TargetProfile(BaseModel):
    therapeutic_goal: str = Field(description="What the drug should achieve for this criterion, in one sentence")
    mechanism_of_action: str = Field(description="The pharmacological mechanism the drug should have, in 2-4 sentences, without drug names")
    molecular_targets: list[MolecularTarget]
    pathways: list[str] = Field(default_factory=list, description="Biological pathways involved, e.g. 'glutamatergic synaptic transmission'")
    site_of_action: list[str] = Field(description="Tissues/cells the drug must reach, e.g. 'spinal cord lower motor neurons', 'submandibular salivary glands'")
    required_properties: list[str] = Field(default_factory=list, description="Properties the drug must have, e.g. 'CNS-penetrant', 'oral liquid formulation'")
    avoid_properties: list[str] = Field(default_factory=list, description="Properties to avoid, e.g. 'respiratory depression', 'strong anticholinergic burden'")
    lessons_from_failures: list[str] = Field(default_factory=list, description="What failed ALS trials of this mechanism teach, in mechanism terms, no drug names")
    target_validation: Literal["human_genetic", "clinical", "preclinical", "mechanistic"]
    confidence: float = Field(ge=0, le=1, description="Self-estimated confidence that this profile would help, 0-1")
    evidence: list[Evidence]


class SubagentResult(BaseModel):
    profiles: list[TargetProfile] = Field(description="1-3 alternative mechanistic strategies for the criterion")
    dead_ends: list[str] = Field(default_factory=list, description="What was searched for and not found")


# ── orchestrator synthesis ──────────────────────────────────────────────────
class RankedItem(BaseModel):
    index: int = Field(description="Index into the verified profiles list")
    priority_rationale: str = Field(description="Why this profile matters for this patient, without drug names")
    patient_required: list[str] = Field(default_factory=list, description="Extra patient-specific properties a matching drug must have")
    patient_avoid: list[str] = Field(default_factory=list, description="Extra patient-specific properties a matching drug must not have, phrased pharmacologically")


class Synthesis(BaseModel):
    summary: str
    ranked: list[RankedItem]


# ── what the frontend / drug matcher receives ───────────────────────────────
class ReportProfile(TargetProfile):
    criterion: str
    criterion_label: str
    rank: int
    priority_rationale: str = ""
    patient_required: list[str] = Field(default_factory=list)
    patient_avoid: list[str] = Field(default_factory=list)
    embedding_text: str = Field(description="Drug-name-free description of the mechanism to embed for drug matching")
    constraints_text: str = Field(description="Required/avoid properties as one string, for filtering or a second embedding")


class PlanItem(BaseModel):
    criterion: str
    label: str
    objective: str


class ResearchReport(BaseModel):
    run_id: str
    created_at: str
    question: str
    patient_id: str
    partial: bool
    models: dict[str, str]
    langsmith_project: str | None
    plan: list[PlanItem]
    summary: str
    profiles: list[ReportProfile]
    dead_ends: list[str]
    privacy: dict[str, int]
    warnings: list[str]
