from itertools import combinations

NAMES=("disease-indications","genes-targets","safety-interactions-class","pathways-processes","symptoms-function")


def aggregate(lists,k,pool=None):
    if k<1:raise ValueError("top-k must be positive")
    if set(lists)-set(NAMES):raise ValueError("Unexpected agent")
    ranks={}
    for name in NAMES:
        ids=lists.get(name,[])
        if pool is not None and not set(ids).issubset(pool):raise ValueError("Agent ranked an ineligible compound")
        if len(ids)!=len(set(ids)):raise ValueError(f"Duplicate compound in {name}")
        ranks[name]={n:i for i,n in enumerate(ids[:k],1)}
    absent=[n for n in NAMES if not ranks[n]]
    survivors=set.intersection(*(set(r) for r in ranks.values()))
    ordered=[]
    for n in survivors:
        votes={agent:rank[n] for agent,rank in ranks.items()}
        ordered.append(dict(id=n,ranks=votes,mean_rank=sum(votes.values())/5,worst_rank=max(votes.values())))
    ordered.sort(key=lambda row:(row["mean_rank"],row["worst_rank"],row["id"]))
    for i,row in enumerate(ordered,1):row["final_rank"]=i
    return dict(status="five-way ranking unavailable" if absent else
                "ranked" if ordered else "no five-way overlap at K",abstained=absent,
                supported_sizes={n:len(lists.get(n,[])) for n in NAMES},top_k=k,
                list_sizes={n:len(r) for n,r in ranks.items()},
                pairwise_overlap={a+" / "+b:len(ranks[a].keys()&ranks[b].keys()) for a,b in combinations(NAMES,2)},
                five_way_overlap=len(ordered),final=ordered)
