"""Neo's load_patient → plan → parallel Send → verify → synthesize coordinator.

Adapted from agent/research-backend:agent/graph.py at 99458b4. The planner
still has exclusive record access. Category researchers receive one brief only.
"""
import asyncio
import operator
from typing import Annotated, TypedDict

from langgraph.graph import START, END, StateGraph
from langgraph.types import Send

from agent.config import ANTHROPIC_API_KEY, ORCHESTRATOR_MODEL
from agent.privacy import sanitize_brief
from agent.schemas import Brief, Plan
from ranking.intersection import NAMES


class State(TypedDict, total=False):
    record: dict
    briefs: list
    planner: str
    results: Annotated[list, operator.add]
    verified: dict
    report: dict


def read_case(path):
    """The coordinator boundary owns the single decode of the input chart."""
    import json
    record=json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(record.get("facts"),dict) or not record.get("source"):
        raise ValueError("A sourced case with structured facts is required")
    return record


def fan_out(state):
    return [Send("research", {"brief": b}) for b in state["briefs"]]


def build_graph(load_patient, plan, research, verify, synthesize):
    graph = StateGraph(State)
    graph.add_node("load_patient", load_patient)
    graph.add_node("plan", plan)
    graph.add_node("research", research)
    graph.add_node("verify", verify)
    graph.add_node("synthesize", synthesize)
    graph.add_edge(START, "load_patient")
    graph.add_edge("load_patient", "plan")
    graph.add_conditional_edges("plan", fan_out, ["research"])
    graph.add_edge("research", "verify")
    graph.add_edge("verify", "synthesize")
    graph.add_edge("synthesize", END)
    return graph.compile()


def coordinate(record, prepare, worker, finalize, planner_mode, plan_cache, replay_only=False):
    async def load_patient(state):
        return {"record": record}  # Already decoded once by the CLI.

    async def plan(state):
        briefs, sensitive = prepare(state["record"])
        mode = planner_mode
        if mode == "auto":
            mode = "claude" if ANTHROPIC_API_KEY else "local"
        if mode == "claude":
            import json
            from langchain_core.messages import HumanMessage, SystemMessage
            from agent.llm import structured
            keys = {b["criterion"]:json.dumps(b,sort_keys=True) for b in briefs}
            pending = [b for b in briefs if keys[b["criterion"]] not in plan_cache]
            if pending:
                if replay_only or not ANTHROPIC_API_KEY:
                    raise ValueError("Planner replay unavailable or hosted key missing for this case. Use a live run with --agent-env.")
                planner = structured(ORCHESTRATOR_MODEL, Plan)
                answer = await planner.ainvoke([
                    SystemMessage("You are the lead researcher on an ALS drug-repurposing team. You have the "
                                  "case coordinator's sourced fact abstractions. Produce exactly one Brief per supplied "
                                  "criterion. Refine its objective, constraints and avoid list. Keep negated facts "
                                  "negated and mechanisms hypotheses. No identifying details, measurements or drug names. "
                                  "Local delivery is assumed for retrieval; passive BBB permeability is outside ranking."),
                    HumanMessage(json.dumps(pending))
                ], config={"run_name":"orchestrator: plan"})
                if sorted(b.criterion for b in answer.briefs)!=sorted(b["criterion"] for b in pending):
                    raise ValueError("Hosted planner omitted or duplicated a requested category")
                for b in answer.briefs:
                    plan_cache[keys[b.criterion]]=b.model_dump()
            proposed={n:Brief(**plan_cache[key]) for n,key in keys.items()}
        else:
            proposed = {b["criterion"]:Brief(**{k:b[k] for k in Brief.model_fields}) for b in briefs}
        for b in briefs:
            safe, _ = sanitize_brief(proposed[b["criterion"]], sensitive)
            b.update(safe.model_dump())
            b["planner"] = mode
        return {"briefs":briefs,"planner":mode}

    async def research(payload):
        brief = payload["brief"]
        result = await asyncio.to_thread(worker, brief)
        return {"results":[(brief["criterion"], result)]}

    def verify(state):
        results = dict(state["results"])
        if len(state["results"]) != 5 or set(results) != set(NAMES):
            raise ValueError("Incomplete five-category handoff")
        for name in NAMES:
            for q in results[name]["queries"]:
                if not q["finding_ids"] or not q["evidence"]:
                    raise ValueError("Query without an attributable research finding")
        return {"verified":{n:results[n] for n in NAMES}}

    def synthesize(state):
        result = finalize(state["verified"])
        result["coordinator"] = {"source_revision":"99458b4321133d93242b2f29ab744d2c85caab58",
                                 "stages":["load_patient","plan","research × 5","verify","synthesize"],
                                 "planner":state["planner"],"planner_model":ORCHESTRATOR_MODEL if state["planner"]=="claude" else None,
                                 "briefs":state["briefs"]}
        return {"report":result}

    flow = build_graph(load_patient, plan, research, verify, synthesize)
    return asyncio.run(flow.ainvoke({}, config={"max_concurrency":5}))["report"]
