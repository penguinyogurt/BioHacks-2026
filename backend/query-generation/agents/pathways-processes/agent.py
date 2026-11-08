"""Category entry point. Research questions and adjudicated findings are keyed by this module's directory."""
from shared.retrieval import research_category as research


def evaluate(report, candidate, row):
    from shared.dossier import observed
    return observed("pathways-processes",row,report,candidate)
