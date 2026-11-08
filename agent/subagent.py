"""One sub-agent = one criterion. It sees a sanitized Brief and the
als-research MCP tools, never the patient record."""
import asyncio
import sys
from typing import Callable

from langchain.agents import create_agent
from langchain.agents.structured_output import ToolStrategy
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.errors import GraphRecursionError
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_mcp_adapters.tools import load_mcp_tools

from agent.config import MAX_TOOL_CALLS, ROOT, SUBAGENT_MODEL, SUBAGENT_TIMEOUT_S
from agent.llm import gemini
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

SYSTEM = """You are a focused pharmacology research sub-agent on an ALS drug-repurposing team.
A lead researcher sent you the brief below. You don't know who the patient is; don't ask and don't speculate.

Criterion {cid}: {label} ({focus})
Objective: {objective}
A drug must: {constraints}
Avoid: {avoid}

How to work:
- Use the tools. Prefer already-approved drugs (this is repurposing). Check our own pipeline with pipeline_drug.
- Every finding needs at least one evidence item whose id and url came from a tool result:
  PMID (search_pubmed), NCT id (search_als_trials/get_trial), CHEMBL id (chembl_drug / Open Targets),
  FDA label set_id (fda_label), PubChem CID, or pipeline InChIKey. Never invent ids or urls.
- Be honest about evidence_level. If a drug failed in ALS trials, set failed_in_als_trials and say why.
- Stop after at most {max_calls} tool calls, then answer with 1-5 findings and list your dead ends."""


def _llm():
    return gemini(SUBAGENT_MODEL)


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
        tools = await load_mcp_tools(session)
        agent = create_agent(_llm(), tools, system_prompt=prompt, response_format=ToolStrategy(SubagentResult), name=f"subagent_{brief.criterion}")
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
            final = _llm().with_structured_output(SubagentResult)
            result = await final.ainvoke(
                [SystemMessage(prompt), HumanMessage("Tool budget exhausted. Answer now using ONLY these tool results; cite only ids that appear in them.\n\n" + "\n\n".join(notes)[-30000:])],
                config={"run_name": f"subagent {brief.criterion}: final answer (budget exhausted)"},
            )
        return result or SubagentResult(findings=[], dead_ends=["Sub-agent ended without a structured answer."])


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
        result = SubagentResult(findings=[], dead_ends=[f"Timed out after {SUBAGENT_TIMEOUT_S:.0f}s."])
    except Exception as e:  # one broken sub-agent must not sink the run
        while isinstance(e, BaseExceptionGroup) and e.exceptions:  # TaskGroups wrap the real cause
            e = e.exceptions[0]
        result = SubagentResult(findings=[], dead_ends=[f"Sub-agent error: {type(e).__name__}: {e}"[:300]])
    emit({"type": "subagent_finished", "criterion": brief.criterion, "data": {"findings": len(result.findings), "drugs": [f.drug for f in result.findings], "dead_ends": result.dead_ends}})
    return result
