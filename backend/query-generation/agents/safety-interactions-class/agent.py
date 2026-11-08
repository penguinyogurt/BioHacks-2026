"""Category entry point. Research questions and adjudicated findings are keyed by this module's directory."""
from shared.retrieval import research_category as research


def evaluate(report, candidate, row):
    from shared.dossier import cite, observed
    decision = report["reassessments"][candidate["id"]]
    review = decision.get("review", {})
    screen = decision.get("case_exclusion")
    if screen:
        return screen["reason"] + " " + cite(screen["source"])
    text = observed("safety-interactions-class", row, report, candidate)
    if not review:
        return text + " Patient-specific safety clearance remains undocumented."
    findings = [review["ddi_interpretation"], review["medication_check"], review["warning"]]
    sources = " ".join(cite(url) for url in review["sources"])
    return text + "\n\n" + " ".join(x for x in findings if x) + " " + sources
