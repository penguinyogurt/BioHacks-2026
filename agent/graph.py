"""The orchestrator: a LangGraph StateGraph.

  load_patient → plan → (fan out: one sub-agent per brief, in parallel) → verify → synthesize

Only load_patient, plan and synthesize ever see the patient record. Briefs are
sanitized in plan before they're sent to sub-agents.
Progress goes out as custom stream events (`stream_mode="custom"`), which
the API forwards to the frontend over SSE.
"""
import asyncio
import json
import operator
import re
from datetime import datetime, timezone
from typing import Annotated, TypedDict

import httpx
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from agent.config import DEFAULT_PATIENT, LANGSMITH_PROJECT, MAX_SUBAGENTS, ORCHESTRATOR_MODEL, PIPELINE_PATH, SUBAGENT_MODEL, tracing_enabled
from agent.llm import gemini
from agent.criteria import CRITERIA, catalog_text, label
from agent.privacy import load_record, sanitize_brief, sensitive_terms
from agent.schemas import Brief, Plan, PipelineXref, PlanItem, ReportFinding, ResearchReport, SubagentResult, Synthesis
from agent.subagent import run_subagent

DEFAULT_QUESTION = "Which approved drugs could help this patient, across survival, symptom relief and delivery?"


class State(TypedDict, total=False):
    run_id: str
    question: str
    patient_id: str
    record: dict
    plan_rationale: str
    briefs: list[Brief]
    redactions: int
    results: Annotated[list[tuple[str, SubagentResult]], operator.add]
    verified: list[tuple[str, dict]]
    report: dict


def _llm():
    return gemini(ORCHESTRATOR_MODEL)


def _emit(event: dict) -> None:
    get_stream_writer()(event)


# ── nodes ───────────────────────────────────────────────────────────────────
async def load_patient(state: State) -> State:
    record = load_record(state.get("patient_id") or DEFAULT_PATIENT)
    _emit({"type": "patient_loaded", "data": {"patient_id": state.get("patient_id") or DEFAULT_PATIENT, "synthetic": record.get("synthetic", False)}})
    return {"record": record}


PLANNER = """You are the lead researcher on an ALS drug-repurposing team. You have the patient's full record.
Choose the research criteria (from the catalog, by id) that matter most for THIS patient and the question,
and write one research brief per criterion for a sub-agent. Pick between 3 and {max_n}. Always consider A1.

PRIVACY — sub-agents must never learn who the patient is or see raw clinical data:
- Never include names, initials, dates, ages, locations, contact details, record/trial ids, lab values,
  scores, doses, or the names of the patient's current medications.
- Translate patient facts into pharmacological constraints instead. Examples:
  "on a CYP1A2-cleared drug" → avoid: "CYP1A2 inhibitors or inducers"
  "reduced, declining vital capacity" → avoid: "respiratory depressants"
  "coughs on thin liquids" → constraint: "available as liquid, dispersible or film formulation"
  "weak pinch grip" → constraint: "no device that needs grip or self-injection"

Criteria catalog:
{catalog}"""


async def plan(state: State) -> State:
    record = state["record"]
    planner = _llm().with_structured_output(Plan)
    result: Plan = await planner.ainvoke(
        [
            SystemMessage(PLANNER.format(max_n=MAX_SUBAGENTS, catalog=catalog_text())),
            HumanMessage(f"Question: {state['question']}\n\nPatient record (JSON):\n{json.dumps(record, indent=1)}"),
        ],
        config={"run_name": "orchestrator: plan"},
    )
    terms = sensitive_terms(record)
    briefs, redactions, seen = [], 0, set()
    for b in result.briefs:
        if b.criterion not in CRITERIA or b.criterion in seen:
            continue
        seen.add(b.criterion)
        safe, n = sanitize_brief(b, terms)
        redactions += n
        briefs.append(safe)
    briefs = briefs[:MAX_SUBAGENTS]
    _emit({"type": "plan", "data": {
        "briefs": [{"criterion": b.criterion, "label": label(b.criterion), "objective": b.objective} for b in briefs],
        "redactions": redactions,
    }})
    return {"plan_rationale": result.rationale, "briefs": briefs, "redactions": redactions}


