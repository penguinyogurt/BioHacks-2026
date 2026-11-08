import unittest
from types import SimpleNamespace

from ranking.fallback import select
from shared.outcomes import ADVANCE_CATEGORIES, HARM, NEGATIVE, UNRESOLVED
from ranking.intersection import NAMES
from shared.leader_review import reviewer


DISEASE, GENES, SAFETY, PATHWAYS, SYMPTOMS = NAMES
SOURCE = "https://example.org/fixture"


def agents(**categories):
    result = {}
    for name in NAMES:
        rows = [
            {"id": node, "rank": rank, "query": 0, "support": [[node, "relation", "anchor"]]}
            for node, rank in categories.get(name, [])
        ]
        result[name] = {"ranking": rows, "queries": [{"evidence": [SOURCE]}]}
    return result


def decision(action="reviewed", category=ADVANCE_CATEGORIES[0]):
    row = {"action": action, "safety": "safety unresolved", "warning": "", "sources": []}
    if action in ("veto", "caution"):
        row.update(warning="fixture interaction warning", sources=[SOURCE], matched_fact="fixture medication")
    row["patient_safety_screen"] = {"status":"pass","finding":"fixture chart reviewed","sources":[SOURCE]}
    return {"category":category,"review":row}


class FallbackTests(unittest.TestCase):
    def setUp(self):
        self.policy = {"weights": dict.fromkeys(NAMES, 1), "rank_offset": 10,
                       "coverage_exponent": 0, "soft_concern_penalty": 0.04}

    def test_veto_backfills_even_a_strict_intersection(self):
        ids = list("ABCDEFG")
        ranks = [(n,i) for i,n in enumerate(ids,1)]
        judgments = {n:decision() for n in ids}
        judgments["A"] = decision("veto")
        strict, fb, rows = select(ids, agents(**{n:ranks for n in NAMES}), judgments, self.policy, 100)
        self.assertIsNone(fb)
        self.assertEqual([r["id"] for r in rows], list("BCDEF"))
        self.assertEqual(strict["final"], rows)
        self.assertEqual(judgments["A"]["disposition"], "excluded by case safety screen")

    def test_clinical_precedence_on_strict_and_fallback(self):
        ids = list("ABCDEFG")
        rank = [(n,i) for i,n in enumerate(ids,1)]
        for active in (NAMES, [DISEASE]):
            judgments = {n:decision() for n in ids}
            for n, category in zip("ABCF",(HARM, NEGATIVE, UNRESOLVED, ADVANCE_CATEGORIES[1])):
                judgments[n] = decision(category=category)
            judgments["D"] = decision("unknown")
            strict, fb, final = select(ids, agents(**{n:rank for n in active}),judgments,self.policy,100)
            self.assertEqual([r["id"] for r in final],list("EGF"))
            self.assertEqual(fb is not None, len(active) == 1)
            self.assertEqual(judgments["D"]["disposition"],"unresolved patient safety")
            self.assertGreater(judgments["A"]["graph"]["internal_ranking_score"],final[0]["internal_ranking_score"])

    def test_category_precedes_even_the_strict_top_k_cut(self):
        ranked = agents(**{n:[("D",1),("F",2)] for n in NAMES})
        judgments = {"D":decision(category=ADVANCE_CATEGORIES[1]), "F":decision()}
        strict, fallback, rows = select("DF",ranked,judgments,self.policy,1)
        self.assertIsNone(fallback)
        self.assertEqual([row["id"] for row in strict["final"]], ["F"])

    def test_soft_conflict_needs_documented_clearance(self):
        j = {n:decision("caution") for n in "AB"}
        j["B"]["review"]["patient_safety_screen"] = {}
        _, fb, rows = select("AB",agents(**{DISEASE:[("A",1),("B",2)]}),j,self.policy,100)
        self.assertEqual([r["id"] for r in rows],["A"])
        self.assertAlmostEqual(rows[0]["internal_ranking_score"],0.16)
        self.assertTrue(j["A"]["review"]["warning"])

    def test_outside_top_100_and_configurable_coverage(self):
        for power, expected in [(0,0.2*11/111),(1,0.04*11/111)]:
            self.policy["coverage_exponent"] = power
            j = {"A":decision()}
            _,_,rows = select("A",agents(**{PATHWAYS:[("A",101)]}),j,self.policy,100)
            self.assertAlmostEqual(rows[0]["internal_ranking_score"],expected)
            self.assertIn(SAFETY,rows[0]["missing"])
            self.assertEqual(rows[0]["contributions"][SAFETY],0)

    def test_ties_unsourced_support_and_fewer_than_five(self):
        rankings = agents(**{DISEASE:[("B",1)],GENES:[("A",1)],PATHWAYS:[("U",1)],SAFETY:[("S",1)]})
        rankings[PATHWAYS]["queries"][0]["evidence"] = []
        for order in ("ABUS","SUBA"):
            _,_,rows = select(order,rankings,{n:decision() for n in order},self.policy,100)
            self.assertEqual([r["id"] for r in rows],list("ABSU"))
            self.assertEqual(rows[-1]["internal_ranking_score"],0)
            self.assertCountEqual(rows[-1]["missing"],NAMES)

    def test_case_veto_requires_source_fact_and_reason(self):
        for missing in ("warning","matched_fact","sources"):
            j = {"A":decision("veto")}
            del j["A"]["review"][missing]
            with self.assertRaises(ValueError):
                select("A",agents(**{GENES:[("A",1)]}),j,self.policy,100)

    def test_graph_only_medication_alert_does_not_assign_safety_or_veto(self):
        profile = {"therapy": "M", "facts": {"current_therapy": "example medicine"}}
        graph = SimpleNamespace(walk=lambda t, r, outgoing: ["C"] if outgoing else [])
        review = reviewer(profile, {"case": {}, "records": {}}, True, graph)("C")
        self.assertEqual(review["action"], "unknown")
        self.assertEqual(review["safety"], "safety unresolved")
        self.assertEqual(review["ddi_edges"][0][0::2], ["M", "C"])
        self.assertIn("unreviewed", review["review_status"])
