"""Construct translated query points. Never write into an embedding matrix."""
import numpy as np


def paths(graph, anchor, steps, pool):
    frontier={anchor:[]}
    for relation,forward in steps:
        reached={}
        for node,path in sorted(frontier.items()):
            for target in graph.walk(node,relation,forward):
                triple=[node,relation,target] if forward else [target,relation,node]
                reached.setdefault(target,path+[triple])
        frontier=reached
    return {node:path for node,path in frontier.items() if node in pool}


def query(graph, anchor, steps, evidence, support, keep_empty=False):
    if not support and not keep_empty:return None
    node_type=anchor.split("::")[0]
    point=graph.E[graph.entities[anchor]].astype(float)
    traversals=[]
    for r,forward in steps:
        src,dst=graph.types[r] if forward else graph.types[r][::-1]
        if node_type!=src:raise ValueError("Query direction mismatch")
        point=point+(1 if forward else -1)*graph.R[graph.relations[r]]
        node_type=dst
        traversals.append(dict(relation=r,forward=forward,glossary=graph.gloss[r]))
    if node_type!="Compound":raise ValueError("Query does not end in compound space")
    return point,dict(anchor=anchor,traversals=traversals,evidence=evidence),support


def rank_queries(graph,queries,risk=False):
    best={}; anchors=[]
    for item in queries:
        if item is None:continue
        point,meta,supported=item
        index=len(anchors);anchors.append(meta)
        ids=sorted(supported)
        dist=np.linalg.norm(graph.E[[graph.entities[x] for x in ids]]-point,axis=1)
        for node,d in zip(ids,dist):
            if node not in best or d<best[node]["l2"]:
                best[node]=dict(id=node,l2=float(d),query=index,support=supported[node])
    # Closest supported hypothesis for benefit; closest risk is the most concerning.
    rows=sorted(best.values(),key=lambda x:((-1 if risk else 1)*x["l2"],x["id"]))
    for rank,row in enumerate(rows,1):row["rank"]=rank
    return dict(queries=anchors,ranking=rows,reason=None if rows else "No supported eligible compound for a sourced anchor.")
