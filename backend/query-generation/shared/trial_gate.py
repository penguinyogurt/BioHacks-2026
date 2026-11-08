"""Closed, reviewed evidence set. Only documented administered ingredients can pass."""
from collections import defaultdict
import re
from urllib.parse import urlparse
from shared.terms import norm

OUTCOMES = {"positive", "negative", "inconclusive", "unreported"}


def attributable_study(study):
    source = urlparse(study["source"])
    if source.scheme != "https":
        return False
    if study["evidence_kind"] == "primary publication":
        return (source.hostname == "pubmed.ncbi.nlm.nih.gov"
                and study["study_id"] == "PMID:" + source.path.strip("/")
                and source.path.strip("/").isdigit())
    return (study["evidence_kind"] == "trial registry" and source.hostname == "clinicaltrials.gov"
            and re.fullmatch(r"NCT[0-9]{8}", study["study_id"]) is not None
            and source.path.strip("/").split("/")[-1] == study["study_id"])


def trial_gate(canonical, catalog):
    aliases = {}
    evidence = defaultdict(list)
    withheld = []
    ingredients = {item["id"]: item for item in catalog["ingredients"]}
    for node, item in ingredients.items():
        for alias in [item["name"], *item["aliases"]]:
            key = norm(alias)
            if key in aliases and aliases[key] != node:
                raise ValueError("Ambiguous ingredient alias: " + alias)
            aliases[key] = node
    for study in catalog["studies"]:
        valid = (study["human_als"] is True and study["interventional"] is True and
                 study["administered"] is True and study["status"] in ("treated cohort reported", "completed", "ongoing with documented exposure",
                                     "stopped for futility", "arm stopped at interim analysis",
                                     "stopped at sequential analysis", "terminated after dosing") and
                 attributable_study(study) and
                 study["outcome"] in OUTCOMES and all(study[k] for k in
                 ("study_id","population","formulation","administration_evidence","result")))
        if not valid:
            withheld.append({"study": study["study_id"], "reason": "insufficient administration evidence"})
            continue
        for alias in study["tested_ingredients"]:
            node = aliases.get(norm(alias))
            if node in canonical:
                evidence[node].append(study)
            else:
                withheld.append({"ingredient": alias, "study": study["study_id"],
                                 "reason": "no exact ingredient ID in frozen graph"})
    return dict(before=len(canonical), after=len(evidence), without_verified_study=len(canonical)-len(evidence),
                evidence=dict(evidence), identities={n:ingredients[n] for n in evidence}, withheld=withheld,
                scope=catalog["scope"], formulation_checks=catalog.get("formulation_checks", []))
