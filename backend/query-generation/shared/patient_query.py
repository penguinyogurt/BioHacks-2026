"""Fact grounding, graph expansion, and signed TransE scoring on a shared pool."""
from collections import defaultdict

import numpy as np

from shared.biology import ASSOCIATION, PARTICIPATES, TREATS
from shared.query import query
from shared.terms import NEGATED

GRAPH_SOURCE = "https://github.com/gnn4dr/DRKG"
DDI = "DRUGBANK::ddi-interactor-in::Compound:Compound"
GENE_LINKS = [(ASSOCIATION, True), ("GNBR::U::Gene:Disease", False),
              ("GNBR::Ud::Gene:Disease", False), ("GNBR::J::Gene:Disease", False)]
CLINICAL_FIELDS = ("respiratory", "weight", "muscle", "swallow", "hand_function", "symptoms")


class PatientQueries:
    def __init__(self, graph, profile, pool, terms):
        self.g = graph
        self.profile = profile
        self.pool = pool
        self.terms = terms
        self.facts = []
        self.specs = []

    def fact(self, key, kind=None):
        text = self.profile["facts"].get(key)
        if not text:
            return None, []
        ids = self.terms.match(text, kind) if kind else []
        mode = "exact terminology match" if ids else "no graph mapping"
        if key == "swallow" and not NEGATED.search(text):
            # A symptom proxy requires the observed combination, not merely a field name.
            if "cough" in text.casefold() and any(s in text.casefold() for s in ("liquid", "drink", "swallow")):
                ids = self.terms.match("deglutition disorders", "disease")
                if ids:
                    mode = "swallowing-difficulty hypothesis; cough with liquids"
        fact = dict(field=key, quote=text, source=self.profile["source"],
                    pointer=self.profile.get("pointers", {}).get(key, "facts." + key),
                    ids=ids, mapping=mode)
        if mode.startswith("swallowing"):
            fact["mapping_source"] = "https://www.asha.org/practice-portal/clinical-topics/adult-dysphagia/"
        self.facts.append(fact)
        return fact, ids

    def add(self, fact, anchor, steps, derivation, support):
        g = self.g
        # A query relation must have an observed edge at each hop, even when no
        # gated ingredient has an eligible support path. Keep such predictions separate.
        if not self.pool:
            return
        evidence = [fact["source"], GRAPH_SOURCE, *derivation]
        built = query(g, anchor, steps, evidence, support, keep_empty=True)
        point, meta, _ = built
        formula = "e[" + anchor + "]"
        for step in meta["traversals"]:
            relation = step["relation"]
            step["row"] = g.relations[relation]
            formula += (" + " if step["forward"] else " - ") + "r[" + relation + "]"
        meta.update(fact=fact, derivation=derivation, formula=formula, anchor_row=g.entities[anchor],
                    anchor_label=self.terms.labels.get(anchor, anchor))
        self.specs.append((point, meta, support))

    def disease_queries(self, fact, anchors):
        for node in anchors:
            for rel in TREATS:
                neighbors = self.g.walk(node, rel, False)
                if neighbors:
                    support = {d: [[d, rel, node]] for d in self.pool.intersection(neighbors)}
                    self.add(fact, node, [(rel, False)], [], support)

    def genes(self):
        fact, diseases = self.fact("diagnosis", "disease")
        genetic_fact, explicit = self.fact("genotype", "gene")
        selected = []
        for disease in diseases:
            paths = defaultdict(list)
            for relation, forward in GENE_LINKS:
                for gene in set(self.g.walk(disease, relation, forward)):
                    edge = [disease, relation, gene] if forward else [gene, relation, disease]
                    paths[gene].append(edge)
            for gene in sorted(paths):
                selected.append((gene, fact, paths[gene]))
        for gene in explicit:
            selected.append((gene, genetic_fact, []))
        return selected

    def finish(self, risk=False):
        ids = sorted(self.pool)
        matrix = self.g.E[[self.g.entities[d] for d in ids]] if ids else []
        best = {}
        queries = []
        for index, (point, meta, support) in enumerate(self.specs):
            distances = np.linalg.norm(matrix - point, axis=1)
            meta["scores"] = {drug: float(dist) for drug, dist in zip(ids, distances)}
            queries.append(meta)
            for drug, witness in support.items():
                distance = meta["scores"][drug]
                if drug not in best or distance < best[drug]["l2"]:
                    best[drug] = dict(id=drug, query=index, l2=distance, support=witness)
        ranking = sorted(best.values(), key=lambda row: ((-1 if risk else 1)*row["l2"], row["id"]))
        for rank, row in enumerate(ranking, 1):
            row["rank"] = rank
        for fact in self.facts:
            fact["query_count"] = sum(q["fact"] is fact for q in queries)
            if not fact["query_count"]:
                fact["review_note"] = "Retained for evidence review. No signed compound query from this observation."
        return dict(facts=self.facts, queries=queries, ranking=ranking, pool_size=len(ids),
                    reason=None if ranking else "No eligible compound with a sourced supporting path or safety review.",
                    combination="Nearest supported query per compound; closest risk among documented medication reviews. Safety suitability orders that minimum distance descending.")


def process_anchors(g, selected):
    # Balance coverage and specificity using coverage times the linked-gene
    # fraction. Neither drug scores nor trial membership enter anchor selection.
    groups = defaultdict(dict)
    for gene, fact, derivation in selected:
        for process in g.walk(gene, PARTICIPATES, True):
            groups[process][gene] = (fact, derivation + [[gene, PARTICIPATES, process]])
    def priority(process):
        linked = len(groups[process])
        total = len(set(g.walk(process, PARTICIPATES, False)))
        return (-linked * linked / total, -linked, process)
    ordered = sorted(groups, key=priority)
    return [(p, groups[p]) for p in ordered[:5]]
