from shared.patient_query import PatientQueries


def run(g, p, pool, review, terms):
    queries = PatientQueries(g, p, pool, terms)
    fact, diseases = queries.fact("diagnosis", "disease")
    queries.disease_queries(fact, diseases)
    return queries.finish()


def evaluate(report, c, row):
    from shared.dossier import observed
    return ("I checked observed treatment relations for the diagnosis recorded in the chart. The human ALS study section gives the administered formulation and observed outcome.\n\n" +
            observed("disease-indications", row, report, c))
