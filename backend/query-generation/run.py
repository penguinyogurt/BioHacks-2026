"""Coordinate five public-source researchers and screen full-pool DRKG predictions for ALS."""
import argparse
import importlib.util
from functools import lru_cache
import json
import os
import re
import copy
from pathlib import Path

from ranking.intersection import NAMES,aggregate
from shared.graph import Graph,download,URL,SHA

ROOT=Path(__file__).resolve().parent
FIELDS=("cost","canadian_availability","regulatory_status","patient_acceptance")


@lru_cache(None)
def load_agent(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/"agents"/name/"agent.py")
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(graph,profile,review,k,catalog,terms,policy,leader_catalog,offline,clinical=None,previous=None, *, sources=None, protocols=None, planner_mode="auto", cohort=None, plan_cache=None, hosted_cache=None):
    from ranking.fallback import select
    from shared.outcomes import assess, ADVANCE_CATEGORIES, DISCOVERY
    from shared.leader_review import reviewer, applicable_records
    from shared.trial_gate import trial_gate

    candidates = {n for n in graph.entities if re.fullmatch(r"Compound::DB\d{5}", n)}
    gate = trial_gate(candidates, catalog)
    labels = {item["id"]: item for item in catalog["ingredients"]}
    parts = terms.medication_parts(profile["facts"].get("current_therapy", ""))
    meds = sorted({node for _, ids in parts for node in ids})
    excluded = {}
    for node in meds:
        excluded[node] = dict(name=terms.labels[node], reason="Current therapy", source=profile["source"])
    if review["applies_with"] in meds:
        for node, name in review["exclude"].items():
            if node in candidates:
                excluded[node] = dict(name=name, reason=review["policy"], source=review["source"])
    for item in review.get("chart_exclusions", []):
        if item["id"] in candidates and profile["facts"].get(item["fact"]) == item["case_value"]:
            excluded[item["id"]] = item
    established = {}
    for node in gate["evidence"]:
        if labels[node]["classification"].startswith("Established"):
            established[node] = labels[node]
    native_pool = frozenset(candidates - excluded.keys() - established.keys())
    pool = native_pool if cohort is None else frozenset(cohort)
    if not pool <= native_pool:
        raise ValueError("A comparison candidate fails the native eligibility screen")
    clinical = clinical or {}
    decisions = {node: assess(node, studies, clinical) for node, studies in gate["evidence"].items()}
    for node, item in decisions.items():
        if node in established:
            item["disposition"] = "established treatment; comparator only"
        elif node in excluded:
            item["disposition"] = "excluded by case screen"
        if node in excluded:
            item["case_exclusion"] = excluded[node]

    clinical_ids={n for entry in clinical.get("reports",[]) for n in entry["applies_to"]}
    for node in pool - decisions.keys():
        if node in clinical_ids:
            # New human findings (particularly harm) cannot be bypassed by an
            # older administration crosswalk missing a canonical ingredient.
            decisions[node]=assess(node,[],clinical)
            continue
        decisions[node] = dict(category=DISCOVERY, decisive=[], studies=[], delivery={},
                               testing_status="unknown in bounded human ALS cache", unreviewed_studies=[],
                               conflicting_endpoints=[], favorable_endpoints=[])
    for node in native_pool - pool:
        if node in decisions:
            decisions[node]["disposition"]="outside fixed medication-comparison cohort"
    from agent.graph import coordinate
    from shared.briefs import make_briefs
    from shared.research_sources import Sources
    from shared.retrieval import apply_safety_review
    if protocols is None:
        protocols = json.loads((ROOT/"examples/research-protocols.json").read_text())
    if sources is None:
        sources = Sources(json.loads((ROOT/"examples/research-receipts.json").read_text()),refresh=not offline,replay_only=offline)

    def worker(brief):
        name = brief["criterion"]
        return load_agent(name).research(brief,graph,pool,terms,protocols[name],sources,k,hosted_cache)

    def finalize(agents):
        examine = reviewer(profile, leader_catalog, offline, graph, meds, labels)
        case_records = applicable_records(profile, leader_catalog)
        for node in sorted(pool):
            if node in case_records or decisions[node]["category"] in ADVANCE_CATEGORIES[:2]:
                decisions[node]["review"] = examine(node)
        unresolved = any(not ids and not re.search(r"\b(no|not|stopped|discontinued|never)\b",part,re.I)
                         for part,ids in parts)
        apply_safety_review(agents[NAMES[2]], graph, meds, review, unresolved)
        for output in agents.values():
            # Reattach the private source citation after the LangGraph verification barrier.
            output["facts"] = [dict(f, source=profile["source"],mapping=f["status"],
                                    ids=sorted({q["anchor"] for q in output["queries"] if q["fact"]["field"]==f["field"]}))
                               for f in output["facts"]]
            for q in output["queries"]:
                q["fact"] = next(f for f in output["facts"] if f["field"]==q["fact"]["field"])
        lists = {n:[r["id"] for r in result["ranking"]] for n,result in agents.items()}
        graph_overlap = aggregate(lists,k,pool)
        # Preserve overlap counts for the diagnostic graph audit, never expose its members as finalists.
        graph_overlap.pop("final")
        intersection, secondary, advanced = select(pool, agents, decisions, policy, k)
        discovery = [node for node in pool if decisions[node]["category"]==DISCOVERY
                     and decisions[node]["graph"]["rationale"]]
        discovery.sort(key=lambda node:(-decisions[node]["graph"]["internal_ranking_score"],node))
        prior = []
        if previous and previous["case"] == profile:
            for old in (previous.get("fallback") or previous["aggregation"])["final"]:
                node = old["id"]
                prior.append(dict(id=node, rank=old.get("fallback_rank",old.get("final_rank")),
                                  internal_ranking_score=old.get("internal_ranking_score",old.get("score")),
                                  disposition=decisions.get(node, {}).get("disposition", "outside current evidence cache")))
        contextual={}
        for node in sorted(gate["evidence"].keys() | pool):
            annotation=review["reviewed"].get(node,{})
            contextual[node]={field:annotation.get(field,{"value":"unknown","source":None}) for field in FIELDS}
            contextual[node]["safety_review"]=annotation.get("finding","unknown")
        return dict(case=profile, project="ALS drug discovery and reassessment", trial_gate=gate,
            reassessments=decisions, advanced=advanced,
            discovery_leads=[dict(id=n,rank=i+1,study_status="unverified in bounded cache",
                             internal_ranking_score=decisions[n]["graph"]["internal_ranking_score"],
                             disposition=decisions[n]["disposition"]) for i,n in enumerate(discovery[:k])], graph_overlap=graph_overlap, previous_finalists=prior,
            clinical_policy=clinical.get("policy", {}), fusion_policy=policy, established=established, eligible_ids=sorted(pool),
            ingredient_names={n:terms.labels.get(n,labels.get(n,{}).get("name",n)) for n in candidates | labels.keys()}, fallback=secondary,
            assumption="Adequate local delivery is a research assumption. Passive BBB permeability is outside ranking. Exposure, engagement and focused-ultrasound feasibility require separate evidence.",
            interpretation="L2 scores are graph predictions. Each triple is a graph assertion, not clinical verification. No benefit or safety for local administration has been established.",
            sources={"graph":URL,"release_archive_sha256":SHA,"safety_evidence":review},
            graph={"entities":len(graph.entities),"relations":len(graph.relations),"triples_read":graph.triples,
                   "quarantined_direction_or_type_mismatches":graph.quarantined},
            pool={"native_eligible_ids":sorted(native_pool),"verified_als_in_scored_pool":len(pool.intersection(gate["evidence"])),
                  "unknown_als_testing_in_scored_pool":len(pool-gate["evidence"].keys()),"rule":"Exact DRKG Compound::DB plus five digits; one canonical DrugBank ID each. No unverified alias merges.",
                  "canonical_count":len(candidates),"eligible_count":len(pool),"exclusions":excluded},
            agents=agents,aggregation=intersection,context_fields=contextual,
            unknown_policy="All unreviewed compound-specific safety, cost, Canadian availability, regulatory status and acceptance facts are unknown. Administrative fields do not influence scores.")
    return coordinate(profile, lambda record:make_briefs(record,terms,review), worker, finalize, planner_mode, plan_cache if plan_cache is not None else {}, sources.replay_only)



