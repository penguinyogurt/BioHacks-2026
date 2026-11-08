"""Reproduce and contrast the two source records using the pipeline at 8da7881.

Run from any directory. The only new file is reports/alex-audit.json.
"""
import copy
import json
import re
import subprocess
from collections import Counter
from pathlib import Path
from unittest.mock import patch

import numpy as np
import ranking.fallback as ranking
import run as pipeline

from run import ROOT, load_agent, run
from shared.graph import Graph
from shared.query import query
from shared.terms import Terms

REVISION = "8da7881e3b2d12246344c3cc14b036b21f74066d"
VARIANT = "Not taking riluzole 50 mg BID"
RECOGNIZED_NEGATION = "No longer taking riluzole 50 mg BID"
SNAPSHOT = "snapshots/alex-outcomes.json"


def load(path):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def verify_inputs():
    paths = ["run.py", "agents", "shared", "ranking", "examples", SNAPSHOT, "snapshots/alex-gated.json"]
    subprocess.run(["git", "diff", "--exit-code", "--quiet", REVISION, "--", *paths],
                   cwd=ROOT, check=True)


def replay(graph, terms, profile, inputs, reference):
    # Preserve the native eligibility decision. Restrict only the *experiment* at
    # the two consumers of that set, so all five agents and fusion see Alex's 15.
    # All three runs use the same wrappers. For the control both restrictions
    # are identities and all resulting rankings are checked against the snapshot.
    cohort = frozenset(reference["eligible_ids"])
    original_factory, original_select = pipeline.agent, ranking.select

    def restrict(natural):
        if not cohort.issubset(natural):
            raise ValueError("A reference candidate failed the native eligibility screen")
        return cohort

    def cohort_agent(name):
        execute = original_factory(name)

        def execute_on_cohort(g, p, natural, review, vocab):
            return execute(g, p, restrict(natural), review, vocab)
        return execute_on_cohort

    def cohort_select(natural, agents, decisions, policy, k):
        return original_select(restrict(natural), agents, decisions, policy, k)

    with patch.object(pipeline, "agent", cohort_agent), patch.object(ranking, "select", cohort_select):
        result = run(graph, profile, inputs["safety"], reference["aggregation"]["top_k"],
                     inputs["als-study-cache"], terms, inputs["fallback-policy"],
                     inputs["alex-leader-reviews"], True, inputs["clinical-reassessment"], inputs["previous"])
    assert all(agent["pool_size"] == len(cohort) for agent in result["agents"].values())
    return result


def rank_order(agent):
    return [(r["rank"], r["id"]) for r in agent["ranking"]]


def query_id(q):
    return (q["anchor"], tuple((t["relation"], t["forward"]) for t in q["traversals"]))


def vectors(graph, queries, pool):
    """Recreate each emitted query via the production constructor, checking all candidate distances."""
    ids = sorted(pool)
    drug_matrix = graph.E[[graph.entities[n] for n in ids]]
    out = {}
    for item in queries:
        anchor, steps = query_id(item)
        key = (anchor, steps)
        if key in out:
            raise ValueError("Ambiguous repeated query key")
        vector, _, _ = query(graph, anchor, steps, [], {}, keep_empty=True)
        if set(item["scores"]) != set(ids):
            raise ValueError("Distance rows do not match the frozen pool")
        np.testing.assert_array_equal(np.linalg.norm(drug_matrix - vector, axis=1),
                                      [item["scores"][n] for n in ids])
        out[key] = vector
    return out


