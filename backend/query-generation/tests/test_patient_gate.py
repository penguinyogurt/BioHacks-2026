import copy
import json
import unittest
from pathlib import Path

import numpy as np

from ranking.intersection import NAMES, aggregate
from run import run
from shared.briefs import make_briefs
from shared.research_sources import Sources
from shared.biology import ASSOCIATION, PARTICIPATES, TARGET, TREATS
from shared.graph import Graph
from shared.biology import DDI
from shared.terms import Terms
from shared.trial_gate import trial_gate

ROOT = Path(__file__).resolve().parents[1]
A, U, MED, OTHER = ["Compound::DB0000" + str(i) for i in range(1, 5)]
D, S, G, P = "Disease::MESH:D000690", "Disease::MESH:D003680", "Gene::6506", "Biological Process::GO:0015813"
RISK="Gene::1544"
LINK = "https://pubmed.ncbi.nlm.nih.gov/1/"


def fixture():
    g = Graph.__new__(Graph)
    g.names = [A, U, MED, OTHER, D, S, G, P,RISK]
    g.entities = {n:i for i,n in enumerate(g.names)}
    edges = {TREATS[0]: [(u,d) for u in (A,U) for d in (D,S)],
             ASSOCIATION: [(D,G)], TARGET[0]: [(A,G),(U,G)],
             PARTICIPATES: [(G,P)], "GNBR::E+::Compound:Gene":[(A,G)], "GNBR::T::Compound:Disease":[(A,S)],
             "GNBR::N::Compound:Gene":[(A,RISK)], DDI: [(MED,OTHER)]}
    g.relations = {rel:i for i,rel in enumerate(edges)}
    g.types = {rel: tuple(rel.split(":")[-2:]) for rel in edges}
    g.edges = {rel: np.array([(g.entities[h],g.entities[t]) for h,t in pairs]) for rel,pairs in edges.items()}
    g.gloss = {r:{} for r in edges}
    g.triples, g.quarantined = sum(map(len, edges.values())), {}
    g.E = np.array([[5.,0],[0.,0],[2.,0],[4.,0],[1.,0],[1.,0],[1.,0],[2.,0],[1.,0]])
    g.R = np.ones((len(edges),2)); g.R[:,1] = 0
    g.E.flags.writeable = g.R.flags.writeable = False
    terms = Terms()
    for kind,label,node in [("disease","amyotrophic lateral sclerosis",D),("disease","deglutition disorders",S),
                            ("compound","therapy",MED),("gene","SLC1A2",G),("gene","CYP1A2",RISK),
                            ("biological process","L-glutamate transport",P)]:
        terms.add(kind,label,node)
        terms.labels[node] = label
    p = {"case_id":"fixture", "source":LINK, "facts":{"diagnosis":"ALS",
         "current_therapy":"therapy", "swallow":"Coughs on thin liquids"}}
    s = {"applies_with":MED, "policy":"fixture", "source":LINK, "exclude":{},
         "reviewed":{u:{"finding":"narrow review","source":LINK} for u in (U,A)}}
    original = json.loads((ROOT/"examples/als-study-cache.json").read_text(encoding="utf-8"))
    study = dict(original["studies"][0], tested_ingredients=["Form A"], source=LINK, study_id="PMID:1")
    def ingredient(node,name,aliases):
        return dict(id=node,name=name,aliases=aliases,classification="Investigational in ALS")
    cat = {"scope":"fixture", "ingredients":[ingredient(A,"A",["Form A"]), ingredient(U,"U",[])],
           "studies":[study]}
    return g, terms, p, s, cat


