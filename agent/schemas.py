"""Shapes passed between the orchestrator, the sub-agents and the frontend."""
from typing import Literal

from pydantic import BaseModel, Field


# ── patient record (parsed from a chart PDF; orchestrator-only) ─────────────
# Gemini structured output can't express free-form dicts, so every section is
# an explicit list. Values stay strings: charts mix "470", "< 195", "76%".
class Identifiers(BaseModel):
    full_name: str = Field(description="Patient's full name exactly as written")
    date_of_birth: str | None = None
    mrn: str | None = Field(None, description="Medical record number / chart id")
    health_card: str | None = Field(None, description="Health card / insurance / social id number")
    address: str | None = None
    city: str | None = None
    province_or_state: str | None = None
    phone: str | None = None
    email: str | None = None
    clinicians: list[str] = Field(default_factory=list, description="Names of every clinician, author or cc'd person in the document")
    other: list[str] = Field(default_factory=list, description="Any other identifying string: next of kin, employer, clinic name, accession numbers")


class Medication(BaseModel):
    name: str = Field(description="Generic name, lowercase")
    dose: str | None = None
    since: str | None = None


class Lab(BaseModel):
    test: str
    value: str
    unit: str | None = None
    ref: str | None = None
    date: str | None = None


class Measurement(BaseModel):
    name: str = Field(description="e.g. 'ALSFRS-R total', 'FVC sitting %', 'weight kg', 'grip right kg', 'swallowing'")
    value: str
    date: str | None = None


class Symptom(BaseModel):
    name: str
    severity: int | None = Field(None, ge=0, le=5, description="0-5 if stated or clearly implied")
    note: str | None = None


class TrialHistory(BaseModel):
    nct_id: str | None = None
    name: str | None = None
    role: str = Field(description="enrolled, screened, completed, withdrawn, interested")
    outcome: str | None = None


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
    goals: str | None = None


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
class Evidence(BaseModel):
    source: Literal["pubmed", "clinicaltrials", "chembl", "opentargets", "fda_label", "pubchem", "pipeline"]
    id: str = Field(description="PMID, NCT id, CHEMBL id, Open Targets id, FDA label set_id, PubChem CID or pipeline InChIKey, exactly as a tool returned it")
    url: str
    claim: str = Field(description="One sentence this source supports")


class DrugFinding(BaseModel):
    drug: str
    mechanism: str
    rationale: str
    evidence: list[Evidence]
    evidence_level: Literal["approved_for_als", "rct", "observational", "preclinical", "kg_only"]
    confidence: float = Field(ge=0, le=1, description="Self-estimated, 0-1")
    failed_in_als_trials: bool = False


class SubagentResult(BaseModel):
    findings: list[DrugFinding]
    dead_ends: list[str] = Field(default_factory=list, description="What was searched for and not found")


# ── orchestrator synthesis ──────────────────────────────────────────────────
class RankedItem(BaseModel):
    index: int = Field(description="Index into the verified findings list")
    patient_fit: str = Field(description="Why this does or doesn't fit this patient")
    cautions: list[str] = Field(default_factory=list)


class Synthesis(BaseModel):
    summary: str
    ranked: list[RankedItem]


# ── what the frontend receives ──────────────────────────────────────────────
class PipelineXref(BaseModel):
    in_pipeline: bool
    verdict: str | None = None
    eliminated_at: str | None = None
    filters: list[dict] = Field(default_factory=list, description="Verbatim from pipeline.json; render reasons as-is")


class ReportFinding(DrugFinding):
    criterion: str
    criterion_label: str
    rank: int
    patient_fit: str = ""
    cautions: list[str] = Field(default_factory=list)
    safety: Literal["pass", "fail", "unchecked"]
    pipeline: PipelineXref


class PlanItem(BaseModel):
    criterion: str
    label: str
    objective: str


class ResearchReport(BaseModel):
    run_id: str
    created_at: str
    question: str
    partial: bool
    models: dict[str, str]
    langsmith_project: str | None
    plan: list[PlanItem]
    summary: str
    findings: list[ReportFinding]
    dead_ends: list[str]
    privacy: dict[str, int]
    warnings: list[str]
