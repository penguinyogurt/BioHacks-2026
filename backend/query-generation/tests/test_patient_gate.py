import copy
import json
import unittest
from pathlib import Path

import numpy as np

from ranking.intersection import NAMES, aggregate
from run import agent, run
from shared.biology import ASSOCIATION, PARTICIPATES, TARGET, TREATS
from shared.graph import Graph
from shared.patient_query import DDI
from shared.terms import Terms
from shared.trial_gate import trial_gate

ROOT = Path(__file__).resolve().parents[1]
A, U, MED, OTHER = ["Compound::DB0000" + str(i) for i in range(1, 5)]
D, S, G, P = "Disease::D", "Disease::S", "Gene::G", "Biological Process::P"
LINK = "https://pubmed.ncbi.nlm.nih.gov/1/"


def fixture():
    g = Graph.__new__(Graph)
    g.names = [A, U, MED, OTHER, D, S, G, P]
    g.entities = {n:i for i,n in enumerate(g.names)}
    edges = {TREATS[0]: [(u,d) for u in (A,U) for d in (D,S)],
             ASSOCIATION: [(D,G)], TARGET[0]: [(A,G),(U,G)],
             PARTICIPATES: [(G,P)], DDI: [(MED,OTHER)]}
    g.relations = {rel:i for i,rel in enumerate(edges)}
    g.types = {rel: tuple(rel.split(":")[-2:]) for rel in edges}
    g.edges = {rel: np.array([(g.entities[h],g.entities[t]) for h,t in pairs]) for rel,pairs in edges.items()}
    g.gloss = {r:{} for r in edges}
    g.triples, g.quarantined = sum(map(len, edges.values())), {}
    g.E = np.array([[5.,0],[0.,0],[2.,0],[4.,0],[1.,0],[1.,0],[1.,0],[2.,0]])
    g.R = np.ones((len(edges),2)); g.R[:,1] = 0
    g.E.flags.writeable = g.R.flags.writeable = False
    terms = Terms()
    for kind,label,node in [("disease","first disease",D),("disease","swallowing disorder",S),
                            ("compound","therapy",MED),("gene","ABC1",G)]:
        terms.add(kind,label,node)
        terms.labels[node] = label
    p = {"case_id":"fixture", "source":LINK, "facts":{"diagnosis":"First disease",
         "current_therapy":"therapy", "swallow":"swallowing disorder"}}
    s = {"applies_with":MED, "policy":"fixture", "source":LINK, "exclude":{},
         "reviewed":{u:{"finding":"narrow review","source":LINK} for u in (U,A)}}
    original = json.loads((ROOT/"examples/als-study-cache.json").read_text())
    study = dict(original["studies"][0], tested_ingredients=["Form A"], source=LINK, study_id="PMID:1")
    def ingredient(node,name,aliases):
        return dict(id=node,name=name,aliases=aliases,classification="Investigational in ALS")
    cat = {"scope":"fixture", "ingredients":[ingredient(A,"A",["Form A"]), ingredient(U,"U",[])],
           "studies":[study]}
    return g, terms, p, s, cat


class PatientGateTests(unittest.TestCase):
    def test_perfect_untested_drug_never_scored_by_any_agent(self):
        g, terms, p, safety, cat = fixture()
        for name in NAMES:
            ungated = agent(name)(g,p,frozenset([A,U]),safety,terms)
            self.assertIn(U, [r["id"] for r in ungated["ranking"]])
            if name != NAMES[2]:
                self.assertEqual(ungated["ranking"][0]["id"], U)
                self.assertEqual(ungated["ranking"][0]["l2"], 0)
        policy = json.loads((ROOT/"examples/fallback-policy.json").read_text())
        def run_fixture():
            clinical = {"reports":[{"applies_to":[A], "role":"favorable","basis":"controlled human intervention",
                "source":LINK,"clinical_question":"ALS function", **{f:"fixture" for f in
                ("design","population","route","primary_endpoint","finding","safety")}}]}
            safety_records = {"case":copy.deepcopy(p), "records":{A:{"name":"A","action":"reviewed",
                "sources":[[LINK,"fixture"]], "patient_safety_screen":{"status":"pass",
                "finding":"fixture clinical review","sources":[LINK]}}}}
            return run(g,p,safety,100,cat,terms,policy,safety_records,True,clinical)
        r = run_fixture()
        self.assertEqual(r["trial_gate"]["before"],4)
        self.assertEqual(r["eligible_ids"],[A])
        self.assertEqual(r["aggregation"]["final"][0]["id"],A)
        self.assertIsNone(r["fallback"])
        for output in r["agents"].values():
            self.assertEqual([row["id"] for row in output["ranking"]],[A])
            for q in output["queries"]:
                self.assertEqual(set(q["scores"]),{A})
        p["facts"]["swallow"]="unmapped observation"
        r = run_fixture()
        self.assertEqual(r["fallback"]["evaluated"],1)
        self.assertEqual([row["id"] for row in r["fallback"]["final"]],[A])
        with self.assertRaisesRegex(ValueError, "ineligible"):
            aggregate({n:[U] for n in NAMES},100,{A})

    def test_fact_changes_affect_all_relevant_agents(self):
        g,t,p,s,_ = fixture()
        for name,field in zip(NAMES,["diagnosis","diagnosis","current_therapy","diagnosis","swallow"]):
            original = agent(name)(g,p,{A},s,t)
            self.assertTrue(original["queries"])
            modified = copy.deepcopy(p)
            modified["facts"][field] = "unknown"
            output = agent(name)(g,modified,{A},s,t)
            self.assertFalse(output["queries"])
            fact = next(f for f in output["facts"] if f["field"] == field)
            self.assertEqual((fact["quote"],fact["mapping"]),("unknown","no graph mapping"))
            self.assertEqual(fact["source"],LINK)
        p["facts"]["diagnosis"]="swallowing disorder"
        self.assertEqual(agent(NAMES[0])(g,p,{A},s,t)["queries"][0]["anchor"],S)

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
        g, terms, profile, review, _ = fixture()
        profile["facts"]["current_therapy"] = "therapy and unnamed investigational product"
        output = agent(NAMES[2])(g, profile, {A}, review, terms)
        self.assertTrue(output["queries"])
        self.assertFalse(output["ranking"])
        self.assertEqual(output["facts"][0]["unresolved_medications"], ["unnamed investigational product"])