def fan_out(state: State) -> list[Send] | list[str]:
    # Send payload carries ONLY the sanitized brief, not the record.
    return [Send("research", {"brief": b}) for b in state["briefs"]] or ["verify"]


async def research(payload: dict) -> State:
    brief: Brief = payload["brief"]
    result = await run_subagent(brief, _emit)
    return {"results": [(brief.criterion, result)]}


async def _existing_pmids(client: httpx.AsyncClient, pmids: set[str]) -> set[str]:
    if not pmids:
        return set()
    r = await client.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", params={"db": "pubmed", "id": ",".join(pmids), "retmode": "json"})
    res = r.json().get("result", {})
    return {p for p in pmids if p in res and "error" not in res[p]}


async def _existing_ncts(client: httpx.AsyncClient, ncts: set[str]) -> set[str]:
    async def ok(n):
        r = await client.get(f"https://clinicaltrials.gov/api/v2/studies/{n}", params={"fields": "NCTId"})
        return n if r.status_code == 200 else None

    return {n for n in await asyncio.gather(*(ok(n) for n in ncts)) if n}


_ID_SHAPE = {
    "pubmed": re.compile(r"^\d{4,9}$"),
    "clinicaltrials": re.compile(r"^NCT\d{8}$"),
    "chembl": re.compile(r"^CHEMBL\d+$"),
    "pipeline": re.compile(r"^[A-Z]{14}-[A-Z]{10}-[A-Z]$"),
}


def _normalize_id(source: str, raw: str) -> str:
    """'PMID: 15505150' -> '15505150', 'nct02623699' -> 'NCT02623699', urls -> their trailing id."""
    s = raw.strip().rstrip("/").split("/")[-1]
    if source == "pubmed":
        return re.sub(r"\D", "", s)
    if source in ("clinicaltrials", "chembl"):
        return s.upper()
    return s


async def verify(state: State) -> State:
    """Drop evidence whose id doesn't exist; drop findings left with no evidence."""
    pairs = [(cid, f) for cid, res in state.get("results", []) for f in res.findings]
    for _, f in pairs:
        for e in f.evidence:
            e.id = _normalize_id(e.source, e.id)
    pmids = {e.id for _, f in pairs for e in f.evidence if e.source == "pubmed"}
    ncts = {e.id for _, f in pairs for e in f.evidence if e.source == "clinicaltrials"}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            good_pmids, good_ncts = await asyncio.gather(_existing_pmids(client, pmids), _existing_ncts(client, ncts))
    except httpx.HTTPError:
        good_pmids, good_ncts = pmids, ncts  # offline: fall back to the shape check only

    verified, dropped_evidence, dropped_findings = [], 0, 0
    for cid, f in pairs:
        keep = []
        for e in f.evidence:
            shape = _ID_SHAPE.get(e.source)
            if shape and not shape.match(e.id.strip()):
                continue
            if e.source == "pubmed" and e.id not in good_pmids:
                continue
            if e.source == "clinicaltrials" and e.id not in good_ncts:
                continue
            keep.append(e)
        dropped_evidence += len(f.evidence) - len(keep)
        if not keep:
            dropped_findings += 1
            continue
        verified.append((cid, f.model_copy(update={"evidence": keep}).model_dump()))
    _emit({"type": "verify", "data": {"kept": len(verified), "dropped_findings": dropped_findings, "dropped_evidence": dropped_evidence}})
    return {"verified": verified}


def _pipeline_xref(drug: str) -> PipelineXref:
    """Deterministic patient-safety gate: stage-4 results from pipeline.json, verbatim."""
    try:
        cands = json.loads(PIPELINE_PATH.read_text(encoding="utf-8"))["candidates"]
    except (OSError, KeyError, json.JSONDecodeError):
        return PipelineXref(in_pipeline=False)
    for c in cands:
        if c["name"].lower() == drug.lower():
            return PipelineXref(in_pipeline=True, verdict=c["verdict"], eliminated_at=c["eliminated_at"], filters=c["filters"])
    return PipelineXref(in_pipeline=False)


