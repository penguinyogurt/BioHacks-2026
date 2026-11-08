"""Drug assessment: the pipeline's drug list → a ranked, patient-specific report.

  load → (fan out: one researcher per drug, web search, no patient data) → assess → report

- researcher: Sonnet with Claude's web search. Sees ONE DRUG NAME, nothing about
  the patient, and returns a DrugDossier (mechanism, ALS trials, safety,
  interactions, formulations, availability, cost).
- assess: the orchestrator (Opus) with the patient record, the research run's
  target profiles and every dossier. It can search the web for follow-ups,
  but only through `web_research`, which strips patient identifiers from the
  question before it leaves the process. It ranks the drugs with pros, cons
  and patient-specific risks; cited URLs must have come from real search results.

Input: any of
  - Levi's query-generation report (`aggregation.final` or `fallback.final` + `ingredient_names`)
  - data/pipeline.json (`candidates` that survived)
  - {"drugs": [...]} or a plain list; items are names or {name, id?, notes?}

  python -m agent.assess --patient jordan --drugs path/to/drugs.json [--research <run_id>] [--max 12]
"""
import asyncio
import json
import operator
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, TypedDict

import httpx

from langchain.agents import create_agent
from langchain.agents.structured_output import ProviderStrategy
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from agent.config import CACHE_DIR, DEFAULT_PATIENT, LANGSMITH_PROJECT, MAX_CONCURRENCY, ORCHESTRATOR_MODEL, RUNS_DIR, SUBAGENT_MODEL, tracing_enabled
from agent.llm import claude, structured
from agent.privacy import identifier_terms, load_record, redact
from agent.report_pdf import render as render_pdf
from agent import pubmed
from agent.schemas import DrugDossier, DrugReport, FinalAssessment, Paper, Reference, ReportDrug, Source

MAX_DRUGS = int(os.getenv("AGENT_ASSESS_MAX_DRUGS", "12"))
SEARCHES_PER_DRUG = int(os.getenv("AGENT_ASSESS_SEARCHES_PER_DRUG", "4"))
ORCHESTRATOR_SEARCHES = int(os.getenv("AGENT_ASSESS_FOLLOWUPS", "6"))
PUBMED_SEARCHES = int(os.getenv("AGENT_ASSESS_PUBMED_SEARCHES", "12"))  # orchestrator pubmed_search calls
TIMEOUT_S = float(os.getenv("AGENT_ASSESS_TIMEOUT_S", "1500"))  # ~20 drugs at 8 in parallel


def web_search_tool(model: str) -> str:
    # Dynamic filtering (20260209) is Opus/Sonnet only; Haiku accepts that version
    # but runs no searches, so it gets the basic tool.
    return "web_search_20250305" if "haiku" in model else "web_search_20260209"


def _emit(event: dict) -> None:
    get_stream_writer()(event)


# ── input: whatever the drug pipeline wrote ─────────────────────────────────
def load_drugs(path: Path, limit: int = MAX_DRUGS) -> list[dict]:
    """Normalize a drug list file to [{name, id, notes}]. Notes can be
    patient-specific (Levi's leader review), so they go to the orchestrator only."""
    data = json.loads(path.read_text(encoding="utf-8"))
    drugs: list[dict] = []
    if isinstance(data, dict) and "discovery_leads" in data:  # coordinated backend/query-generation report
        drugs = _coordinated(data)
    elif isinstance(data, dict) and "ingredient_names" in data:  # earlier backend/query-generation report
        names = data["ingredient_names"]
        final = (data.get("aggregation") or {}).get("final") or (data.get("fallback") or {}).get("final") or []
        for x in final:
            review = x.get("review") or {}
            notes = {k: x[k] for k in ("score", "ranks", "coverage", "penalty") if k in x}
            if review:
                notes["review"] = {k: review.get(k) for k in ("action", "warning", "medication_check") if review.get(k)}
            drugs.append({"name": names.get(x["id"]) or review.get("name") or x["id"], "id": x["id"].split("::")[-1], "notes": json.dumps(notes)})
    elif isinstance(data, dict) and "candidates" in data:  # data/pipeline.json
        for c in data["candidates"]:
            if c.get("verdict") == "survived":
                drugs.append({"name": c["name"], "id": c.get("inchikey", ""), "notes": json.dumps({"kg": c.get("kg"), "bbb": c.get("bbb")})})
    else:
        items = data.get("drugs", data.get("candidates", [])) if isinstance(data, dict) else data
        for it in items:
            if isinstance(it, str):
                drugs.append({"name": it, "id": "", "notes": ""})
            elif isinstance(it, dict) and it.get("name"):
                drugs.append({"name": it["name"], "id": str(it.get("id", "")), "notes": json.dumps({k: v for k, v in it.items() if k not in ("name", "id")})})
    seen, out = set(), []
    for d in drugs:
        if d["name"].lower() not in seen:
            seen.add(d["name"].lower())
            out.append(d)
    return out[:limit]


