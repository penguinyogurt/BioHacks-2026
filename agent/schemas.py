"""Shapes passed between the orchestrator, the sub-agents and the frontend."""
from typing import Literal

from pydantic import BaseModel, Field


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
