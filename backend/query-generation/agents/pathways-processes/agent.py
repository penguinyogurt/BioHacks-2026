from shared.biology import PARTICIPATES, TARGET
from shared.patient_query import PatientQueries, process_anchors


def run(g, p, pool, review, terms):
    queries = PatientQueries(g, p, pool, terms)
    for process, bridges in process_anchors(g, queries.genes()):
        fact, derivation = bridges[min(bridges)]
        members = set(g.walk(process, PARTICIPATES, False))
        for relation in TARGET:
            if not any(g.walk(gene, relation, False) for gene in members):
                continue
            support = {}
            for drug in pool:
                common = members.intersection(g.walk(drug, relation, True))
                if common:
                    gene = min(common)
                    support[drug] = [[gene, PARTICIPATES, process], [drug, relation, gene]]
            queries.add(fact, process, [(PARTICIPATES, False), (relation, False)], derivation, support)
    return queries.finish()


def evaluate(report, c, row):
    from shared.dossier import observed
    return ("I traced genes linked to the diagnosis into observed biological processes. Shared participation and targeting do not establish the direction of a treatment effect in this patient.\n\n" +
            observed("pathways-processes", row, report, c))
