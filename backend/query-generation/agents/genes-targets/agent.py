from shared.biology import TARGET
from shared.patient_query import PatientQueries


def run(g, p, pool, review, terms):
    queries = PatientQueries(g, p, pool, terms)
    for gene, fact, derivation in queries.genes():
        for relation in TARGET:
            neighbors = g.walk(gene, relation, False)
            if neighbors:
                support = {drug: [[drug, relation, gene]] for drug in pool.intersection(neighbors)}
                queries.add(fact, gene, [(relation, False)], derivation, support)
    return queries.finish()


def evaluate(report, c, row):
    from shared.dossier import observed
    return ("I checked the chart for a genotype and expanded the recorded diagnosis through observed association, mutation and pathogenesis relations. A disease-level gene association does not establish the patient’s genotype or the effect of binding.\n\n" +
            observed("genes-targets", row, report, c))
