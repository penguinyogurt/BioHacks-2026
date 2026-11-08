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


def evaluate(report,c,row):
    from shared.dossier import observed,failures,cite
    rv=c["review"]
    baseline=(observed("safety-interactions-class",row,report,c) if row else
              "No supported rank on the original safety screen. No positive safety credit.")
    return ("**Safety unresolved.** "+baseline+" I checked the recorded medication and the targeted sources below. "
            +rv["ddi_interpretation"]+" "+rv["medication_check"]+" "+rv["warning"]+" "+
            ("Matched case fact: "+rv["matched_fact"]+". " if rv["matched_fact"] else "")+
            "No conclusion on local-route safety. "+
            " ".join(cite(u) for u in [report["sources"]["safety_evidence"]["source"],*rv["sources"]])+
            "\n\nExternal check limitations: "+("; ".join(failures(rv)) or "none retrieving the cited targeted records; evidence coverage remains limited."))
