"""Five-way research retrieval using frozen DRKG embeddings."""
import argparse
import importlib.util
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from ranking.intersection import NAMES,aggregate
from shared.graph import Graph,download,URL,SHA

ROOT=Path(__file__).resolve().parent
FIELDS=("cost","canadian_availability","regulatory_status","patient_acceptance")


def agent(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/"agents"/name/"agent.py")
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.run


def run(graph,profile,review,k):
    candidates={n for n in graph.entities if re.fullmatch(r"Compound::DB\d{5}",n)}
    excluded={}
    if profile["therapy"] in candidates:
        excluded[profile["therapy"]]={"reason":"Current therapy, excluded from repurposing pool.","source":profile["source"]}
    if review["applies_with"]==profile["therapy"]:
        for node,name in review["exclude"].items():
            if node in candidates:
                excluded[node]=dict(name=name,reason=review["policy"],source=review["source"],id_source=review["id_source"])
    for item in review.get("chart_exclusions",[]):
        if item["id"] in candidates and profile["facts"].get(item["fact"])==item["case_value"]:
            excluded[item["id"]]=item
    pool=frozenset(candidates-excluded.keys())
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures={n:executor.submit(agent(n),graph,profile,pool,review) for n in NAMES}
        agents={n:f.result() for n,f in futures.items()}
    lists={name:[r["id"] for r in result["ranking"]] for name,result in agents.items()}
    intersection=aggregate(lists,k)
    contextual={}
    for node in sorted(set().union(*lists.values())):
        annotation=review["reviewed"].get(node,{})
        contextual[node]={field:annotation.get(field,{"value":"unknown","source":None}) for field in FIELDS}
        contextual[node]["safety_review"]=annotation.get("finding","unknown")
    return dict(case=profile,
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
    parser.add_argument("--profile",type=Path,default=ROOT/"examples/alex.json")
    parser.add_argument("--review",type=Path,default=ROOT/"examples/safety.json")
    parser.add_argument("--output",type=Path,default=ROOT/"reports/alex.json")
    parser.add_argument("--offline",action="store_true",help="Require previously downloaded DRKG files.")
    args=parser.parse_args()
    if args.top_k<1:parser.error("--top-k must be positive")
    if not args.offline:download(args.data)
    graph=Graph(args.data)
    report=run(graph,json.loads(args.profile.read_text()),json.loads(args.review.read_text()),args.top_k)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    from tempfile import NamedTemporaryFile
    with NamedTemporaryFile(mode="w",dir=args.output.parent,delete=False) as tmp:
        json.dump(report,tmp,indent=2,allow_nan=False)
    os.replace(tmp.name,args.output)
    print(json.dumps(report["aggregation"],indent=2))
    print("Full report:",args.output)


if __name__=="__main__":main()
