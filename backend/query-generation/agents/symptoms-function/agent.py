from shared.biology import TREATS
from shared.query import paths, query, rank_queries


def run(g,p,pool,review):
    qs=[]
    for fact,hypothesis in p["symptom_hypotheses"].items():
        if not p["facts"].get(fact):continue
        node=hypothesis["node"]
        evidence=[p["facts"][fact],p["source"],hypothesis["source"],hypothesis["interpretation"]]
        for r in TREATS:
            steps=[(r,False)]
            qs.append(query(g,node,steps,evidence,paths(g,node,steps,pool)))
    return rank_queries(g,qs)
