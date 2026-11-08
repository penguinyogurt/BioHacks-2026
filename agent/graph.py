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

from agent.config import DEFAULT_PATIENT, LANGSMITH_PROJECT, MAX_SUBAGENTS, ORCHESTRATOR_MODEL, SUBAGENT_MODEL, tracing_enabled
from agent.llm import structured
from agent.criteria import CRITERIA, catalog_text, label
from agent.privacy import load_record, sanitize_brief, sensitive_terms
from agent.no_drugs import scrub_model
from agent.schemas import Brief, Plan, PlanItem, ReportProfile, ResearchReport, SubagentResult, Synthesis
from agent.subagent import run_subagent

DEFAULT_QUESTION = "What should a drug do for this patient, both to slow their ALS and to relieve their symptoms?"


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
    drug_mentions: int
    report: dict


def _structured(schema):
    return structured(ORCHESTRATOR_MODEL, schema)


def _emit(event: dict) -> None:
    get_stream_writer()(event)


# ── nodes ───────────────────────────────────────────────────────────────────
async def load_patient(state: State) -> State:
    record = load_record(state.get("patient_id") or DEFAULT_PATIENT)
    _emit({"type": "patient_loaded", "data": {"patient_id": state.get("patient_id") or DEFAULT_PATIENT, "synthetic": record.get("synthetic", False)}})
    return {"record": record}


PLANNER = """You are the lead researcher on an ALS drug-repurposing team. You have the patient's full record.
Choose the research criteria (from the catalog, by id) that matter most for THIS patient and the question,
and write one research brief per criterion for a sub-agent. Pick between 3 and {max_n}:
- M* (disease mechanisms): the ones most relevant to this patient's genetics, onset and progression.
- S* (symptoms): only symptoms this patient actually has, most burdensome first.
Sub-agents don't pick drugs. They describe what an ideal drug would do for the criterion, and a separate
system matches real drugs. So the objective says which aspect of the criterion matters for this patient,
and constraints/avoid carry the patient's pharmacological limits. Never name drugs in a brief.

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
    planner = _structured(Plan)
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
    "opentargets": re.compile(r"^(ENSG\d{11}|MONDO_\d+|EFO_\d+)$"),
}


def _normalize_id(source: str, raw: str) -> str:
    """'PMID: 15505150' -> '15505150', 'nct02623699' -> 'NCT02623699', urls -> their trailing id."""
    s = raw.strip().rstrip("/").split("/")[-1]
    if source == "pubmed":
        return re.sub(r"\D", "", s)
    if source == "clinicaltrials":
        return s.upper()
    return s


async def verify(state: State) -> State:
    """Drop evidence whose id doesn't exist, drop profiles left with no evidence,
    and remove any drug names that slipped into a profile."""
    pairs = [(cid, p) for cid, res in state.get("results", []) for p in res.profiles]
    for _, p in pairs:
        for e in p.evidence:
            e.id = _normalize_id(e.source, e.id)
    pmids = {e.id for _, p in pairs for e in p.evidence if e.source == "pubmed"}
    ncts = {e.id for _, p in pairs for e in p.evidence if e.source == "clinicaltrials"}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            good_pmids, good_ncts = await asyncio.gather(_existing_pmids(client, pmids), _existing_ncts(client, ncts))
    except httpx.HTTPError:
        good_pmids, good_ncts = pmids, ncts  # offline: fall back to the shape check only

    verified, dropped_evidence, dropped_profiles, drug_mentions = [], 0, 0, 0
    for cid, p in pairs:
        keep = [
            e for e in p.evidence
            if (_ID_SHAPE[e.source].match(e.id) if e.source in _ID_SHAPE else True)
            and (e.source != "pubmed" or e.id in good_pmids)
            and (e.source != "clinicaltrials" or e.id in good_ncts)
        ]
        dropped_evidence += len(p.evidence) - len(keep)
        if not keep:
            dropped_profiles += 1
            continue
        clean, n = scrub_model(p.model_copy(update={"evidence": keep}))
        drug_mentions += n
        verified.append((cid, clean.model_dump()))
    _emit({"type": "verify", "data": {"kept": len(verified), "dropped_profiles": dropped_profiles, "dropped_evidence": dropped_evidence, "drug_mentions_removed": drug_mentions}})
    return {"verified": verified, "drug_mentions": drug_mentions}


def _embedding_text(label_: str, p: dict) -> str:
    """Mechanism only, in a fixed field order, so profiles embed comparably."""
    targets = "; ".join(f"{t['symbol']} ({t['desired_action'].replace('_', ' ')})" for t in p["molecular_targets"])
    parts = [
        f"ALS criterion: {label_}.",
        f"Therapeutic goal: {p['therapeutic_goal']}",
        f"Mechanism of action: {p['mechanism_of_action']}",
        f"Molecular targets: {targets}." if targets else "",
        f"Pathways: {', '.join(p['pathways'])}." if p["pathways"] else "",
        f"Site of action: {', '.join(p['site_of_action'])}." if p["site_of_action"] else "",
    ]
    return " ".join(x for x in parts if x)


def _constraints_text(required: list[str], avoid: list[str]) -> str:
    parts = [f"Must: {'; '.join(required)}." if required else "", f"Must avoid: {'; '.join(avoid)}." if avoid else ""]
    return " ".join(x for x in parts if x)


SYNTH = """You are the lead researcher. Sub-agents described ideal drug profiles for ALS criteria, without access to the patient.
A separate system will match real drugs to these profiles, so do NOT name any drugs anywhere.
Using the full patient record:
- Rank every profile exactly once, by its index, most important for THIS patient first.
- For each, give priority_rationale (why it matters for this patient) and any patient-specific properties a matching
  drug must have or avoid that the profile doesn't already list. Phrase interactions with the patient's current medicines
  pharmacologically (e.g. "avoid CYP1A2 inhibitors"), not by drug name.
