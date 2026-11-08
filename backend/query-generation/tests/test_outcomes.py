import copy
import json
import unittest
from pathlib import Path

from shared.outcomes import assess, ADVANCE_CATEGORIES, HARM, NEGATIVE, UNRESOLVED

ROOT = Path(__file__).resolve().parents[1]
ID = "Compound::test"
PMID = "https://pubmed.ncbi.nlm.nih.gov/1/"


def study(role="negative", number=1):
    return dict(applies_to=[ID], role=role, source=f"https://pubmed.ncbi.nlm.nih.gov/{number}/",
                design="randomized", population="ALS", route="oral", primary_endpoint="function",
                finding="fixture result", safety="fixture observation", clinical_question="function",
                basis="controlled human intervention")


def decide(studies, delivery=None, administered=None):
    return assess(ID, administered or [{"source":PMID}],
                  {"reports":studies, "delivery":{ID:delivery or {}}})


class EvidenceTests(unittest.TestCase):
    def test_minocycline_harm_supersedes_earlier_tolerability_and_high_score(self):
        clinical = json.loads((ROOT/"examples/clinical-reassessment.json").read_text(encoding="utf-8"))
        old = json.loads((ROOT/"snapshots/alex-gated.json").read_text(encoding="utf-8"))
        row = old["fallback"]["final"][1]
        self.assertEqual(row["id"], "Compound::DB01017")
        self.assertGreater(row["score"], 0.5)
        result = assess(row["id"],old["trial_gate"]["evidence"][row["id"]],clinical)
        self.assertEqual(result["category"],HARM)
        self.assertIn("17980667", result["decisive"][0]["source"])

    def test_unreviewed_or_conflicting_controlled_primary_outcomes_hold(self):
        self.assertEqual(decide([study("favorable")],administered=[{"source":"other trial"}])["category"],UNRESOLVED)
        result = decide([study("favorable"),study("negative",2)])
        self.assertEqual(result["category"],UNRESOLVED)
        self.assertEqual(result["conflicting_endpoints"],["function"])
        self.assertEqual(len(result["decisive"]),2)

    def test_biomarkers_subgroups_and_observations_cannot_promote(self):
        for role in ["safety","biomarker","exploratory","observational","unreported","combination"]:
            self.assertEqual(decide([study(role)])["category"],UNRESOLVED)
            self.assertEqual(decide([study("negative"),study(role,2)])["category"],NEGATIVE)
        self.assertEqual(decide([study("favorable")])["category"],ADVANCE_CATEGORIES[0])

    def test_negative_requires_both_independent_cited_drug_specific_links(self):
        good = dict(exposure=dict(ingredient=ID,supported=True,site="cortex",failed_trial=PMID,
                                  sources=["https://example.org/pk"],finding="Measured inadequate exposure"),
                    delivery_change=dict(ingredient=ID,supported=True,site="cortex", drug_specific=True,
                                         method="focused ultrasound with microbubbles",
                                         sources=["https://example.org/fus"],finding="Delivery restored exposure"))
        self.assertEqual(decide([study()],good)["category"],ADVANCE_CATEGORIES[1])
        for part, key, value in [("exposure","supported",False),("exposure","sources",[PMID]),
                                 ("exposure","failed_trial","another trial"),("delivery_change","drug_specific",False),
                                 ("delivery_change","ingredient","another drug"),("delivery_change","site","liver"),
                                 ("delivery_change","sources",[]),
                                 ("delivery_change","sources",["https://pubmed.ncbi.nlm.nih.gov/31558719/"]),("delivery_change","method","systemic dose")]:
            with self.subTest(key=key):
                incomplete=copy.deepcopy(good)
                incomplete[part][key]=value
                self.assertEqual(decide([study()],incomplete)["category"],NEGATIVE)
        self.assertEqual(decide([study("harm"),study("favorable",2)],good)["category"],HARM)

    def test_decisive_role_cannot_use_animal_or_observational_basis(self):
        invalid = dict(study("favorable"),basis="ALS mouse model")
        with self.assertRaises(ValueError):
            decide([invalid])

    def test_real_minocycline_review_blocks_both_paths_even_with_perfect_agent_ranks(self):
        from ranking.fallback import select
        from ranking.intersection import NAMES
        root = ROOT / "examples"
        node = "Compound::DB01017"
        clinical = json.loads((root/"clinical-reassessment.json").read_text(encoding="utf-8"))
        catalog = json.loads((root/"als-study-cache.json").read_text(encoding="utf-8"))
        decision = assess(node,[s for s in catalog["studies"] if "Minocycline" in s["tested_ingredients"]],clinical)
        policy = json.loads((root/"fallback-policy.json").read_text(encoding="utf-8"))
        decision["review"] = {"action":"reviewed","patient_safety_screen":
                              {"status":"pass","sources":[PMID],"finding":"fixture screen"}}
        for drop_agent in (False, True):
            agents = {n:{"queries":[{"evidence":[PMID]}], "ranking":[{"id":node,"query":0,
                     "support":["fixture"],"rank":1}]} for n in NAMES}
            if drop_agent:
                agents[NAMES[-1]]["ranking"] = []
            strict, fallback, final = select({node}, agents, {node:decision}, policy,100)
            self.assertFalse(strict["final"])
            self.assertFalse(fallback["final"])
            self.assertFalse(final)
            self.assertEqual(decision["disposition"], HARM)
