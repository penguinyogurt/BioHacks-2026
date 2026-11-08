from shared.biology import linked_genes, ASSOCIATION, TARGET
from shared.query import paths, query, rank_queries


def run(g,p,pool,review):
    qs=[]
    for gene in linked_genes(g,p):
        evidence=[p["gene_source"],[p["disease"],ASSOCIATION,gene],"Disease biology only; no patient genotype inferred."]
        for r in TARGET:
            steps=[(r,False)]
            qs.append(query(g,gene,steps,evidence,paths(g,gene,steps,pool)))
    return rank_queries(g,qs)
