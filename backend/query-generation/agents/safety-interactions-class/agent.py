from shared.patient_query import CLINICAL_FIELDS, DDI, PatientQueries


def run(g, p, pool, review, terms):
    queries = PatientQueries(g, p, pool, terms)
    fact, medicines = queries.fact("current_therapy", "compound")
    unresolved = []
    if fact:
        parts = terms.medication_parts(fact["quote"])
        medicines = sorted({node for _, ids in parts for node in ids})
        unresolved = [text for text, ids in parts if not ids]
        fact.update(ids=medicines, unresolved_medications=unresolved)
        if unresolved:
            fact["mapping"] = "partial medication mapping" if medicines else "no graph mapping"
    for field in CLINICAL_FIELDS:
        queries.fact(field)
    for med in medicines:
        outgoing = set(g.walk(med, DDI, True))
        incoming = set(g.walk(med, DDI, False))
        reviews = review["reviewed"] if not unresolved and medicines == [review["applies_with"]] else {}
        support = {drug: item for drug, item in reviews.items()
                   if drug in pool and drug not in outgoing | incoming and item.get("source") and item.get("finding")}
        for forward, neighbors in ((True, outgoing), (False, incoming)):
            if neighbors:
                other = min(neighbors)
                edge = [med, DDI, other] if forward else [other, DDI, med]
                queries.add(fact, med, [(DDI, forward)], [edge], support)
    return queries.finish(risk=True)


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
