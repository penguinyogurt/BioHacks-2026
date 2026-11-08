"""Chat with the final review/ranking agent about one finished drug assessment.

Stateless: the frontend sends the conversation so far; we answer the last user turn.
The agent sees the patient record and the report (it is the same orchestrator role
that ranked the drugs), and can run PubMed and web searches. Searches go out with
patient identifiers stripped, as in assess.py. Answers cite [PMID:n]; only PMIDs that
appeared in this report or in a search this turn survive, numbered per answer.
"""
import asyncio
import json
import os
from typing import Callable

import httpx
from langchain.agents import create_agent
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from langchain_core.tools import tool

from agent import pubmed
from agent.assess import resolve_citations, web_search
from agent.config import ORCHESTRATOR_MODEL
from agent.llm import claude
from agent.privacy import identifier_terms, load_record, redact

PUBMED_PER_TURN = int(os.getenv("AGENT_CHAT_PUBMED_SEARCHES", "4"))
WEB_PER_TURN = int(os.getenv("AGENT_CHAT_WEB_SEARCHES", "2"))
MAX_TURNS = 20  # history sent back by the frontend is trimmed to this

SYSTEM = """You are the lead clinician-scientist who wrote the drug assessment below for this patient's care team.
The user is on that team and is asking about the report: why a drug ranked where it did, risks, interactions,
evidence, alternatives, what a focused-ultrasound (MRgFUS) BBB-opening study would look like.

- Ground answers in the report and the patient record. Say when something isn't in them.
- Use pubmed_search (NCBI PubMed) for evidence questions the report doesn't settle, and web_research for labels,
  availability or cost. At most {p} PubMed and {w} web searches per answer. Query drugs and conditions only.
- Cite claims with [PMID:12345678], using only PMIDs from the report's references, the fact sheets' papers, or your
  searches this turn. Anything else is removed. Never write bracketed placeholders like [report dossier]; for a
  claim from the report with no PMID, write "per the report".
- The ranking prioritises poorly BBB-penetrant drugs with a CNS mechanism, because MRgFUS is what gets them in.
  Explain scores with the criteria weights in the report's method.
- Be concise: a few short paragraphs or bullets. Refer to the patient by name or as they/them unless the record
  states their pronouns. This is a research aid for a clinician, not medical advice; don't give dosing orders.

Patient record:
{record}

Report:
{report}"""


def _report_for_prompt(report: dict) -> dict:
    """The report minus bulk the model doesn't need (raw search URLs)."""
    slim = {k: v for k, v in report.items() if k not in ("warnings", "langsmith_project")}
    slim["drugs"] = []
    for d in report.get("drugs", []):
        dz = {k: v for k, v in d.get("dossier", {}).items() if k != "sources"}
        dz["papers"] = [f"PMID:{p['pmid']} {p.get('citation', '')}" for p in dz.get("papers", [])]
        slim["drugs"].append({**{k: v for k, v in d.items() if k not in ("dossier", "source_urls")}, "dossier": dz})
    slim["references"] = [f"[{r['n']}] {'PMID:' + r['pmid'] + ' ' if r.get('pmid') else ''}{r['citation']}" for r in report.get("references", [])]
    return slim


PREVIEW_CHARS = 2000  # of each tool result, as shown in the chat's trace


def _blocks(msg: AIMessage) -> list[dict]:
    return [b for b in msg.content if isinstance(b, dict)] if isinstance(msg.content, list) else [{"type": "text", "text": msg.content}]