def compare_agent(name, control, variant, graph):
    pool = control["eligible_ids"]
    a, b = [report["agents"][name] for report in (control, variant)]
    va, vb = [vectors(graph, agent["queries"], pool) for agent in (a, b)]
    keys = sorted(set(va) | set(vb))
    records = []
    for key in keys:
        distance = float(np.linalg.norm(va[key] - vb[key])) if key in va and key in vb else None
        records.append(dict(anchor=key[0], steps=key[1], vector_l2=distance,
                            in_control=key in va, in_variant=key in vb))
    briefs = {}
    module = load_agent(name)
    for report, agent, tag in ((control, a, "control"), (variant, b, "variant")):
        rows = {r["id"]:r for r in agent["ranking"]}
        briefs[tag] = {n:module.evaluate(report, {"id":n}, rows.get(n)) for n in pool}
    return dict(
        facts_control=a["facts"], facts_variant=b["facts"], query_pairs=records,
        facts_equal=a["facts"] == b["facts"], anchors_and_relations_equal=va.keys()==vb.keys(),
        control_ranks=rank_order(a), variant_ranks=rank_order(b),
        ranked_rows_including_witnesses_equal=a["ranking"]==b["ranking"],
        score_maps_equal={query_id(q):q["scores"] for q in a["queries"]} ==
                         {query_id(q):q["scores"] for q in b["queries"]},
        changed_agent_evaluations={n:[briefs["control"][n],briefs["variant"][n]]
                                   for n in pool if briefs["control"][n] != briefs["variant"][n]})


def case_safety(row):
    review = row.get("review")
    if review is None:
        return None
    return {k:review[k] for k in ("action","warning","matched_fact","patient_safety_screen",
                                  "ddi_edges","safety","review_status")}


def study_search_audit(snapshot, clinical):
    studies = clinical["search"]["ingredients"]
    sources, searches = [], []
    for node, row in snapshot["reassessments"].items():
        review = row.get("review", {})
        sources.extend(dict(id=node, **receipt) for receipt in review.get("verification", []))
        searches.extend(dict(id=node, search=label, **receipt) for label, receipt in
                        review.get("literature_searches", {}).items())
    return dict(ingredient_searches=studies, reviewed_reports=len(clinical["reports"]),
                reviewed_reports_for_dossier_ids=len({r["source"] for d in snapshot["reassessments"].values()
                                                       for r in d["studies"]}),
                historical_source_refreshes=sources, historical_supplementary_searches=searches)


def pool_audit(graph, control, inputs):
    canonical = {n for n in graph.entities if re.fullmatch(r"Compound::DB\d{5}", n)}
    excluded = set(control["pool"]["exclusions"])
    post_screen = canonical - excluded
    dossier_ids = set(control["trial_gate"]["evidence"])
    assert canonical >= dossier_ids and excluded <= canonical
    assert dossier_ids - excluded - control["established"].keys() == set(control["eligible_ids"])
    return dict(canonical=len(canonical), historical_screen_exclusions=control["pool"]["exclusions"],
                post_screen=len(post_screen), dossiers=len(dossier_ids),
                post_screen_with_dossier=sorted(post_screen & dossier_ids),
                dossier_ids_outside_post_screen=sorted(dossier_ids - post_screen),
                unknown_in_post_screen=len(post_screen - dossier_ids),
                unknown_in_canonical=len(canonical - dossier_ids),
                qualifying_pool=control["eligible_ids"],
                curated_ingredients=len(inputs["als-study-cache"]["ingredients"]),
                administration_records=len(inputs["als-study-cache"]["studies"]),
                withheld=control["trial_gate"]["withheld"],
                other_dossiers=sorted(dossier_ids-set(control["eligible_ids"])))


