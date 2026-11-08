"""Adjudicate exact-ingredient human ALS trial findings before graph ranking."""
from urllib.parse import urlparse

ADVANCE_CATEGORIES = ("favorable clinical evidence", "negative trial with delivery rationale")
HARM = "excluded for human harm"
NEGATIVE = "negative efficacy; retained only"
UNRESOLVED = "unresolved"
GENERAL_FUS = "https://pubmed.ncbi.nlm.nih.gov/31558719/"
ROLES = {"harm", "favorable", "negative", "inconclusive", "safety", "biomarker",
         "exploratory", "observational", "combination", "pharmacokinetic", "unreported"}
FIELDS = ("design", "population", "route", "primary_endpoint", "finding", "safety", "source")


def sourced(claim):
    return bool(claim.get("finding") and claim.get("sources")
                and all(urlparse(s).scheme == "https" and urlparse(s).hostname for s in claim["sources"]))


def delivery_supported(node, delivery, negatives):
    """Both curated links must address the same ingredient, site and failed regimen."""
    limitation = delivery.get("exposure", {})
    change = delivery.get("delivery_change", {})
    if not all(c.get("supported") is True and sourced(c) and c.get("ingredient") == node
               for c in (limitation, change)):
        return False
    trials = {r["source"] for r in negatives}
    return bool(limitation.get("failed_trial") in trials and limitation.get("site")
                and limitation["site"] == change.get("site")
                and change.get("method") == "focused ultrasound with microbubbles"
                and set(limitation["sources"]) - trials - {GENERAL_FUS}
                and set(change["sources"]) - trials - {GENERAL_FUS}
                and change.get("drug_specific") is True)


def assess(node, administered, evidence):
    reviews = [r for r in evidence.get("reports", []) if node in r["applies_to"]]
    for r in reviews:
        if r["role"] not in ROLES or not all(r.get(k) for k in FIELDS):
            raise ValueError("Incomplete evidence abstraction: " + str(r.get("source")))
        if r["role"] in ("harm", "favorable", "negative"):
            if r.get("basis") != "controlled human intervention" or not r.get("clinical_question"):
                raise ValueError("A decisive finding requires controlled human evidence and a clinical question")
            if urlparse(r["source"]).hostname not in ("pubmed.ncbi.nlm.nih.gov", "clinicaltrials.gov"):
                raise ValueError("A decisive finding requires a primary publication or trial registry")
    delivery = evidence.get("delivery", {}).get(node, {})
    unseen = sorted({s["source"] for s in administered} - {r["source"] for r in reviews})
    harms = [r for r in reviews if r["role"] == "harm"]
    positive = [r for r in reviews if r["role"] == "favorable"]
    negative = [r for r in reviews if r["role"] == "negative"]
    conflicting = ({r["clinical_question"] for r in positive} &
                   {r["clinical_question"] for r in negative})
    if harms:
        category, decisive = HARM, harms
    elif unseen or conflicting:
        category, decisive = UNRESOLVED, positive + negative
    elif positive:
        category, decisive = ADVANCE_CATEGORIES[0], positive
    elif negative:
        category = ADVANCE_CATEGORIES[1] if delivery_supported(node, delivery, negative) else NEGATIVE
        decisive = negative
    else:
        category, decisive = UNRESOLVED, reviews
    return dict(category=category, decisive=[{"finding":r["finding"], "source":r["source"]}
                    for r in decisive], studies=reviews, unreviewed_studies=unseen,
                conflicting_endpoints=sorted(conflicting), delivery=delivery,
                favorable_endpoints=sorted({r["clinical_question"] for r in positive}))


def clearance(review):
    screen = review.get("patient_safety_screen", {})
    return (review.get("action") in ("reviewed", "caution") and screen.get("status") == "pass"
            and sourced(screen) and (not review.get("ddi_edges") or bool(screen.get("ddi_adjudication"))))
