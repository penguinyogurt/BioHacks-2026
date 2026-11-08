"""Write the five handoffs and compare one isolated record edit."""
import json
import numpy as np
from ranking.intersection import NAMES
from shared.query import query


def write_json(path,value):
    path.write_text(json.dumps(value,indent=2,allow_nan=False)+"\n")


def save_handoff(report, path):
    root = path.parent/(path.stem+"-research")/"handoff"
    root.mkdir(parents=True,exist_ok=True)
    for brief in report["coordinator"]["briefs"]:
        name = brief["criterion"]
        output = report["agents"][name]
        folder = root/name
        folder.mkdir(exist_ok=True)
        ledger = {fact["field"]:dict(source=report["case"]["source"],pointer=fact["pointer"],
                                     quote=report["case"]["facts"][fact["field"]]) for fact in brief["facts"]}
        write_json(folder/"brief.json", dict(dispatched_brief=brief,local_source_quotes=ledger))
        write_json(folder/"trace.json",dict(local_source_ledger=ledger,searches=output["searches"],
                   findings=output["findings"],hosted=output.get("hosted",{}),unmapped=output["unmapped"],reason=output["reason"],
                   queries=[{k:v for k,v in q.items() if k!="scores"} for q in output["queries"]]))
        write_json(folder/"ranking.json",dict(rank_type=output["rank_type"],
                   full_cohort_size=output["pool_size"],top_k=output["top_k"],
                   fusion_ranks=output["ranking"],aggregation=output["combination"]))


def compare(g, first, second):
    assert first["eligible_ids"]==second["eligible_ids"]
    delta, summary = {}, {}
    for name in NAMES:
        def brief(report):
            return next(x for x in report["coordinator"]["briefs"] if x["criterion"]==name)
        a,b = first["agents"][name],second["agents"][name]
        def points(output):
            vectors = {}
            for q in output["queries"]:
                steps = [(s["relation"],s["forward"]) for s in q["traversals"]]
                point = query(g,q["anchor"],steps,[],{},keep_empty=True)[0]
                vectors[q["formula"]] = point
            return vectors
        x,y=points(a),points(b)
        diffs={key:float(np.linalg.norm(x[key]-y[key])) for key in sorted(x.keys() & y.keys())}
        def ranks(rows):
            return {r["id"]:r["rank"] for r in rows}
        def changes(key):
            m,n=ranks(a[key]),ranks(b[key])
            return {node:[m.get(node),n.get(node)] for node in sorted(m.keys() | n.keys()) if m.get(node)!=n.get(node)}
        delta[name]=dict(brief_changed=brief(first)!=brief(second),first=brief(first),second=brief(second),
                         query_l2=diffs,removed=sorted(x.keys()-y.keys()),added=sorted(y.keys()-x.keys()),
                         retrieval_changes=changes("retrieval"),fusion_changes=changes("ranking"))
        summary[name]=dict(brief_changed=delta[name]["brief_changed"],queries=[len(x),len(y)],
                           max_paired_l2=max(diffs.values(),default=None),
                           changed_retrieval_ranks=len(delta[name]["retrieval_changes"]),
                           changed_fusion_ranks=len(delta[name]["fusion_changes"]))
    def flags(report,n):
        d=report["reassessments"][n]; v=d.get("review",{})
        return dict(case_review=v.get("action","unreviewed"),ddi_edges=v.get("ddi_edges",[]),
                    penalty=d["graph"]["penalty"],score=d["graph"]["internal_ranking_score"],
                    disposition=d["disposition"])
    changes={n:[flags(first,n),flags(second,n)] for n in first["eligible_ids"] if flags(first,n)!=flags(second,n)}
    if first["coordinator"]["planner"]=="local" and summary[NAMES[0]]["max_paired_l2"] not in (None,0.0):
        raise ValueError("Medication-only edit altered the disease query")
    return dict(summary=summary,agents=delta,scored_pool=first["eligible_ids"],safety_or_score_changes=changes,
                natural_pools=[r["pool"]["native_eligible_ids"] for r in (first,second)],
                case_exclusions=[r["pool"]["exclusions"] for r in (first,second)],
                final=[r["advanced"] for r in (first,second)])