- Then write a 3-5 sentence summary for a clinician of the therapeutic strategy, again without drug names.
Refer to the patient by name or as they/them unless the record states their pronouns.
This is a research aid, not medical advice."""


async def synthesize(state: State) -> State:
    verified = state.get("verified", [])
    briefs = {b.criterion: b for b in state["briefs"]}
    synth = Synthesis(summary="No verified profiles.", ranked=[])
    if verified:
        listing = [{"index": i, "criterion": f"{cid} {label(cid)}", **p} for i, (cid, p) in enumerate(verified)]
        synth = await _structured(Synthesis).ainvoke(
            [
                SystemMessage(SYNTH),
                HumanMessage(f"Question: {state['question']}\n\nPatient record:\n{json.dumps(state['record'], indent=1)}\n\nVerified profiles:\n{json.dumps(listing, indent=1)}"),
            ],
            config={"run_name": "orchestrator: synthesize"},
        )
    synth, n_synth = scrub_model(synth)

    order = [r.index for r in synth.ranked if 0 <= r.index < len(verified)]
    order = list(dict.fromkeys(order)) + [i for i in range(len(verified)) if i not in order]
    notes = {r.index: r for r in synth.ranked}

    profiles = []
    for rank, i in enumerate(order, 1):
        cid, p = verified[i]
        note = notes.get(i)
        brief = briefs.get(cid)
        required = list(dict.fromkeys(p["required_properties"] + (brief.constraints if brief else []) + (note.patient_required if note else [])))
        avoid = list(dict.fromkeys(p["avoid_properties"] + (brief.avoid if brief else []) + (note.patient_avoid if note else [])))
        profiles.append(ReportProfile(
            **p, criterion=cid, criterion_label=label(cid), rank=rank,
            priority_rationale=note.priority_rationale if note else "",
            patient_required=note.patient_required if note else [],
            patient_avoid=note.patient_avoid if note else [],
            embedding_text=_embedding_text(label(cid), p),
            constraints_text=_constraints_text(required, avoid),
        ))

    dead_ends = [f"{cid} {label(cid)}: {d}" for cid, res in state.get("results", []) for d in res.dead_ends]
    report = ResearchReport(
        run_id=state["run_id"],
        created_at=datetime.now(timezone.utc).isoformat(),
        question=state["question"],
        patient_id=state.get("patient_id") or DEFAULT_PATIENT,
        partial=len(state.get("results", [])) < len(briefs),
        models={"orchestrator": ORCHESTRATOR_MODEL, "subagent": SUBAGENT_MODEL},
        langsmith_project=LANGSMITH_PROJECT if tracing_enabled() else None,
        plan=[PlanItem(criterion=b.criterion, label=label(b.criterion), objective=b.objective) for b in state["briefs"]],
        summary=synth.summary,
        profiles=profiles,
        dead_ends=dead_ends,
        privacy={"redactions": state.get("redactions", 0), "drug_mentions_removed": state.get("drug_mentions", 0) + n_synth},
        warnings=["Research aid, not medical advice.", "Profiles describe what a drug should do; drug matching and patient-safety filtering happen downstream."],
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
