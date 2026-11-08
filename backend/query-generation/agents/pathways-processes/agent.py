from shared.biology import linked_genes, ASSOCIATION, PARTICIPATES, TARGET
from shared.query import paths, query, rank_queries


def run(g,p,pool,review):
    process=p["process"]
    genes=set(linked_genes(g,p)).intersection(g.walk(process,PARTICIPATES,False))
    qs=[]
    if genes:
        bridge=min(genes)
        evidence=[p["process_source"],p["gene_source"],[p["disease"],ASSOCIATION,bridge],
                  [bridge,PARTICIPATES,process],"Experimental ALS mechanism; pathway participation does not imply beneficial modulation."]
        for r in TARGET:
            steps=[(PARTICIPATES,False),(r,False)]
            qs.append(query(g,process,steps,evidence,paths(g,process,steps,pool)))
    return rank_queries(g,qs)