def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--top-k",type=int,default=100)
    parser.add_argument("--data",type=Path,default=ROOT/"data")
    parser.add_argument("--trials",type=Path,default=ROOT/"examples/als-study-cache.json")
    parser.add_argument("--profile",type=Path,default=ROOT/"examples/alex.json")
    parser.add_argument("--review",type=Path,default=ROOT/"examples/safety.json")
    parser.add_argument("--output",type=Path,default=ROOT/"reports/alex-coordinated.json")
    parser.add_argument("--clinical",type=Path,default=ROOT/"examples/clinical-reassessment.json")
    parser.add_argument("--previous",type=Path,default=ROOT/"snapshots/alex-gated.json")
    parser.add_argument("--policy",type=Path,default=ROOT/"examples/fallback-policy.json")
    parser.add_argument("--leader-review",type=Path,default=ROOT/"examples/alex-leader-reviews.json")
    parser.add_argument("--offline",action="store_true",help="Use previously downloaded DRKG and stored review records; skip network requests.")
    parser.add_argument("--planner",choices=("auto","local","claude"),default="auto")
    parser.add_argument("--medication-check",action="store_true",help="Repeat on the original cohort with only the current therapy negated.")
    parser.add_argument("--agent-env",type=Path,help="Path to Neo's existing agent/.env.")
    args=parser.parse_args()
    if args.agent_env:
        os.environ["BH_AGENT_ENV_FILE"]=str(args.agent_env.resolve())
    from agent.config import CACHE_DIR, ORCHESTRATOR_MODEL, SUBAGENT_MODEL
    hosted_cache=CACHE_DIR.parent/"hosted-research"/(ORCHESTRATOR_MODEL+"_"+SUBAGENT_MODEL)
    if args.offline and not (hosted_cache/"plans.json").is_file():
        hosted_cache=ROOT/"examples/coordinator-replay"/(ORCHESTRATOR_MODEL+"_"+SUBAGENT_MODEL)
    plan_cache={}
    if args.top_k<1:parser.error("--top-k must be positive")
    if not args.offline:download(args.data)
    graph=Graph(args.data)
    from shared.terms import Terms
    catalog = json.loads(args.trials.read_text())
    terms = Terms.load(args.data, graph, catalog, args.offline)
    from agent.graph import read_case
    profile = read_case(args.profile)
    config = (json.loads(args.review.read_text()),args.top_k,catalog,terms,json.loads(args.policy.read_text()),
              json.loads(args.leader_review.read_text()))
    clinical = json.loads(args.clinical.read_text())
    previous = json.loads(args.previous.read_text())
    from shared.research_sources import Sources
    from shared.hosted import persist
    plan_file=hosted_cache/"plans.json"
    if plan_file.is_file() and args.planner!="local":
        plan_cache=json.loads(plan_file.read_text())
    saved = json.loads((ROOT/"examples/research-receipts.json").read_text())
    report = run(graph,profile,*config,args.offline,clinical,previous,
                 sources=Sources(saved,refresh=not args.offline,replay_only=args.offline),planner_mode=args.planner,plan_cache=plan_cache,hosted_cache=hosted_cache)
    if plan_cache and not args.offline:
        persist(plan_file,plan_cache)
    save_report(report,args.output)
    if args.medication_check:
        from shared.comparison import compare
        second = copy.deepcopy(profile)
        second["facts"]["current_therapy"] = "Not taking " + profile["facts"]["current_therapy"]
        for output in report["agents"].values():
            saved.update({s["url"]:s for s in output["searches"]})
        altered = run(graph,second,*config,True,clinical,previous,sources=Sources(saved,replay_only=args.offline),
                      planner_mode=args.planner,plan_cache=plan_cache,hosted_cache=hosted_cache,cohort=report["eligible_ids"])
        other = args.output.with_name(args.output.stem+"-medication-off.json")
        if plan_cache and not args.offline:
            persist(plan_file,plan_cache)
        save_report(altered,other)
        result = compare(graph,report,altered)
        args.output.with_name(args.output.stem+"-medication-check.json").write_text(json.dumps(result,indent=2)+"\n")
        print(json.dumps(result["summary"],indent=2))


def save_report(report, path):
    path.parent.mkdir(parents=True,exist_ok=True)
    from tempfile import NamedTemporaryFile
    with NamedTemporaryFile(mode="w",dir=path.parent,delete=False) as tmp:
        json.dump(report,tmp,indent=2,allow_nan=False)
    os.replace(tmp.name,path)
    print("Strict intersection:",report["aggregation"]["status"])
    from shared.dossier import write_outputs
    write_outputs(report,path,load_agent)
    from shared.comparison import save_handoff
    save_handoff(report,path)
    print(f"{len(report['advanced'])} advanced among {len(report['eligible_ids'])} investigational ingredients.")
    for row in report["advanced"]:
        print(row["final_rank"], report["ingredient_names"][row["id"]], row["category"],
              "internal ranking score", round(row["internal_ranking_score"], 5))
    print("Full report:",path)


if __name__=="__main__":main()
