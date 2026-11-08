from shared.patient_query import CLINICAL_FIELDS, PatientQueries


def run(g, p, pool, review, terms):
    queries = PatientQueries(g, p, pool, terms)
    for field in CLINICAL_FIELDS:
        fact, anchors = queries.fact(field, "disease")
        queries.disease_queries(fact, anchors)
    return queries.finish()


def evaluate(report, c, row):
    from shared.dossier import observed
    return ("I checked recorded function, swallowing, strength, weight and respiratory observations for a supported treatment relation. Measurements without a mapped phenotype remain available for formulation and safety review.\n\n" +
            observed("symptoms-function", row, report, c))
