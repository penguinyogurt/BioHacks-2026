"""Combine full, sourced ranks, then adjudicate provisional leaders in order."""
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


def fallback(pool, agents, policy, examine, excluded=()):
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

    candidates = []
    ineligible = {}
    for node in sorted(pool):
        if node in excluded:
            ineligible[node] = "prior eligibility exclusion"
            continue
        ranks = {name: index[node] for name, index in indexes.items() if node in index}
        if not any(name in ranks for name in RATIONALE):
            ineligible[node] = "missing sourced disease, target or pathway rationale"
            continue
        coverage = sum(shares[name] for name in ranks)
        credits = {name: 0.0 for name in NAMES}
        for name, rank in ranks.items():
            credits[name] = shares[name] * (offset + 1) / (offset + rank) * coverage**exponent
        candidates.append(dict(id=node, ranks=ranks, coverage=coverage,
                               contributions=credits, base=sum(credits.values())))
    candidates.sort(key=lambda row: (-row["base"], row["id"]))

    accepted = []
    audit = []
    vetoes = {}
    for position, candidate in enumerate(candidates, 1):
        # Review can only decrease a score. Process ties before stopping.
        if len(accepted) >= LIMIT and candidate["base"] < accepted[LIMIT - 1]["score"]:
            break
        node = candidate["id"]
        review = examine(node)
        candidate["provisional_rank"] = position
        audit.append(dict(id=node, provisional_rank=position, review=review))
        action = review["action"]
        if action in ("veto", "caution"):
            if not (review.get("sources") and review.get("warning") and review.get("matched_fact")):
                raise ValueError("A concern requires a source, matching case fact and reason")
        if action == "veto":
            vetoes[node] = review
            continue
        if action not in ("caution", "unknown", "reviewed"):
            raise ValueError("Invalid review action")
        deduction = penalty if action == "caution" else 0.0
        candidate.update(score=candidate["base"] - deduction, penalty=deduction, review=review)
        accepted.append(candidate)
        accepted.sort(key=lambda row: (-row["score"], row["id"]))

    initial = [row["id"] for row in candidates[:LIMIT]]
    final = accepted[:LIMIT]
    ids = [row["id"] for row in final]
    for position, row in enumerate(final, 1):
        row["fallback_rank"] = position
    return dict(policy=policy, evaluated=len(pool), provisional_count=len(candidates),
                initial=initial, final=final, reviews=audit, new_vetoes=vetoes,
                dropped=[node for node in initial if node not in ids],
                backfilled=[node for node in ids if node not in initial],
                ineligible=ineligible, provisional=[(row["id"], row["base"]) for row in candidates])