def _coordinated(data: dict) -> list[dict]:
    """The coordinated DRKG pipeline holds back every lead whose patient safety it
    can't resolve. Resolving that is this step's job, so take, in order: what it
    advanced, tested ingredients with unresolved human evidence, then its leads."""
    names = data.get("ingredient_names", {})
    rows = [(x["id"], "advanced", x) for x in data.get("advanced", [])]
    rows += [(cid, "tested in ALS, evidence unresolved", r) for cid, r in (data.get("reassessments") or {}).items() 
             if r.get("category") == "unresolved" and not str(r.get("disposition", "")).startswith("established")]  # comparators aren't candidates
    rows += [(x["id"], "discovery lead", x) for x in data.get("discovery_leads", [])]
    missing = [cid for cid, _, _ in rows if names.get(cid, cid).startswith("Compound::")]
    resolved = drugbank_names([cid.split("::")[-1] for cid in missing])
    drugs = []
    for cid, origin, x in rows:
        db = cid.split("::")[-1]
        name = names.get(cid, cid)
        if name.startswith("Compound::"):
            name = resolved.get(db, db)
        keep = ("rank", "final_rank", "category", "internal_ranking_score", "study_status", "disposition")
        notes = {"pipeline": origin, **{k: x[k] for k in keep if k in x}}
        if x.get("decisive"):
            notes["human_evidence"] = [d.get("finding") for d in x["decisive"]][:3]
        drugs.append({"name": name, "id": db, "notes": json.dumps(notes)})
    return drugs