def main():
    verify_inputs()
    snapshot = load(SNAPSHOT)
    inputs = {key:load("examples/" + key + ".json") for key in
              ("safety","als-study-cache","fallback-policy","alex-leader-reviews","clinical-reassessment")}
    inputs["previous"] = load("snapshots/alex-gated.json")
    alex = load("examples/alex.json")
    assert alex == snapshot["case"]
    synthetic = copy.deepcopy(alex)
    synthetic["facts"]["current_therapy"] = VARIANT
    graph = Graph(ROOT / "data")
    terms = Terms.load(ROOT / "data", graph, inputs["als-study-cache"], offline=True)
    control = replay(graph, terms, alex, inputs, snapshot)
    variant = replay(graph, terms, synthetic, inputs, snapshot)
    absent_profile = copy.deepcopy(alex)
    absent_profile["facts"]["current_therapy"] = RECOGNIZED_NEGATION
    absent = replay(graph, terms, absent_profile, inputs, snapshot)
    assert variant["eligible_ids"] == control["eligible_ids"]
    assert all(not ids for _, ids in terms.medication_parts(RECOGNIZED_NEGATION))

    # Replays deliberately skip the historical network calls. Compare their decisions,
    # agent evidence and vectors rather than equating offline receipts with successful lookups.
    for key in ("eligible_ids","trial_gate","pool","agents","aggregation","fallback","advanced","graph_overlap"):
        assert control[key] == snapshot[key], f"Control differs from snapshot: {key}"
    cases = {}
    for node in control["reassessments"]:
        original, a, b = [report["reassessments"][node] for report in (snapshot, control, variant)]
        assert a["disposition"] == original["disposition"] and a.get("graph") == original.get("graph")
        assert case_safety(a) == case_safety(original)
        cases[node] = dict(name=control["ingredient_names"][node], category=a["category"],
                           clinical_category_equal=a["category"]==b["category"],
                           control_disposition=a["disposition"],variant_disposition=b["disposition"],
                           control_case_review=case_safety(a), variant_case_review=case_safety(b),
                           control_score=a.get("graph",{}).get("internal_ranking_score"),
                           variant_score=b.get("graph",{}).get("internal_ranking_score"),
                           decisive=a["decisive"])
    agents = {n:compare_agent(n,control,variant,graph) for n in control["agents"]}
    absent_agents = {n:compare_agent(n,control,absent,graph) for n in control["agents"]}
    for n in control["eligible_ids"]:
        rec = absent["reassessments"][n]
        cases[n].update(absent_disposition=rec["disposition"], absent_score=rec["graph"]["internal_ranking_score"],
                        absent_case_review=case_safety(rec), absent_category=rec["category"])
    ordering = {}
    for category in sorted({cases[n]["category"] for n in control["eligible_ids"]}):
        ids = [n for n in control["eligible_ids"] if cases[n]["category"]==category]
        ordering[category] = {k:sorted(ids,key=lambda n:(-cases[n][k], n))
                              for k in ("control_score", "variant_score", "absent_score")}
    audit = dict(revision=REVISION, snapshot=SNAPSHOT, offline=True,
                 edit={"field":"facts.current_therapy","control":alex["facts"]["current_therapy"],
                       "variant":VARIANT,"synthetic_value_is_a_test_override":True},
                 pool=pool_audit(graph,control,inputs),
                 historic_search=study_search_audit(snapshot,inputs["clinical-reassessment"]),
                 agents=agents, decisions=cases, within_category_orders=ordering,
                 recognized_negation=dict(value=RECOGNIZED_NEGATION, agents=absent_agents,
                     native_eligible_ids=absent["eligible_ids"], scored_cohort=control["eligible_ids"],
                     native_exclusions=absent["pool"]["exclusions"], native_therapy_parse=terms.medication_parts(RECOGNIZED_NEGATION),
                     cleared=absent["aggregation"]["cleared_count"], advanced=absent["advanced"],
                     prior_comparison_rows=len(absent["previous_finalists"])),
                 case_exclusions_equal=control["pool"]["exclusions"]==variant["pool"]["exclusions"],
                 prior_comparison_rows=[len(r["previous_finalists"]) for r in (control,variant)],
                 cleared=[r["aggregation"]["cleared_count"] for r in (control,variant)],
                 advanced=[r["advanced"] for r in (control,variant)])
    out = ROOT / "reports/alex-audit.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(audit, indent=2, allow_nan=False)+"\n",encoding="utf-8")
    print("Matched snapshot control. Fixed pool:",len(control["eligible_ids"]))
    for name, result in agents.items():
        print(name,len(result["query_pairs"]),"query pairs; max L2",
              max((q["vector_l2"] for q in result["query_pairs"] if q["vector_l2"] is not None),default=None),
              "identical ranked rows",result["ranked_rows_including_witnesses_equal"])
    print("Dispositions:",dict(Counter(cases[n]["control_disposition"] for n in control["eligible_ids"])))
    for name, result in absent_agents.items():
        dropped = sum(not q["in_variant"] for q in result["query_pairs"])
        print("Recognized negation:",name,"removed",dropped,"queries; supported ranks",len(result["variant_ranks"]))
    print("Audit:",out)


if __name__ == "__main__":
    main()