async def answer(report: dict, messages: list[dict], emit: Callable[[dict], None] | None = None) -> dict:
    """Answer the last user turn. `emit` (optional) receives the agent's steps as they happen:
    thinking {text} · tool_call {tool, query, redactions} · tool_result {tool, content}. Queries are
    shown after redaction, i.e. exactly what left this process."""
    say = emit or (lambda e: None)
    record = load_record(report["patient_id"])
    terms = identifier_terms(record)
    papers: dict[str, dict] = {r["pmid"]: {"citation": r["citation"], "url": r["url"]} for r in report.get("references", []) if r.get("pmid")}
    for d in report.get("drugs", []):
        papers.update({p["pmid"]: p for p in d.get("dossier", {}).get("papers", [])})
    budget = {"pubmed": PUBMED_PER_TURN, "web": WEB_PER_TURN, "redactions": 0}
    searches: list[dict] = []

    @tool
    async def pubmed_search(query: str) -> str:
        """Search NCBI PubMed. Returns up to 6 papers as 'PMID:<id> <citation>'; cite them as [PMID:<id>]."""
        if budget["pubmed"] <= 0:
            return "PubMed budget for this answer used up."
        budget["pubmed"] -= 1
        safe, n = redact(query, terms)
        budget["redactions"] += n
        searches.append({"tool": "pubmed", "query": safe})
        say({"type": "tool_call", "data": {"tool": "pubmed_search", "query": safe, "redactions": n}})
        try:
            found = await asyncio.to_thread(pubmed.search, safe, 6)
        except httpx.HTTPError as e:
            say({"type": "tool_result", "data": {"tool": "pubmed_search", "content": f"PubMed error: {e}"}})
            return f"PubMed error: {e}"
        papers.update({p["pmid"]: p for p in found})
        out = "\n".join(f"PMID:{p['pmid']} {p['citation']}" for p in found) or "No PubMed results; try broader terms."
        say({"type": "tool_result", "data": {"tool": "pubmed_search", "content": out[:PREVIEW_CHARS]}})
        return out

    @tool
    async def web_research(question: str) -> str:
        """Search the web for one specific question (label, availability, cost, recent news). Returns facts with URLs."""
        if budget["web"] <= 0:
            return "Web search budget for this answer used up."
        budget["web"] -= 1
        safe, n = redact(question, terms)
        budget["redactions"] += n
        searches.append({"tool": "web", "query": safe})
        say({"type": "tool_call", "data": {"tool": "web_research", "query": safe, "redactions": n}})
        text, sources, _ = await web_search(f"Answer concisely with facts and sources: {safe}", 3, "chat: web_research")
        found = await asyncio.to_thread(pubmed.summaries, pubmed.pmids_in_urls([s["url"] for s in sources]))
        papers.update(found)
        cites = "\n".join(f"PMID:{p['pmid']} {p['citation']}" for p in found.values())
        out = text + "\n\nSources:\n" + "\n".join(s["url"] for s in sources[:6]) + (f"\n\nCitable PubMed records:\n{cites}" if cites else "")
        say({"type": "tool_result", "data": {"tool": "web_research", "content": out[:PREVIEW_CHARS]}})
        return out

    agent = create_agent(claude(ORCHESTRATOR_MODEL, show_thinking=emit is not None), [pubmed_search, web_research], name="assessment_chat",
                         system_prompt=SYSTEM.format(p=PUBMED_PER_TURN, w=WEB_PER_TURN, record=json.dumps(record, indent=1),
                                                     report=json.dumps(_report_for_prompt(report), indent=1)))
    history = [HumanMessage(m["content"]) if m["role"] == "user" else AIMessage(m["content"]) for m in messages[-MAX_TURNS:]]
    last: AIMessage | None = None
    # "messages" streams the orchestrator's answer token by token (`delta`); "updates" gives each
    # finished model turn, whose thinking and tool calls become steps.
    async for mode, data in agent.astream({"messages": history}, stream_mode=["updates", "messages"],
                                          config={"run_name": f"assessment chat {report['run_id']}", "recursion_limit": 2 * (PUBMED_PER_TURN + WEB_PER_TURN) + 6}):
        if mode == "messages":
            chunk, meta = data
            # Only the orchestrator's own turns: web_research runs another model inside the tools node.
            if meta.get("langgraph_node") == "model" and isinstance(chunk, AIMessageChunk):
                for b in _blocks(chunk):
                    if b.get("type") == "text" and b.get("text"):
                        say({"type": "delta", "data": {"text": b["text"]}})
            continue
        for node_out in data.values():
            for msg in node_out.get("messages", []) if isinstance(node_out, dict) else []:
                if not isinstance(msg, AIMessage):
                    continue
                last = msg
                for b in _blocks(msg):
                    if b.get("type") == "thinking" and b.get("thinking", "").strip():
                        say({"type": "thinking", "data": {"text": b["thinking"].strip()}})
                    elif b.get("type") == "text" and msg.tool_calls and b.get("text", "").strip():
                        # text alongside a tool call is the agent narrating its next step, not the answer
                        say({"type": "thinking", "data": {"text": b["text"].strip()}})
                if msg.tool_calls:
                    say({"type": "draft_reset", "data": {}})  # whatever streamed this turn wasn't the answer
    text = "".join(b.get("text", "") for b in _blocks(last) if b.get("type") == "text") if last else ""
    (text,), refs, dropped = resolve_citations([text], papers)
    return {"answer": text, "references": [r.model_dump() for r in refs], "searches": searches,
            "dropped_citations": dropped, "query_redactions": budget["redactions"]}
