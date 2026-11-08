import unittest
from types import SimpleNamespace

from ranking.fallback import fallback
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


def decision(action="unknown"):
    row = {"action": action, "safety": "safety unresolved", "warning": "", "sources": []}
    if action in ("veto", "caution"):
        row.update(warning="fixture interaction warning", sources=[SOURCE], matched_fact="fixture medication")
    return row


class FallbackTests(unittest.TestCase):
    def setUp(self):
        self.policy = {"weights": dict.fromkeys(NAMES, 1), "rank_offset": 10,
                       "coverage_exponent": 0, "soft_concern_penalty": 0.04}

    def test_veto_overrules_every_category_and_backfills(self):
        nodes = list("ABCDEFG")
        lists = [(n, i) for i, n in enumerate(nodes, 1)]
        rankings = agents(**{name: lists for name in NAMES})
        result = fallback(nodes, rankings, self.policy, lambda n: decision("veto" if n == "A" else "unknown"))
        self.assertEqual([row["id"] for row in result["final"]], list("BCDEF"))
        self.assertEqual(result["new_vetoes"]["A"]["matched_fact"], "fixture medication")
        self.assertEqual(result["dropped"], ["A"])
        self.assertEqual(result["backfilled"], ["F"])
        self.assertNotIn("G", [x["id"] for x in result["reviews"]])

    def test_documented_soft_concern_remains_with_warning(self):
        result = fallback(["A"], agents(**{DISEASE: [("A", 1)]}), self.policy, lambda _: decision("caution"))
        row = result["final"][0]
        self.assertAlmostEqual(row["score"], 0.16)
        self.assertEqual(row["review"]["warning"], "fixture interaction warning")
        self.assertFalse(result["new_vetoes"])

    def test_penalized_fifth_replaced_by_unpenalized_sixth(self):
        nodes = list("ABCDEF")
        result = fallback(nodes, agents(**{DISEASE: list(zip(nodes, range(1, 7)))}),
                          self.policy, lambda n: decision("caution" if n == "E" else "unknown"))
        self.assertEqual(result["dropped"], ["E"])
        self.assertEqual(result["backfilled"], ["F"])
        self.assertFalse(result["new_vetoes"])

    def test_outside_top_100_is_supported_and_unknown_safety_earns_zero(self):
        result = fallback(["A"], agents(**{PATHWAYS: [("A", 101)]}), self.policy, lambda _: decision())
        row = result["final"][0]
        self.assertEqual(row["ranks"], {PATHWAYS: 101})
        self.assertEqual(row["contributions"][SAFETY], 0)
        self.assertEqual(row["review"]["safety"], "safety unresolved")
        self.assertAlmostEqual(row["score"], 0.2 * 11 / 111)
        self.assertAlmostEqual(row["coverage"], 0.2)
        self.policy["coverage_exponent"] = 1
        downweighted = fallback(["A"], agents(**{PATHWAYS: [("A", 101)]}), self.policy, lambda _: decision())
        self.assertAlmostEqual(downweighted["final"][0]["score"], 0.2 * row["score"])

    def test_cutoff_ties_use_id_independent_of_iteration_order(self):
        # Explicit equal evidence scores on either side of the fifth-place cut.
        rankings = agents(**{DISEASE: [(n, i) for i, n in enumerate("ABCDZ", 1)],
                             GENES: [(n, i) for i, n in enumerate("ABCDY", 1)]})
        for order in ("ABCDZY", "YZDCBA"):
            result = fallback(order, rankings, self.policy, lambda _: decision())
            self.assertEqual([r["id"] for r in result["final"]], list("ABCDY"))
            self.assertEqual(len(result["reviews"]), 6)

    def test_fewer_than_five_without_filling_from_unsourced_or_excluded_ids(self):
        rankings = agents(**{SYMPTOMS: [("S", 1)], SAFETY: [("X", 1)], GENES: [("U", 1)],
                             DISEASE: [("E", 1), ("A", 2)]})
        rankings[GENES]["queries"][0]["evidence"] = ["no attributable source"]
        result = fallback("ASXUE", rankings, self.policy, lambda _: decision(), excluded={"E"})
        self.assertEqual([row["id"] for row in result["final"]], ["A"])
        self.assertEqual(set(result["ineligible"]), set("SXUE"))
        self.assertEqual(result["evaluated"], 5)
        self.assertEqual(result["provisional_count"], 1)

    def test_veto_requires_source_and_matched_case_fact(self):
        for missing in ("warning", "matched_fact", "sources"):
            invalid = decision("veto")
            invalid.pop(missing)
            with self.assertRaises(ValueError):
                fallback(["A"], agents(**{GENES: [("A", 1)]}), self.policy, lambda _: invalid)

    def test_graph_only_medication_alert_does_not_assign_safety_or_veto(self):
        profile = {"therapy": "M", "facts": {"current_therapy": "example medicine"}}
        graph = SimpleNamespace(walk=lambda t, r, outgoing: ["C"] if outgoing else [])
        review = reviewer(profile, {"case": {}, "records": {}}, True, graph)("C")
        self.assertEqual(review["action"], "unknown")
        self.assertEqual(review["safety"], "safety unresolved")
        self.assertEqual(review["ddi_edges"][0][0::2], ["M", "C"])
        self.assertIn("unreviewed", review["review_status"])