def drugbank_names(ids: list[str]) -> dict[str, str]:
    """DrugBank id → name via PubChem (DRKG's glossary has no name for many ids).
    Sends only the DrugBank ids. Cached in agent/cache/."""
    cache_file = CACHE_DIR / "drugbank_names.json"
    try:
        cache = json.loads(cache_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cache = {}
    todo = [i for i in ids if i not in cache and re.fullmatch(r"DB\d{5}", i)]
    if todo:
        with httpx.Client(timeout=15) as client:
            for db in todo:
                try:
                    r = client.get(f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/substance/sourceid/DrugBank/{db}/synonyms/JSON")
                    syn = r.json()["InformationList"]["Information"][0]["Synonym"] if r.status_code == 200 else []
                    name = next((s for s in syn if s != db), "")
                    if name:
                        cache[db] = name.capitalize() if name.isupper() or name.islower() else name
                except (httpx.HTTPError, KeyError, IndexError, ValueError):
                    pass
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(cache, indent=1), encoding="utf-8")
    return {i: cache[i] for i in ids if i in cache}


def load_research(run_id: str) -> dict | None:
    if not run_id or not re.fullmatch(r"[\w-]+", run_id):
        return None
    for p in (RUNS_DIR / f"{run_id}.report.json", RUNS_DIR / f"{run_id}.jsonl"):
        if p.exists():
            if p.suffix == ".json":
                return json.loads(p.read_text(encoding="utf-8"))
            for line in p.read_text(encoding="utf-8").splitlines():
                e = json.loads(line)
                if e.get("type") == "report":
                    return e["data"]
    return None


def latest_research(patient_id: str) -> str:
    """Most recent research run for this patient, or ''."""
    if not RUNS_DIR.exists():
        return ""
    files = [*RUNS_DIR.glob("*.jsonl"), *RUNS_DIR.glob("*.report.json")]  # API runs, CLI runs
    for p in sorted(files, key=lambda p: p.stat().st_mtime, reverse=True):
        rid = p.name.split(".")[0]
        rep = load_research(rid)
        if rep and rep.get("patient_id") == patient_id and rep.get("profiles"):
            return rid
    return ""


# ── web search (Claude's server tool) ───────────────────────────────────────
async def web_search(prompt: str, max_uses: int, run_name: str) -> tuple[str, list[dict], list[str]]:
    """One Sonnet turn with web search. Returns (answer text, sources, queries)."""
    model = claude(SUBAGENT_MODEL, "low").bind_tools([{"type": web_search_tool(SUBAGENT_MODEL), "name": "web_search", "max_uses": max_uses}])
    messages = [HumanMessage(prompt)]
    text, sources, queries = [], {}, []
    for _ in range(3):  # pause_turn: send the turn back and the server resumes
        msg: AIMessage = await model.ainvoke(messages, config={"run_name": run_name})
        for b in msg.content if isinstance(msg.content, list) else [{"type": "text", "text": msg.content}]:
            t = b.get("type")
            if t == "server_tool_use" and b.get("name") == "web_search":
                queries.append(str((b.get("input") or {}).get("query", "")))
            elif t == "web_search_tool_result" and isinstance(b.get("content"), list):
                for r in b["content"]:
                    if r.get("url"):
                        sources.setdefault(r["url"], r.get("title", ""))
            elif t == "text":
                text.append(b.get("text", ""))
                for c in b.get("citations") or []:
                    if c.get("url"):
                        sources.setdefault(c["url"], c.get("title", ""))
        if msg.response_metadata.get("stop_reason") != "pause_turn":
            break
        messages = [messages[0], msg]
    # with dynamic filtering the same query can appear once per caller; count it once
    return "".join(text).strip(), [{"url": u, "title": t} for u, t in sources.items()], list(dict.fromkeys(q for q in queries if q))


DOSSIER_PROMPT = """Research the drug "{name}"{id_note} for a clinical team assessing it for ALS (amyotrophic lateral sclerosis).
Use web search. Prefer PubMed (pubmed.ncbi.nlm.nih.gov) records for every scientific claim, then FDA/Health Canada labels,
DailyMed, DrugBank and ClinicalTrials.gov.
Find: mechanism of action and main molecular targets; approved indications; every human ALS trial you can find
(NCT id or name, phase, size, outcome) and notable preclinical ALS evidence; formulations (tablet, liquid, IV,
intrathecal...); CNS penetration in detail (brain/plasma or CSF/plasma ratio, P-glycoprotein/BCRP efflux, molecular
weight, polarity, any focused-ultrasound or BBB-opening delivery studies); common adverse effects; serious risks (respiratory depression, QT prolongation,
hepatotoxicity, boxed warnings); CYP metabolism and major interactions; contraindications; approval and availability
in Canada and the US; rough cost or coverage.
Write a dense factual brief. Say plainly when something wasn't found. Don't make recommendations."""


async def dossier(payload: dict) -> dict:
    drug, i = payload["drug"], payload["index"]
    _emit({"type": "drug_research_started", "criterion": drug["name"], "data": {"index": i}})
    t0 = time.monotonic()
    id_note = f" ({drug['id']})" if drug.get("id") else ""
    try:
        text, sources, queries = await web_search(DOSSIER_PROMPT.format(name=drug["name"], id_note=id_note), SEARCHES_PER_DRUG, f"drug researcher: {drug['name']}")
        for q in queries:
            _emit({"type": "web_search", "criterion": drug["name"], "data": {"query": q}})
        listing = "\n".join(f"- {s['url']} ({s['title']})" for s in sources) or "(none)"
        d: DrugDossier = await structured(SUBAGENT_MODEL, DrugDossier, "low").ainvoke(
            [SystemMessage("Turn the research notes into the schema. Use only facts in the notes. sources: only URLs from the list."),
             HumanMessage(f"Drug: {drug['name']}\n\nNotes:\n{text}\n\nSearch result URLs:\n{listing}")],
            config={"run_name": f"drug researcher: {drug['name']} (structure)"},
        )
        d.papers = await asyncio.to_thread(drug_papers, drug["name"], [s["url"] for s in sources])
        known = {s["url"] for s in sources}
        d.sources = [s for s in d.sources if s.url in known] or [Source(**s) for s in sources[:5]]
        d.name = drug["name"]
        _emit({"type": "drug_research_finished", "criterion": drug["name"], "data": {"index": i, "searches": len(queries), "sources": len(d.sources), "papers": len(d.papers), "seconds": round(time.monotonic() - t0, 1)}})
        return {"dossiers": [(i, d.model_dump())], "searches": len(queries)}
    except Exception as e:
        msg = f"{type(e).__name__}: {e}"[:300]
        _emit({"type": "drug_research_failed", "criterion": drug["name"], "data": {"index": i, "error": msg}})
        return {"dossiers": [(i, DrugDossier(name=drug["name"], mechanism="", als_evidence=f"Research failed: {msg}").model_dump())], "failures": [drug["name"]]}


def drug_papers(name: str, urls: list[str]) -> list[Paper]:
    """PubMed records for one drug: ALS, CNS-exposure and safety papers, and any PubMed
    pages the web search hit. Queries hold the drug name only."""
    found: dict[str, dict] = {}
    queries = [f"{name}[tiab] AND (amyotrophic lateral sclerosis[tiab] OR motor neuron disease[tiab])",
               f"{name}[tiab] AND (blood-brain barrier[tiab] OR cerebrospinal fluid[tiab] OR brain penetration[tiab] OR focused ultrasound[tiab])",
               f"{name}[tiab] AND (adverse effects[sh] OR toxicity[tiab] OR drug interactions[mh] OR safety[tiab])"]
    try:
        for q, n in zip(queries, (6, 3, 3)):
            for r in pubmed.search(q, n):
                found.setdefault(r["pmid"], r)
        for pmid, r in pubmed.summaries(pubmed.pmids_in_urls(urls)).items():
            found.setdefault(pmid, r)
    except httpx.HTTPError:
        pass  # citations are best-effort; the report says when a claim has none
    return [Paper(**r) for r in found.values()]


# Background the summary needs whatever the drug list is; seeded into the citable set.
BACKGROUND_QUERIES = [
    "focused ultrasound blood-brain barrier opening amyotrophic lateral sclerosis motor cortex first-in-human",
    "Pardridge blood-brain barrier bottleneck brain drug development",
    "focused ultrasound blood-brain barrier opening drug delivery clinical review",
]
STATIC_REFS = {"DRKG": {"citation": "Ioannidis VN, et al. DRKG - Drug Repurposing Knowledge Graph for COVID-19. 2020.", "url": "https://github.com/gnn4dr/DRKG"}}
_CITE = re.compile(r"\[((?:\s*(?:PMID|REF)\s*:?\s*[\w-]+\s*[,;]?)+)\]", re.I)


def resolve_citations(texts: list[str], papers: dict[str, dict]) -> tuple[list[str], list[Reference], int]:
    """[PMID:123][PMID:456] → [1, 2] in order of first use. PMIDs the agent never saw
    in a fact sheet or a pubmed_search result are dropped, not trusted."""
    refs: dict[str, Reference] = {}
    dropped = 0

    def num(key: str) -> int | None:
        if key not in refs:
            if key.startswith("REF:") and key[4:] in STATIC_REFS:
                info = STATIC_REFS[key[4:]]
                refs[key] = Reference(n=len(refs) + 1, **info)
            elif key in papers:
                refs[key] = Reference(n=len(refs) + 1, citation=papers[key]["citation"], url=papers[key]["url"], pmid=key)
            else:
                return None
        return refs[key].n

    def sub(m: re.Match) -> str:
        nonlocal dropped
        keys = []
        for kind, val in re.findall(r"(PMID|REF)\s*:?\s*([\w-]+)", m.group(1), re.I):
            keys.append(f"REF:{val.upper()}" if kind.upper() == "REF" else val)
        ns = []
        for k in keys:
            n = num(k)
            if n is None:
                dropped += 1
            elif n not in ns:
                ns.append(n)
        return f"[{', '.join(map(str, sorted(ns)))}]" if ns else ""

    def clean(t: str) -> str:
        t = _CITE.sub(lambda m: " " + sub(m), t)
        t = re.sub(r"\s+\[", " [", t)  # one space before a marker
        t = re.sub(r"\s+([.,;:])", r"\1", t)  # no space before punctuation left by a dropped marker
        t = re.sub(r"\]\s*\[", ", ", t)  # [1] [2] -> [1, 2]
        return re.sub(r"  +", " ", t).strip()

    out = [clean(t) if t else t for t in texts]
    return out, sorted(refs.values(), key=lambda r: r.n), dropped


WEIGHTS = {"mechanistic_fit": 2, "delivery_gain": 3, "safety": 1, "cost": 0.5, "availability": 0.5, "acceptance": 1}
NOVEL_BONUS = 5  # the point of MRgFUS is reaching drugs nobody could test in the CNS before


def score(c: dict, novelty: str = "") -> int:
    """0-100. Delivery gain outweighs everything: a cheap oral drug that already crosses
    the BBB shouldn't outrank one that only MRgFUS can get to the motor neurons."""
    base = sum(w * c[k] for k, w in WEIGHTS.items()) / (10 * sum(WEIGHTS.values())) * 100
    return min(100, round(base + (NOVEL_BONUS if novelty == "novel" else 0)))


def patient_context(record: dict, now: datetime) -> dict:
    """Header facts for the clinician-facing report (the report is the clinician's; the
    record never leaves this process except here)."""
    ident, dx, f = record.get("identifiers", {}), record.get("diagnosis", {}), record.get("function", {})
    def months(ym: str) -> str:
        try:
            y, m = map(int, ym[:7].split("-"))
            return str((now.year - y) * 12 + now.month - m)
        except ValueError:
            return "?"
    age = ""
    if ident.get("date_of_birth"):
        y, m, d = map(int, ident["date_of_birth"].split("-"))
        age = f"{now.year - y - ((now.month, now.day) < (m, d))} y, "
    alsfrs = (f.get("ALSFRS_R") or {}).get("total")
    lines = [
        f"{age}{dx.get('onset_site', '?')} onset, {months(dx.get('diagnosed', ''))} months since diagnosis "
        f"({months(dx.get('symptom_onset', ''))} since symptom onset); ALSFRS-R {alsfrs}/48, slope {f.get('ALSFRS_R_slope_per_month')} pts/month; "
        f"FVC {f.get('FVC_sitting_pct')}% sitting / {f.get('FVC_supine_pct')}% supine.",
        "Genetics: " + ", ".join(f"{k} {v}" for k, v in record.get("genetics", {}).items()) + ".",
        "Current medication: " + "; ".join(f"{m['name']} {m.get('dose', '')}".strip() for m in record.get("medications", [])) +
        ". Allergies: " + ("; ".join(record.get("allergies", [])) or "none recorded") + ".",
        "Labs: " + "; ".join(f"{l['test']} {l['value']} {l['unit']}" for l in record.get("labs", [])) + ".",
        "Symptoms: " + "; ".join(f"{s['name']} {s['severity']}/5" for s in record.get("symptoms", [])) +
        (f". Weight {f['weight_kg']['baseline']} -> {f['weight_kg']['current']} kg" if f.get("weight_kg") else "") +
        (f"; swallowing: {f['swallowing']}" if f.get("swallowing") else "") + ".",
        " · ".join(x for x in (", ".join(v for v in (ident.get("city"), ident.get("province")) if v), f"Goals: {record['goals']}" if record.get("goals") else "") if x),
    ]
    return {"name": ident.get("full_name", ""), "headline": f"{dx.get('onset_site', '').split(' (')[0].capitalize()} onset, ALSFRS-R {alsfrs}/48",
            "context": [l for l in lines if l.strip(". ")]}


# ── graph ───────────────────────────────────────────────────────────────────
class State(TypedDict, total=False):
    run_id: str
    patient_id: str
    drugs_path: str
    drugs: list[dict]
    research_run_id: str
    record: dict
    research: dict
    dossiers: Annotated[list[tuple[int, dict]], operator.add]
    searches: Annotated[int, operator.add]
    failures: Annotated[list[str], operator.add]
    report: dict


async def load(state: State) -> State:
    pid = state.get("patient_id") or DEFAULT_PATIENT
    record = load_record(pid)
    drugs = state.get("drugs") or load_drugs(Path(state["drugs_path"]))
    if not drugs:
        raise ValueError("no drugs found in the input")
    rid = state.get("research_run_id") or latest_research(pid)
    research = load_research(rid) or {}
    _emit({"type": "assess_loaded", "data": {"patient_id": pid, "drugs": [d["name"] for d in drugs], "research_run_id": rid if research else "", "profiles": len(research.get("profiles", []))}})
    return {"record": record, "drugs": drugs, "research_run_id": rid if research else "", "research": research}


def fan_out(state: State) -> list[Send]:
    # Each researcher gets one drug name and nothing else.
    return [Send("dossier", {"drug": {"name": d["name"], "id": d.get("id", "")}, "index": i}) for i, d in enumerate(state["drugs"])]


ASSESS = """You are the lead clinician-scientist on an ALS drug-repurposing team. You can see the patient's record.
A discovery pipeline proposed the drugs below; researchers wrote a fact sheet for each from web search and PubMed
(they never saw the patient). An earlier research step described target profiles: what an ideal drug should do.

THE DELIVERY STRATEGY DRIVES THE RANKING. This team pairs the drug with MRI-guided focused ultrasound (MRgFUS), which
opens the blood-brain barrier transiently at a chosen site (motor cortex, brainstem, spinal cord). Rank by what the
combination unlocks, not by what the drug does alone:
- Prioritise drugs with a CNS-relevant mechanism for this patient's ALS that are POORLY BBB-penetrant on their own
  (efflux substrates, large or polar molecules, peptides, biologics): that's where MRgFUS adds value (high delivery_gain).
- Give extra weight to NOVEL leads with a plausible mechanism. novel means NO human ALS trial of this exact drug, in
  any phase or status; a registered or completed trial with unreported results is tested_in_als, and trials of a related
  drug (gabapentin for GABA) don't count against it. a drug that already failed in
  ALS at full CNS exposure is a weak bet, one that never reached the motor neurons is an open question.
- A drug that crosses the BBB well gains little (low delivery_gain). Purely peripheral symptomatic drugs can stay but
  say they're adjuncts outside the delivery strategy.
- Safety still vetoes: opening the BBB raises CNS exposure, so weigh CNS toxicity, seizure risk, narrow therapeutic windows.
- Mark not_recommended any drug that doesn't fit this patient (wrong genotype, already prescribed, failed in ALS with
  adequate exposure, unsafe here); its headline is the one-line exclusion reason.

CITATIONS ARE REQUIRED. Every factual claim in summary, headline, rationale, evidence, safety and limitations ends with
[PMID:12345678] markers. Use only PMIDs that appear in the fact sheets' "papers", the background papers, or your
pubmed_search results; anything else is deleted from the report. Before answering, use pubmed_search (NCBI PubMed)
for the top candidates' claims the fact sheets' papers don't back: the ALS trial behind an evidence line, a serious
risk or interaction in a safety line, a CNS-exposure or BBB measurement. An evidence or safety line for a ranked
candidate should not go uncited when PubMed has a paper for it; the fact sheets' papers include safety and
CNS-exposure records for exactly this, so cite them in rationale and safety lines too.
At most {p} pubmed_search calls and {n} web_research calls; query drugs and conditions only, never the patient.
In summary, cite the MRgFUS-in-ALS and BBB background papers and refer to the knowledge graph as [REF:DRKG].

Per drug: criteria (0-10 each; the report score is computed from them: delivery gain x3, mechanistic fit x2, safety x1,
acceptance x1, cost and availability x0.5, novel leads +5; make your summary's top picks agree with that),
drug_class, molecular_size, bbb_penetration, fus_delivery, novelty, matched_profiles (profile labels), headline, rationale,
and one line each for evidence, safety (include interactions with current meds, pharmacogenomics, labs, and function:
swallowing -> formulation, breathing -> sedation), cost, availability (Canada first), acceptance (route/schedule vs the
patient's goals and preferences). Rank every drug. Treat pipeline notes as hints, not verdicts. Refer to the patient by
name or as they/them unless the record states their pronouns. This is a research aid for a clinician, not medical advice."""

CRITERIA_TEXT = ("MRgFUS delivery gain (x3), Mechanistic fit (x2), Safety & interactions, Patient acceptance, "
                 "Cost (x0.5), Availability & regulation (x0.5); novel leads +5")


async def assess(state: State) -> State:
    record, drugs = state["record"], state["drugs"]
    dossiers = [d for _, d in sorted(state.get("dossiers", []), key=lambda x: x[0])]
    terms = identifier_terms(record)
    seen_urls = {s["url"] for d in dossiers for s in d.get("sources", [])}
    papers: dict[str, dict] = {p["pmid"]: p for d in dossiers for p in d.get("papers", [])}  # the citable set
    budget = {"left": ORCHESTRATOR_SEARCHES, "pubmed_left": PUBMED_SEARCHES, "searches": 0, "pubmed": 0, "redactions": 0}

    background: list[dict] = []
    for q in BACKGROUND_QUERIES:
        try:
            background += await asyncio.to_thread(pubmed.search, q, 3)
        except httpx.HTTPError:
            pass
    background = list({p["pmid"]: p for p in background}.values())
    papers.update({p["pmid"]: p for p in background})

    @tool
    async def web_research(question: str) -> str:
        """Search the web to answer one specific question about a drug, an interaction, or ALS evidence.
        Returns a short answer with source URLs."""
        if budget["left"] <= 0:
            return "Web search budget used up. Answer from what you have."
        budget["left"] -= 1
        safe, n = redact(question, terms)
        budget["redactions"] += n
        _emit({"type": "web_research", "data": {"question": safe, "redactions": n}})
        text, sources, queries = await web_search(f"Answer concisely with facts and sources, preferring PubMed records: {safe}", 3, "orchestrator: web_research")
        budget["searches"] += len(queries)
        seen_urls.update(s["url"] for s in sources)
        found = await asyncio.to_thread(pubmed.summaries, pubmed.pmids_in_urls([s["url"] for s in sources]))
        papers.update(found)
        cites = "\n".join(f"PMID:{p['pmid']} {p['citation']}" for p in found.values())
        return text + "\n\nSources:\n" + "\n".join(s["url"] for s in sources[:8]) + (f"\n\nCitable PubMed records:\n{cites}" if cites else "")

    @tool
    async def pubmed_search(query: str) -> str:
        """Search NCBI PubMed. Returns up to 6 papers as 'PMID:<id> <citation>'; cite them as [PMID:<id>].
        Use PubMed syntax, e.g. 'tocilizumab AND amyotrophic lateral sclerosis'."""
        if budget["pubmed_left"] <= 0:
            return "PubMed budget used up. Cite what you already have."
        budget["pubmed_left"] -= 1
        safe, n = redact(query, terms)
        budget["redactions"] += n
        _emit({"type": "pubmed_search", "data": {"query": safe, "redactions": n}})
        try:
            found = await asyncio.to_thread(pubmed.search, safe, 6)
        except httpx.HTTPError as e:
            return f"PubMed error: {e}"
        budget["pubmed"] += 1
        papers.update({p["pmid"]: p for p in found})
        return "\n".join(f"PMID:{p['pmid']} {p['citation']}" for p in found) or "No PubMed results; try broader terms."

    research = state.get("research") or {}
    profiles = [{"criterion": p["criterion"], "label": p["criterion_label"], "goal": p["therapeutic_goal"],
                 "targets": [f"{t['symbol']}:{t['desired_action']}" for t in p["molecular_targets"]],
                 "constraints": p.get("constraints_text", "")} for p in research.get("profiles", [])]
    listing = [{"index": i, "pipeline_notes": drugs[i].get("notes", ""),
                "fact_sheet": {**{k: v for k, v in d.items() if k != "papers"},
                               "papers": [f"PMID:{p['pmid']} {p['citation']}" for p in d.get("papers", [])]}}
               for i, d in enumerate(dossiers)]
    bg = "\n".join(f"PMID:{p['pmid']} {p['citation']}" for p in background) or "(none found)"
    agent = create_agent(claude(ORCHESTRATOR_MODEL), [web_research, pubmed_search],
                         system_prompt=ASSESS.format(n=ORCHESTRATOR_SEARCHES, p=PUBMED_SEARCHES),
                         response_format=ProviderStrategy(FinalAssessment), name="orchestrator_assess")
    out = await agent.ainvoke(
        {"messages": [HumanMessage(f"Patient record:\n{json.dumps(record, indent=1)}\n\nTarget profiles:\n{json.dumps(profiles, indent=1)}\n\n"
                                   f"Background papers:\n{bg}\n\nDrugs:\n{json.dumps(listing, indent=1)}")]},
        config={"run_name": "orchestrator: assess", "recursion_limit": 4 * (ORCHESTRATOR_SEARCHES + PUBMED_SEARCHES) + 10},
    )
    final: FinalAssessment = out["structured_response"]

    # One revision pass: candidate lines that state facts with no citation go back once.
    uncited = [f"index {r.index} {f}: {getattr(r, f)}" for r in final.ranked if r.verdict != "not_recommended"
               for f in ("rationale", "evidence", "safety") if getattr(r, f) and "[PMID" not in getattr(r, f).upper()]
    if uncited:
        _emit({"type": "citation_revision", "data": {"uncited_lines": len(uncited)}})
        out = await agent.ainvoke(
            {"messages": out["messages"] + [HumanMessage(
                "These lines have no [PMID:n] citation:\n" + "\n".join(uncited) +
                "\n\nReturn the full assessment again with the same ranking and scores. For each line, cite PMIDs from the "
                "fact sheets' papers (they include safety and CNS-exposure records) or your pubmed_search results; "
                "if no paper supports a claim, cut the claim or say it is unreferenced.")]},
            config={"run_name": "orchestrator: citation revision", "recursion_limit": 4 * PUBMED_SEARCHES + 10},
        )
        final = out["structured_response"]

    order = list({r.index: r for r in final.ranked if 0 <= r.index < len(dossiers)}.values())
    # Candidates by computed score, then exclusions; the printed score always matches the order.
    order.sort(key=lambda r: (r.verdict == "not_recommended", -score(r.criteria.model_dump(), r.novelty)))
    dropped_urls = 0
    ranked = []
    for rank, r in enumerate(order, 1):
        urls = [u for u in r.source_urls if u in seen_urls]
        dropped_urls += len(r.source_urls) - len(urls)
        ranked.append(ReportDrug(**{**r.model_dump(), "source_urls": urls}, rank=rank, score=score(r.criteria.model_dump(), r.novelty),
                                 name=drugs[r.index]["name"], drug_id=drugs[r.index].get("id", ""),
                                 pipeline_notes=drugs[r.index].get("notes", ""), dossier=DrugDossier(**dossiers[r.index])))

    labels = list(dict.fromkeys(p["criterion_label"] for p in research.get("profiles", [])))
    from_graph = any('"pipeline"' in d.get("notes", "") for d in drugs)
    method = ((f"Profiles: {' · '.join(labels)}. " if labels else "") +
              (f"Candidates came from the discovery pipeline's matches in the DRKG knowledge graph [REF:DRKG]; " if from_graph else "Candidates came from the supplied drug list; ") +
              "each was researched on the web and in PubMed by a separate agent that never saw the patient, then scored for this patient. "
              f"Ranking criteria: {CRITERIA_TEXT}.")

    # One pass over every text field so reference numbers follow reading order.
    fields = ("headline", "rationale", "evidence", "safety", "cost", "availability", "acceptance")
    texts = [final.summary, method] + [getattr(d, f) for d in ranked for f in fields] + [final.limitations]
    texts, references, dropped_cites = resolve_citations(texts, papers)
    summary, method, limitations = texts[0], texts[1], texts[-1]
    for i, d in enumerate(ranked):
        for j, f in enumerate(fields):
            setattr(d, f, texts[2 + i * len(fields) + j])

    missing = [drugs[i]["name"] for i in range(len(dossiers)) if i not in {r.index for r in order}]
    warnings = ["Research aid for a clinician, not medical advice."]
    if missing:
        warnings.append(f"Not ranked by the orchestrator: {', '.join(missing)}")
    if state.get("failures"):
        warnings.append(f"Web research failed for: {', '.join(state['failures'])}")
    if dropped_urls:
        warnings.append(f"{dropped_urls} cited URL(s) dropped: not in any search result")
    if dropped_cites:
        warnings.append(f"{dropped_cites} citation(s) dropped: PMID not seen in any PubMed result")
    now = datetime.now(timezone.utc)
    report = DrugReport(
        run_id=state["run_id"], created_at=now.isoformat(),
        patient_id=state.get("patient_id") or DEFAULT_PATIENT, patient=patient_context(record, now), method=method,
        drugs_source=state.get("drugs_path", "inline"), research_run_id=state.get("research_run_id", ""),
        models={"orchestrator": ORCHESTRATOR_MODEL, "researcher": SUBAGENT_MODEL},
        langsmith_project=LANGSMITH_PROJECT if tracing_enabled() else None,
        summary=summary, drugs=ranked, limitations=limitations, references=references,
        web={"researcher_searches": state.get("searches", 0), "followup_questions": ORCHESTRATOR_SEARCHES - budget["left"],
             "followup_searches": budget["searches"], "pubmed_searches": budget["pubmed"], "papers_seen": len(papers),
             "references": len(references), "dropped_citations": dropped_cites, "query_redactions": budget["redactions"],
             "dropped_urls": dropped_urls},
        warnings=warnings,
    ).model_dump()
    _emit({"type": "report", "data": report})
    return {"report": report}


def build_graph():
    g = StateGraph(State)
    g.add_node("load", load)
    g.add_node("dossier", dossier)
    g.add_node("assess", assess)
    g.add_edge(START, "load")
    g.add_conditional_edges("load", fan_out, ["dossier"])
    g.add_edge("dossier", "assess")
    g.add_edge("assess", END)
    return g.compile()


graph = build_graph()


# ── CLI ─────────────────────────────────────────────────────────────────────
VERDICT = {"strong_candidate": "Strong candidate", "worth_discussing": "Worth discussing", "use_with_caution": "Use with caution", "not_recommended": "Not recommended"}


async def main(argv: list[str]) -> None:
    import argparse

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--patient", default=DEFAULT_PATIENT)
    ap.add_argument("--drugs", required=True, type=Path)
    ap.add_argument("--max", type=int, default=MAX_DRUGS, help="most drugs to assess, in the pipeline's order")
    ap.add_argument("--research", default="", help="research run id whose target profiles to compare against (default: latest for the patient)")
    a = ap.parse_args(argv)
    run_id = time.strftime("a%Y%m%d-%H%M%S")
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    drugs = load_drugs(a.drugs, a.max)
    async for e in graph.astream({"run_id": run_id, "patient_id": a.patient, "drugs_path": str(a.drugs), "drugs": drugs, "research_run_id": a.research},
                                 config={"max_concurrency": MAX_CONCURRENCY, "run_name": "drug assessment (cli)"}, stream_mode="custom"):
        if e["type"] == "report":
            (RUNS_DIR / f"{run_id}.drugs.json").write_text(json.dumps(e["data"], indent=2), encoding="utf-8")
            pdf = RUNS_DIR / f"{run_id}.drugs.pdf"
            pdf.write_bytes(render_pdf(e["data"]))
            print(f"\n=== report -> {pdf}")
            for d in e["data"]["drugs"]:
                print(f"  {d['rank']}. {d['name']:<22} {VERDICT[d['verdict']]:<18} {d['score']}/100  BBB {d['bbb_penetration']}")
        else:
            print(f"[{e['type']}] {e.get('criterion', '')} {json.dumps(e.get('data'))[:160]}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
