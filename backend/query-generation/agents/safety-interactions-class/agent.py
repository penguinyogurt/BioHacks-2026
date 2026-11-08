from shared.query import query, rank_queries


def run(g,p,pool,review):
    # Query the drug-interaction neighborhood, with direction checked separately.
    # Pool membership alone never supplies a safety witness.
    therapy=p["therapy"]
    qs=[]
    if therapy==review["applies_with"]:
        r="DRUGBANK::ddi-interactor-in::Compound:Compound"
        for forward in (False,True):
            neighbors=g.walk(therapy,r,forward)
            if not neighbors:continue
            other=min(neighbors)
            witness=[therapy,r,other] if forward else [other,r,therapy]
            support={}
            for node,record in review["reviewed"].items():
                if node in pool and node not in neighbors and record.get("source") and record.get("finding"):
                    support[node]=record
            # Require an explicit review if a graph interaction flags this exact pair.
            opposite=set(g.walk(therapy,r,not forward))
            support={n:v for n,v in support.items() if n not in opposite}
            qs.append(query(g,therapy,[(r,forward)],[p["facts"]["current_therapy"],p["source"],review["source"],witness],support))
    result=rank_queries(g,qs,risk=True)
    result["interpretation"]="Farther from the nearest risk query ranks first ONLY among independently reviewed candidates. Remaining risks and delivery-route safety are unknown."
    result["unknown_count"]=len(pool)-len(result["ranking"])
    return result
