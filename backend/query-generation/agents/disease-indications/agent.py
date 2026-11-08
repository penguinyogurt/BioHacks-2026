from shared.biology import TREATS
from shared.query import paths, query, rank_queries


def run(g,p,pool,review):
    disease=p["disease"]
    related="Hetionet::DrD::Disease:Disease"
    qs=[]
    for r in TREATS:
        # Use a direct treatment query. A candidate may have evidence for a
        # related indication even if its projected ALS treatment edge is novel.
        steps=[(r,False)]
        observed=g.walk(disease,r,False)
        if not observed:continue
        support=paths(g,disease,steps,pool)
        for direction in (True,False):
            via=paths(g,disease,[(related,direction),*steps],pool)
            for node,witness in via.items(): support.setdefault(node,witness)
        evidence=[p["facts"]["diagnosis"],p["source"],"https://id.nlm.nih.gov/mesh/D000690",
                  [min(observed),r,disease]]
        qs.append(query(g,disease,steps,evidence,support))
    return rank_queries(g,qs)
