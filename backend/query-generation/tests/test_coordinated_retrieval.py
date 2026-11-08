import copy
import unittest
import numpy as np

from ranking.intersection import NAMES
from shared.retrieval import retrieve, apply_safety_review
from shared.briefs import make_briefs
from test_patient_gate import fixture, A, U, MED, RISK


class HandoffAndRetrieval(unittest.TestCase):
    def test_risk_orientation_all_compounds_and_unwitnessed_candidate(self):
        g, terms, profile, safety, _ = fixture()
        brief = make_briefs(profile,terms,safety)[0][2]
        spec = {"fact":"current_therapy","concept":"cyp1a2_exposure","proposals":[
                {"goal":"flag inhibition","anchor":"CYP1A2","kind":"gene","action":"inhibit","requires":["study"]}]}
        claim = [{"id":"study","finding":"Inhibition raises exposure","url":"https://example.org/research"}]
        unchanged=g.E.copy()
        r=retrieve(g,terms,{A,U},brief,spec,claim,1)
        self.assertEqual(r["rank_type"],"concern")
        self.assertEqual([x["id"] for x in r["top_k"]],[U])
        self.assertFalse(r["top_k"][0]["support"])
        self.assertEqual(r["top_k"][0]["l2"],0.0)
        self.assertEqual(set(r["queries"][0]["scores"]),{A,U})
        np.testing.assert_array_equal(g.E,unchanged)
        apply_safety_review(r,g,[MED],safety,False)
        self.assertEqual(r["ranking"][0]["id"],A)  # Independently reviewed, farther from risk.
        self.assertEqual(r["retrieval"][0]["id"],U)

    def test_missing_source_or_unsupported_term_abstains(self):
        g, terms, p, review, _=fixture()
        brief=make_briefs(p,terms,review)[0][0]
        spec={"fact":"diagnosis","concept":"als","proposals":[dict(anchor="Amyotrophic Lateral Sclerosis",
              kind="disease",goal="test",action="treat",requires=["trial"])]}
        r=retrieve(g,terms,{U},brief,spec,[],4)
        self.assertFalse(r["retrieval"]); self.assertTrue(r["unmapped"])
        spec["proposals"][0]["anchor"]="Unknown disorder, similar to amyotrophic lateral sclerosis"
        r=retrieve(g,terms,{U},brief,spec,[dict(id="trial",url="https://example.org/trial")],4)
        self.assertFalse(r["queries"])

    def test_signed_forward_query_and_duplicate_evidence_do_not_double_count(self):
        g,t,p,s,_=fixture()
        rel="DGIDB::INHIBITOR::Gene:Compound"
        g.types[rel]=("Gene","Compound"); g.relations[rel]=0;g.gloss[rel]={}
        g.edges[rel]=np.asarray([[g.entities[RISK],g.entities[A]]])
        b=make_briefs(p,t,s)[0][2]
        proposal=dict(anchor="CYP1A2",kind="gene",goal="interaction",action="inhibit",requires=["x"])
        spec=dict(fact="current_therapy",concept="cyp1a2_exposure",proposals=[proposal,copy.deepcopy(proposal)])
        result=retrieve(g,t,{A,U},b,spec,[dict(id="x",url="https://example.org/x")],5)
        self.assertEqual(len(result["queries"]),2)  # two different predicates; duplicate proposal folded
        forward=next(q for q in result["queries"] if q["traversals"][0]["forward"])
        point=g.E[g.entities[RISK]]+g.R[0]
        self.assertEqual(forward["scores"][U],np.linalg.norm(g.E[g.entities[U]]-point))

    def test_medication_edit_retains_only_reviewed_independent_cautions(self):
        from shared.leader_review import applicable_records
        _,_,p,_,_=fixture()
        catalog={"case":copy.deepcopy(p),"records":{
            A:{"fact":"swallow","action":"caution","warning_scope":"documented chart finding independent of current therapy",
               "patient_safety_screen":{"status":"pass"}},
            U:{"fact":"current_therapy","action":"reviewed","patient_safety_screen":{"status":"pass"}}}}
        p["facts"]["current_therapy"]="not taking therapy"
        relevant=applicable_records(p,catalog)
        self.assertEqual(set(relevant),{A})
        self.assertFalse(relevant[A]["patient_safety_screen"])
        p["facts"]["swallow"]="not reported"
        self.assertFalse(applicable_records(p,catalog))