SYNTH = """You are the lead researcher. Sub-agents researched the criteria below without access to the patient.
Using the full patient record, rank the verified findings for THIS patient (best first), say why each fits or doesn't,
and list patient-specific cautions (interactions with current medications, respiratory risk, formulation, etc.).
Rank every finding exactly once, by its index. Then write a 3-5 sentence summary for a clinician.
If the patient already takes a drug, say so in patient_fit and rank it below new options.
Refer to the patient by name or as they/them unless the record states their pronouns.
This is a research aid, not medical advice; don't phrase anything as a prescription."""


async def synthesize(state: State) -> State:
    verified = state.get("verified", [])
    briefs = state["briefs"]
    synth = Synthesis(summary="No verified findings.", ranked=[])
    if verified:
        listing = [{"index": i, "criterion": cid, **f} for i, (cid, f) in enumerate(verified)]
        synth = await _llm().with_structured_output(Synthesis).ainvoke(
            [
                SystemMessage(SYNTH),
                HumanMessage(f"Question: {state['question']}\n\nPatient record:\n{json.dumps(state['record'], indent=1)}\n\nVerified findings:\n{json.dumps(listing, indent=1)}"),
            ],
            config={"run_name": "orchestrator: synthesize"},
        )

    order = [r.index for r in synth.ranked if 0 <= r.index < len(verified)]
    order = list(dict.fromkeys(order)) + [i for i in range(len(verified)) if i not in order]
    notes = {r.index: r for r in synth.ranked}

    findings = []
    for i in order:
        cid, f = verified[i]
        xref = _pipeline_xref(f["drug"])
        # The LLM can't override a stage-4 elimination.
        safety = "unchecked" if not xref.in_pipeline else ("fail" if xref.eliminated_at == "patient_filter" else "pass")
        note = notes.get(i)
        findings.append(ReportFinding(
            **f, criterion=cid, criterion_label=label(cid), rank=0,
            patient_fit=note.patient_fit if note else "", cautions=note.cautions if note else [],
            safety=safety, pipeline=xref,
        ))
    # failures sink to the bottom; otherwise keep the orchestrator's order
    findings.sort(key=lambda x: x.safety == "fail")
    for rank, f in enumerate(findings, 1):
        f.rank = rank

    dead_ends = [f"{cid} {label(cid)}: {d}" for cid, res in state.get("results", []) for d in res.dead_ends]
    report = ResearchReport(
        run_id=state["run_id"],
        created_at=datetime.now(timezone.utc).isoformat(),
        question=state["question"],
        partial=len(state.get("results", [])) < len(briefs),
        models={"orchestrator": ORCHESTRATOR_MODEL, "subagent": SUBAGENT_MODEL},
        langsmith_project=LANGSMITH_PROJECT if tracing_enabled() else None,
        plan=[PlanItem(criterion=b.criterion, label=label(b.criterion), objective=b.objective) for b in briefs],
        summary=synth.summary,
        findings=findings,
        dead_ends=dead_ends,
        privacy={"redactions": state.get("redactions", 0)},
        warnings=["Research aid, not medical advice.", "Findings marked 'unchecked' weren't run through the patient-safety rules."],
    ).model_dump()
    _emit({"type": "report", "data": report})
    return {"report": report}


def build_graph():
    g = StateGraph(State)
    g.add_node("load_patient", load_patient)
    g.add_node("plan", plan)
    g.add_node("research", research)
    g.add_node("verify", verify)
    g.add_node("synthesize", synthesize)
    g.add_edge(START, "load_patient")
    g.add_edge("load_patient", "plan")
    g.add_conditional_edges("plan", fan_out, ["research", "verify"])
    g.add_edge("research", "verify")
    g.add_edge("verify", "synthesize")
    g.add_edge("synthesize", END)
    return g.compile()


graph = build_graph()