class PatientGateTests(unittest.TestCase):
    def test_untested_drug_retrieved_and_can_advance_only_with_support_and_safety(self):
        g, terms, p, safety, cat = fixture()
        clinical = {"reports":[{"applies_to":[A],"role":"favorable","basis":"controlled human intervention",
            "source":LINK,"clinical_question":"ALS function", **{f:"fixture" for f in
            ("design","population","route","primary_endpoint","finding","safety")}}]}
        policy = json.loads((ROOT/"examples/fallback-policy.json").read_text(encoding="utf-8"))
        records = {n:{"action":"reviewed","sources":[[LINK,"fixture"]], "patient_safety_screen":{
                      "status":"pass","finding":"case assessed","sources":[LINK]}} for n in (A,U)}
        chart = {"case":copy.deepcopy(p), "records":records}
        result = run(g,p,safety,100,cat,terms,policy,chart,True,clinical,planner_mode="local")
        self.assertEqual(set(result["eligible_ids"]),{A,U,OTHER})
        self.assertEqual(set(result["trial_gate"]["evidence"]),{A})
        for output in result["agents"].values():
            self.assertTrue(output["queries"])
            self.assertEqual({row["id"] for row in output["retrieval"]},{A,U,OTHER})
            for q in output["queries"]:
                self.assertEqual(set(q["scores"]),{A,U,OTHER})
        # Symptoms only have an observed link to A; remove it for the test of fallback.
        p["facts"]["swallow"]="unknown"
        chart["case"]=copy.deepcopy(p)
        result=run(g,p,safety,100,cat,terms,policy,chart,True,clinical,planner_mode="local")
        self.assertEqual([r["id"] for r in result["advanced"]], [A,U])
        harm = dict(clinical["reports"][0],applies_to=[U],role="harm",finding="controlled harm fixture")
        clinical["reports"].append(harm)
        result=run(g,p,safety,100,cat,terms,policy,chart,True,clinical,planner_mode="local")
        self.assertEqual(result["reassessments"][U]["category"],"excluded for human harm")
        self.assertNotIn(U,[r["id"] for r in result["advanced"]])
        self.assertIn(U,[r["id"] for r in result["agents"][NAMES[0]]["retrieval"]])
        clinical["reports"].pop()
        del records[U]
        result=run(g,p,safety,100,cat,terms,policy,chart,True,clinical,planner_mode="local")
        self.assertNotIn(U,[r["id"] for r in result["advanced"]])

    def test_direct_briefs_preserve_negation_and_isolate_the_case_edit(self):
        _,t,p,s,_=fixture()
        before,_=make_briefs(p,t,s)
        p["facts"]["current_therapy"]="Not taking therapy"
        after,_=make_briefs(p,t,s)
        self.assertEqual([a["criterion"] for a,b in zip(before,after) if a!=b],[NAMES[2]])
        f=next(f for f in after[2]["facts"] if f["field"]=="current_therapy")
        self.assertEqual(f["status"],"negated")
        self.assertEqual(t.medication_parts("not taking therapy"),[("not taking therapy",[])])
        self.assertEqual(t.medication_parts("therapy but not taking second")[0][1],[MED])
        self.assertFalse(any("record" in b for b in before))
    def test_exact_administered_human_ingredient_only(self):
        _,_,_,_,catalog = fixture()
        original = catalog["studies"][0]
        for field,value in [("human_als",False),("interventional",False),("administered",False),
                            ("status","planned"),("status","withdrawn"),("source","https://example.org/news"),
                            ("tested_ingredients",["A different salt"]),("evidence_kind","review")]:
            with self.subTest(field=field, value=value):
                catalog["studies"] = [dict(original, **{field:value})]
                self.assertFalse(trial_gate({A,U},catalog)["evidence"])
        for outcome in ["negative","inconclusive","positive","unreported"]:
            catalog["studies"] = [dict(original, outcome=outcome, tested_ingredients=["FORM-A"])]
            self.assertEqual(set(trial_gate({A,U},catalog)["evidence"]),{A})

    def test_unresolved_comedication_withholds_positive_safety_rank(self):
        from shared.retrieval import apply_safety_review
        g, _, _, review, _ = fixture()
        result={"retrieval":[dict(id=A,l2=1.0)],"ranking":[]}
        apply_safety_review(result,g,[MED],review,unresolved=True)
        self.assertFalse(result["ranking"])
