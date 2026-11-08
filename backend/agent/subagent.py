"""One sub-agent = one criterion. It sees a sanitized Brief and the
als-research MCP tools, never the patient record."""
import asyncio
import sys
from typing import Callable

from langchain.agents import create_agent
from langchain.agents.structured_output import ProviderStrategy
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.errors import GraphRecursionError
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools

from agent.config import MAX_TOOL_CALLS, ROOT, SUBAGENT_MODEL, SUBAGENT_TIMEOUT_S
from agent.llm import claude, structured
from agent.criteria import CRITERIA
from agent.schemas import Brief, SubagentResult

MCP_SERVERS = {
    "research": {
        "transport": "stdio",
        "command": sys.executable,
        "args": ["-m", "agent.mcp_server"],
        "cwd": str(ROOT),
    }
}

# Target-level tools only. Drug lookups would pull the answer toward named
# drugs, and drug matching is a separate downstream step.
SUBAGENT_TOOLS = {"search_pubmed", "fetch_pubmed_abstract", "search_als_trials", "get_trial", "opentargets_als_targets", "target_profile"}

SYSTEM = """You are an ALS biology research sub-agent on a drug-repurposing team.
Your job is to define the IDEAL DRUG PROFILE for one criterion: what a drug would have to DO.
You do NOT pick drugs. A separate system embeds your profile and matches real drugs to it,
so be precise about targets, mechanism, tissues and properties.
A lead researcher sent you the brief below. You don't know who the patient is; don't ask and don't speculate.

Criterion {cid}: {label} ({focus})
Objective: {objective}
A matching drug must: {constraints}
A matching drug must avoid: {avoid}

How to work:
- Research the ALS biology for this criterion: which genes/proteins/pathways drive it in ALS, in which cells
  and tissues, and what modulating them should achieve. Tools: opentargets_als_targets, target_profile,
  search_pubmed, fetch_pubmed_abstract. Use search_als_trials / get_trial to learn which mechanisms were
  already tested in ALS and what their failures teach.
- Return 1-3 profiles, each a distinct mechanistic strategy, ordered best first. Every profile must describe
  a DRUG action (small molecule, biologic, antisense oligonucleotide, toxin, etc.), not a procedure, device,
  radiation or nutrition. Mention non-drug options only in dead_ends.
- NEVER write a drug name, brand name or development code. Describe the action instead, e.g.
  "an antisense oligonucleotide that lowers SOD1 mRNA in spinal motor neurons", "a peripherally restricted
  muscarinic M3 antagonist acting on salivary glands". Drug classes are fine when they describe mechanism.
- molecular_targets: HGNC gene symbols where possible, with the desired action.
- Carry the brief's must/avoid items into required_properties / avoid_properties, and add any the biology needs
  (e.g. "CNS-penetrant" for a cortical target, "peripherally restricted" when CNS exposure would harm).
- Every profile needs at least one evidence item whose id and url came from a tool result:
  PMID, NCT id, or Open Targets Ensembl id. Never invent ids or urls.
- For EACH molecular target, cite at least one PubMed paper (search_pubmed, then fetch_pubmed_abstract) whose
  abstract names that gene together with the action you propose (e.g. "knockdown of TARDBP", "SLC1A2 upregulation").
  An Open Targets association shows a gene is relevant to ALS, not which direction to push it, so it can't be the
  only evidence for a target. Use a specific desired_action when the paper states one; "modulate" only when it doesn't.
- Stop after at most {max_calls} tool calls, then answer and list your dead ends."""





async def _run(brief: Brief, emit: Callable[[dict], None]) -> SubagentResult:
    label, focus = CRITERIA[brief.criterion]
    prompt = SYSTEM.format(
        cid=brief.criterion,
        label=label,
        focus=focus,
        objective=brief.objective,
        constraints="; ".join(brief.constraints) or "no extra constraints",
        avoid="; ".join(brief.avoid) or "nothing specific",
        max_calls=MAX_TOOL_CALLS,
    )
    client = MultiServerMCPClient(MCP_SERVERS)
    async with client.session("research") as session:
        tools = [t for t in await load_mcp_tools(session) if t.name in SUBAGENT_TOOLS]
        agent = create_agent(claude(SUBAGENT_MODEL), tools, system_prompt=prompt, response_format=ProviderStrategy(SubagentResult), name=f"subagent_{brief.criterion}")
        result: SubagentResult | None = None
        notes: list[str] = []  # tool results so far, for the out-of-budget fallback
        config = {
            "recursion_limit": 2 * MAX_TOOL_CALLS + 6,
            "run_name": f"subagent {brief.criterion}: {label}",
            "tags": ["subagent", brief.criterion],
            "metadata": {"criterion": brief.criterion},
        }
        try:
            async for update in agent.astream({"messages": [{"role": "user", "content": "Begin the research."}]}, config=config, stream_mode="updates"):
                result = _handle(update, brief, emit, notes) or result
        except GraphRecursionError:
            # Out of steps before answering: answer from what it already found.
            emit({"type": "budget_exhausted", "criterion": brief.criterion, "data": {"tool_results": len(notes)}})
            final = structured(SUBAGENT_MODEL, SubagentResult)
            result = await final.ainvoke(
                [SystemMessage(prompt), HumanMessage("Tool budget exhausted. Answer now using ONLY these tool results; cite only ids that appear in them.\n\n" + "\n\n".join(notes)[-30000:])],
                config={"run_name": f"subagent {brief.criterion}: final answer (budget exhausted)"},
            )
        return result or SubagentResult(profiles=[], dead_ends=["Sub-agent ended without a structured answer."])


def _handle(update: dict, brief: Brief, emit: Callable[[dict], None], notes: list[str]) -> SubagentResult | None:
    result = None
    for node_out in update.values():
        if not isinstance(node_out, dict):
            continue
        for msg in node_out.get("messages", []):
            if isinstance(msg, AIMessage):
                for call in msg.tool_calls:
                    if call["name"] != "SubagentResult":
                        emit({"type": "tool_call", "criterion": brief.criterion, "data": {"tool": call["name"], "args": call["args"]}})
            elif isinstance(msg, ToolMessage) and msg.name != "SubagentResult":
                notes.append(f"[{msg.name}] {str(msg.content)[:2500]}")
                emit({"type": "tool_result", "criterion": brief.criterion, "data": {"tool": msg.name, "chars": len(str(msg.content)), "error": msg.status == "error"}})
        if node_out.get("structured_response") is not None:
            result = node_out["structured_response"]
    return result


async def run_subagent(brief: Brief, emit: Callable[[dict], None]) -> SubagentResult:
    emit({"type": "subagent_started", "criterion": brief.criterion, "data": brief.model_dump()})
    try:
        result = await asyncio.wait_for(_run(brief, emit), SUBAGENT_TIMEOUT_S)
    except asyncio.TimeoutError:
        result = SubagentResult(profiles=[], dead_ends=[f"Timed out after {SUBAGENT_TIMEOUT_S:.0f}s."])
    except Exception as e:  # one broken sub-agent must not sink the run
        while isinstance(e, BaseExceptionGroup) and e.exceptions:  # TaskGroups wrap the real cause
            e = e.exceptions[0]
        result = SubagentResult(profiles=[], dead_ends=[f"Sub-agent error: {type(e).__name__}: {e}"[:300]])
    emit({"type": "subagent_finished", "criterion": brief.criterion, "data": {"profiles": len(result.profiles), "goals": [x.therapeutic_goal for x in result.profiles], "targets": [[t.symbol for t in x.molecular_targets] for x in result.profiles], "dead_ends": result.dead_ends}})
    return result
