"""Five-way research retrieval using frozen DRKG embeddings."""
import argparse
import importlib.util
from functools import lru_cache
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
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


def agent(name):
    return load_agent(name).run


def run(graph,profile,review,k,catalog,terms,policy,leader_catalog,offline):
    from ranking.fallback import fallback
    from shared.leader_review import reviewer
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
    pool = frozenset(gate["evidence"].keys() - excluded.keys() - established.keys())
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {n: executor.submit(agent(n),graph,profile,pool,review,terms) for n in NAMES}
        agents = {n: f.result() for n,f in futures.items()}
    lists = {n:[r["id"] for r in result["ranking"]] for n,result in agents.items()}
    intersection = aggregate(lists,k,pool)
    secondary = None
    if not intersection["final"]:
        examine = reviewer(profile, leader_catalog, offline, graph, meds, labels)
        secondary = fallback(pool,agents,policy,examine)
    contextual={}
    for node in sorted(set().union(*lists.values())):
        annotation=review["reviewed"].get(node,{})
        contextual[node]={field:annotation.get(field,{"value":"unknown","source":None}) for field in FIELDS}
        contextual[node]["safety_review"]=annotation.get("finding","unknown")
    return dict(case=profile, trial_gate=gate, established=established, eligible_ids=sorted(pool),
        ingredient_names={n:i['name'] for n,i in labels.items()}, fallback=secondary,
        assumption="Adequate local delivery is assumed for research retrieval. No passive BBB permeability feature, filter, or score.",
        interpretation="L2 scores are graph predictions. Each triple is a graph assertion, not clinical verification. No benefit or safety for local administration has been established.",
        sources={"graph":URL,"release_archive_sha256":SHA,"safety_evidence":review},
        graph={"entities":len(graph.entities),"relations":len(graph.relations),"triples_read":graph.triples,
               "quarantined_direction_or_type_mismatches":graph.quarantined},
        pool={"rule":"Exact DRKG Compound::DB plus five digits; one canonical DrugBank ID each. No unverified alias merges.",
              "canonical_count":len(candidates),"eligible_count":len(pool),"exclusions":excluded},
        agents=agents,aggregation=intersection,context_fields=contextual,
        unknown_policy="All unreviewed compound-specific safety, cost, Canadian availability, regulatory status and acceptance facts are unknown. Administrative fields do not influence scores.")


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--top-k",type=int,default=100)
    parser.add_argument("--data",type=Path,default=ROOT/"data")
    parser.add_argument("--trials",type=Path,default=ROOT/"examples/als-study-cache.json")
    parser.add_argument("--profile",type=Path,default=ROOT/"examples/alex.json")
    parser.add_argument("--review",type=Path,default=ROOT/"examples/safety.json")
    parser.add_argument("--output",type=Path,default=ROOT/"reports/alex-gated.json")
    parser.add_argument("--policy",type=Path,default=ROOT/"examples/fallback-policy.json")
    parser.add_argument("--leader-review",type=Path,default=ROOT/"examples/alex-leader-reviews.json")
    parser.add_argument("--offline",action="store_true",help="Use previously downloaded DRKG and stored review records; skip network requests.")
    args=parser.parse_args()
    if args.top_k<1:parser.error("--top-k must be positive")
    if not args.offline:download(args.data)
    graph=Graph(args.data)
    from shared.terms import Terms
    catalog = json.loads(args.trials.read_text())
    terms = Terms.load(args.data, graph, catalog, args.offline)
    report = run(graph, json.loads(args.profile.read_text()), json.loads(args.review.read_text()), args.top_k,
                 catalog, terms, json.loads(args.policy.read_text()), json.loads(args.leader_review.read_text()), args.offline)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    from tempfile import NamedTemporaryFile
    with NamedTemporaryFile(mode="w",dir=args.output.parent,delete=False) as tmp:
        json.dump(report,tmp,indent=2,allow_nan=False)
    os.replace(tmp.name,args.output)
    print(json.dumps(report["aggregation"],indent=2))
    from shared.dossier import write_outputs
    write_outputs(report,args.output,load_agent)
    for row in (report.get("fallback") or {}).get("final",[]):
        print(row["fallback_rank"],row["id"],row["review"]["name"],round(row["score"],5),row["review"]["safety"])
    print("Full report:",args.output)


if __name__=="__main__":main()
