"""Shapes passed between the orchestrator, the sub-agents and the frontend."""
from typing import Literal

from pydantic import BaseModel, Field


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
