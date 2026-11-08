import unittest
from types import SimpleNamespace
import numpy as np
from ranking.intersection import aggregate,NAMES
from shared.query import query,rank_queries,paths
from shared.graph import Graph


class Intersection(unittest.TestCase):
    def test_truncate_then_intersect(self):
        lists={n:["A","B","C"] for n in NAMES}
        lists[NAMES[-1]]=["C","B","A"]
        result=aggregate(lists,2)
        self.assertEqual([r["id"] for r in result["final"]],["B"])
        self.assertEqual(result["final"][0]["ranks"],{n:2 for n in NAMES})

    def test_mean_then_worst_then_id(self):
        # Use private fillers, so only the three named candidates intersect.
        ranks={"C":[1,1,5,5,3],"B":[2,3,4,2,4],"A":[3,4,2,4,2]}
        lists={}
        for i,n in enumerate(NAMES):
            ids=[f"{i}-{j}" for j in range(5)]
            for key,positions in ranks.items():ids[positions[i]-1]=key
            lists[n]=ids
        rows=aggregate(lists,5)["final"]
        self.assertEqual([(x["id"],x["mean_rank"],x["worst_rank"]) for x in rows],
                         [("A",3,4),("B",3,4),("C",3,5)])
        self.assertEqual([r["final_rank"] for r in rows],[1,2,3])

    def test_empty_overlap(self):
        result=aggregate({n:[n] for n in NAMES},100)
        self.assertEqual(result["status"],"no five-way overlap at K")
        self.assertFalse(result["final"])
        self.assertTrue(all(v==0 for v in result["pairwise_overlap"].values()))

    def test_abstention(self):
        # The actual safety agent must abstain when reviewed evidence is missing.
        from shared.retrieval import apply_safety_review
        r={"ranking":[],"retrieval":[{"id":"Compound::X","l2":1.0}]}
        g=SimpleNamespace(walk=lambda *args:[])
        apply_safety_review(r,g,["Compound::T"],{"applies_with":"Compound::T","reviewed":{}},False)
        self.assertEqual(r["ranking"],[])
        lists={n:["A"] for n in NAMES}
        lists[NAMES[2]]=r["ranking"]
        out=aggregate(lists,1)
        self.assertEqual(out["status"],"five-way ranking unavailable")
        self.assertEqual(out["abstained"],[NAMES[2]])
        self.assertFalse(out["final"])

    def test_risk_direction_and_immutability(self):
        g=SimpleNamespace(entities={"Compound::T":0,"Compound::near":1,"Compound::far":2},
                          E=np.array([[3.,0],[5.,0],[15.,0]]),R=np.array([[2.,0]]),
                          relations={"ddi":0},types={"ddi":("Compound","Compound")},gloss={"ddi":{}})
        g.E.flags.writeable=False
        q=query(g,"Compound::T",[("ddi",True)],["fixture"],{"Compound::near":["review"],"Compound::far":["review"]})
        rows=rank_queries(g,[q],risk=True)["ranking"]
        self.assertEqual([(r["id"],r["l2"]) for r in rows],[("Compound::far",10),("Compound::near",0)])
        self.assertEqual(rank_queries(g,[q])["ranking"][0]["id"],"Compound::near")

    def test_signed_multihop(self):
        g=Graph.__new__(Graph)
        g.names=["Compound::c","Gene::g","Pathway::p"]
        g.entities=dict(zip(g.names,range(3)))
        g.relations={"cg":0,"gp":1}
        g.types={"cg":("Compound","Gene"),"gp":("Gene","Pathway")}
        g.gloss={"cg":{},"gp":{}}
        g.edges={"cg":np.array([[0,1]]),"gp":np.array([[1,2]])}
        g.E=np.array([[1.,2.],[4.,4.],[5.,8.]])
        g.R=np.array([[3.,2.],[1.,4.]])
        steps=[("gp",False),("cg",False)]
        support=paths(g,"Pathway::p",steps,{"Compound::c"})
        self.assertEqual(len(support["Compound::c"]),2)
        q=query(g,"Pathway::p",steps,[],support)
        np.testing.assert_equal(q[0],g.E[0])
        with self.assertRaises(ValueError):g.walk("Pathway::p","gp",True)
