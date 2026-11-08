"""Order clinically cleared ingredients within evidence categories on either selection path."""
from math import isfinite

from ranking.intersection import NAMES

RATIONALE = (NAMES[0], NAMES[1], NAMES[3])
LIMIT = 5


def supported_ranks(agent):
    """An observed path or safety review must have an attributable query."""
    ranks = {}
    for row in agent["ranking"]:
        query = agent["queries"][row["query"]]
        sources = [s for s in query["evidence"] if isinstance(s, str) and s.startswith("https://")]
        if row["support"] and sources:
            ranks[row["id"]] = row["rank"]
    return ranks


def fusion_scores(pool, agents, policy):
    weights = policy["weights"]
    offset = policy["rank_offset"]
    exponent = policy["coverage_exponent"]
    penalty = policy["soft_concern_penalty"]
    parameters = (*weights.values(), offset, exponent, penalty)
    if (set(weights) != set(NAMES) or not all(isfinite(x) and x >= 0 for x in parameters)
            or sum(weights.values()) == 0):
        raise ValueError("Invalid fusion policy")
    shares = {name: weights[name] / sum(weights.values()) for name in NAMES}
    indexes = {name: supported_ranks(agents[name]) for name in NAMES}

    scores = {}
    for node in sorted(pool):
        ranks = {name:index[node] for name, index in indexes.items() if node in index}
        coverage = sum(shares[name] for name in ranks)
        credits = {name:0.0 for name in NAMES}
        for name, rank in ranks.items():
            credits[name] = shares[name] * (offset + 1) / (offset + rank) * coverage**exponent
        scores[node] = dict(id=node, ranks=ranks, weights=shares, coverage=coverage,
                            contributions=credits, base=sum(credits.values()),
                            missing=[n for n in NAMES if n not in ranks],
                            rationale=any(n in ranks for n in RATIONALE))
    return scores


def select(pool, agents, decisions, policy, k):
    """Use a single set of evidence-cleared IDs for both selection paths."""
    from ranking.intersection import aggregate
    from shared.outcomes import ADVANCE_CATEGORIES, clearance
    scores = fusion_scores(pool, agents, policy)
    for node, row in scores.items():
        review = decisions[node].get("review", {})
        if review.get("action") in ("veto", "caution"):
            if not all(review.get(key) for key in ("matched_fact", "sources", "warning")):
                raise ValueError("A concern requires a matched case fact, source and finding")
        row["penalty"] = policy["soft_concern_penalty"] if review.get("action") == "caution" else 0.0
        row["internal_ranking_score"] = row["base"] - row["penalty"]

    cleared = {node for node in pool if decisions[node]["category"] in ADVANCE_CATEGORIES
               and (decisions[node]["category"] != ADVANCE_CATEGORIES[2] or scores[node]["rationale"])
               and not decisions[node].get("case_exclusion") and clearance(decisions[node].get("review", {}))}
    lists = {n:[row["id"] for row in agents[n]["ranking"] if row["id"] in cleared] for n in NAMES}
    # A lower clinical category cannot occupy a higher category's top-K slot.
    # Stable sorting preserves each agent's order within a clinical category.
    for ids in lists.values():
        ids.sort(key=lambda node: ADVANCE_CATEGORIES.index(decisions[node]["category"]))
    strict = aggregate(lists, k, cleared)
    strict["cleared_count"] = len(cleared)
    if not cleared:
        strict["blocking_reason"] = "No investigational ingredient cleared both the human outcomes and case safety rules."
    strict_ids = {r["id"] for r in strict["final"]}
    used_fallback = not strict_ids
    candidates = (cleared if used_fallback else strict_ids)
    # A verified clinical or delivery rationale can qualify without a graph witness.
    # Missing agent support lowers credit within the tier, never the clinical disposition.
    candidates = list(candidates)
    candidates.sort(key=lambda n:(ADVANCE_CATEGORIES.index(decisions[n]["category"]),
                                  -scores[n]["internal_ranking_score"], n))
    chosen = candidates[:LIMIT]
    final = [dict(scores[node], final_rank=pos, category=decisions[node]["category"])
             for pos, node in enumerate(chosen, 1)]
    strict["final"] = [] if used_fallback else final
    fallback = dict(evaluated=len(pool), cleared=len(cleared), final=final) if used_fallback else None
    for node in pool:
        item = decisions[node]
        item["graph"] = scores[node]
        if item.get("case_exclusion") or item.get("review", {}).get("action") == "veto":
            item["disposition"] = "excluded by case safety screen"
        elif item["category"] not in ADVANCE_CATEGORIES:
            item["disposition"] = item["category"]
        elif item["category"] == ADVANCE_CATEGORIES[2] and not scores[node]["rationale"]:
            item["disposition"] = "discovery prediction only; no supported rationale for advancement"
        elif node not in cleared:
            item["disposition"] = "unresolved patient safety"
        elif node in chosen:
            item["disposition"] = "advanced for " + {ADVANCE_CATEGORIES[0]:"research review", ADVANCE_CATEGORIES[1]:"delivery research",
                                                   ADVANCE_CATEGORIES[2]:"mechanistic research review"}[item["category"]]
        else:
            item["disposition"] = "held outside returned ranks"
    return strict, fallback, final
