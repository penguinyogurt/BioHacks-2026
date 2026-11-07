"""Component A. Score every compound for the missing Compound-treats-ALS edge, and
produce a short typed path to ALS as the receipt the UI displays.

    python -m src.kg_rank

Writes data/kg_scores.json.

Method
------
Pretrained DRKG TransE_l2 embeddings, 400 dimensions. We do not train our own model;
that is the first item on the cut list and the pretrained vectors give a ranked list in
seconds.

TransE embeds a triple so that head + relation ~= tail, so the plausibility of the
missing edge is the negative distance between where the compound lands after the
relation translation and where ALS actually sits:

    score(c) = gamma - || e_c + e_treats - e_ALS ||_2

gamma = 12.0, the margin DGL-KE used to train these vectors. It is a constant, so it
shifts every score equally and changes no ranking; it is kept only so the numbers read
on the same scale as the published DRKG repurposing example.

Honesty note that belongs on the judging slide
----------------------------------------------
Riluzole (DB00740) and edaravone (DB12243) already have treats edges to the ALS node in
DRKG, so they were in the data these embeddings were fit on. Their ranks are a sanity
check that the scoring function is wired up correctly, not a held-out evaluation. The
module labels them `in_training_graph: true` and reports an additional rank computed over
compounds that have no existing ALS treats edge, which is the honest comparison.

Paths
-----
`data/kg_scores.json` carries a 2-3 hop typed path to ALS for the top 100, found by BFS
over a relation-filtered subgraph.

The spec asks for drug -> target gene -> pathway -> ALS. **That path does not exist in
DRKG**: there are 84,372 Gene-Pathway edges but zero Pathway-Disease edges, so a pathway
can never be the last hop before ALS. The reachable shapes, in the order we prefer them:

1. compound -> gene -> ALS                     (2 hops, gene is an ALS-associated gene)
2. compound -> gene -> gene -> ALS             (3 hops, via a gene-gene interaction)
3. compound -> gene -> pathway -> gene -> ALS  (4 hops, the pathway-mediated receipt)

Shape 3 is emitted only when 1 and 2 fail, because DRKG pathway nodes are Pathway Commons
`PC7_*` ids with no name available offline - fine as structure, poor as a UI label.
"""

from __future__ import annotations

import collections
import gzip
import json
import sys
from typing import Iterable

import networkx as nx
import numpy as np

from src import crosswalk, drkg
from src.paths import DATA, KG_SCORES_JSON, RAW, ensure_dirs

GAMMA = 12.0
TOP_N_PATHS = 100
MAX_HOPS = 4

GENE_INFO = RAW / "Homo_sapiens.gene_info.gz"

POSITIVE_CONTROLS = {"Compound::DB00740": "riluzole", "Compound::DB12243": "edaravone"}

# Compound -> Gene. "This drug does something to this gene product."
COMPOUND_GENE = {
    "DRUGBANK::target::Compound:Gene": "targets",
    "DRUGBANK::carrier::Compound:Gene": "is_carried_by",
    "DRUGBANK::transporter::Compound:Gene": "is_transported_by",
    "Hetionet::CbG::Compound:Gene": "binds",
    "Hetionet::CuG::Compound:Gene": "upregulates",
    "Hetionet::CdG::Compound:Gene": "downregulates",
    "GNBR::B::Compound:Gene": "binds",
    "GNBR::E::Compound:Gene": "affects_expression_of",
    "GNBR::N::Compound:Gene": "inhibits",
    "GNBR::A+::Compound:Gene": "agonises",
    "GNBR::A-::Compound:Gene": "antagonises",
    "bioarx::DrugHumGen:Compound:Gene": "targets",
}

# Gene -> Disease, in whichever direction DRKG stores it.
GENE_DISEASE = {
    "Hetionet::DaG::Disease:Gene": "associated_with",
    "Hetionet::DuG::Disease:Gene": "upregulated_in",
    "Hetionet::DdG::Disease:Gene": "downregulated_in",
    "GNBR::L::Gene:Disease": "implicated_in",
    "GNBR::J::Gene:Disease": "linked_to",
    "GNBR::U::Gene:Disease": "causal_in",
    "GNBR::Te::Gene:Disease": "treatment_target_in",
    "GNBR::Md::Gene:Disease": "biomarker_of",
    "GNBR::X::Gene:Disease": "overexpressed_in",
    "GNBR::Y::Gene:Disease": "polymorphism_in",
}

# Gene -> Gene. Curated and physical interactions only; the four STRING::OTHER-style
# buckets are too promiscuous to be a receipt a clinician would accept.
GENE_GENE = {
    "Hetionet::GiG::Gene:Gene": "interacts_with",
    "Hetionet::Gr>G::Gene:Gene": "regulates",
    "Hetionet::GcG::Gene:Gene": "covaries_with",
    "STRING::BINDING::Gene:Gene": "binds",
    "STRING::ACTIVATION::Gene:Gene": "activates",
    "STRING::INHIBITION::Gene:Gene": "inhibits",
    "GNBR::Rg::Gene:Gene": "regulates",
    "GNBR::B::Gene:Gene": "binds",
}

GENE_PATHWAY = {"Hetionet::GpPW::Gene:Pathway": "participates_in"}

# Not every gene-disease edge is worth showing a clinician. Hetionet's DaG/DuG/DdG are
# curated associations and GNBR::U/Te are causal or therapeutic-target statements; the
# rest are literature co-occurrence, which is why an untiered BFS routes half the top 100
# through CRP. Tier 1 is tried first, and only if it finds nothing do we accept tier 2.
STRONG_GENE_DISEASE = {
    "Hetionet::DaG::Disease:Gene",
    "Hetionet::DuG::Disease:Gene",
    "Hetionet::DdG::Disease:Gene",
    "GNBR::U::Gene:Disease",
    "GNBR::Te::Gene:Disease",
}

ALLOWED = {**COMPOUND_GENE, **GENE_DISEASE, **GENE_GENE, **GENE_PATHWAY}


def load_gene_symbols() -> dict[str, str]:
    """DRKG Gene nodes are Entrez ids. Receipts need symbols, so map them."""
    if not GENE_INFO.exists():
        return {}
    symbols: dict[str, str] = {}
    with gzip.open(GENE_INFO, "rt") as fh:
        next(fh, None)
        for line in fh:
            parts = line.split("\t", 3)
            if len(parts) > 2:
                symbols[parts[1]] = parts[2]
    return symbols


def node_label(node: str, symbols: dict[str, str]) -> str:
    kind, _, ident = node.partition("::")
    if kind == "Gene":
        return symbols.get(ident, f"Gene {ident}")
    if kind == "Disease" and node == drkg.ALS_NODE:
        return "Amyotrophic Lateral Sclerosis"
    if kind == "Pathway":
        return f"Pathway {ident}"
    return ident


def score_compounds(
    compound_nodes: Iterable[str],
    entity_index: dict[str, int],
    relation_index: dict[str, int],
) -> dict[str, dict[str, float]]:
    """TransE score for (compound, treats, ALS) under each treats relation."""
    entity_emb, relation_emb = drkg.load_embeddings()
    als = np.asarray(entity_emb[entity_index[drkg.ALS_NODE]], dtype=np.float32)

    nodes = [c for c in compound_nodes if c in entity_index]
    rows = np.asarray([entity_index[c] for c in nodes])
    heads = np.asarray(entity_emb[rows], dtype=np.float32)

    scores: dict[str, dict[str, float]] = {c: {} for c in nodes}
    for relation in drkg.TREATS_RELATIONS:
        rel = np.asarray(relation_emb[relation_index[relation]], dtype=np.float32)
        distance = np.linalg.norm(heads + rel - als, axis=1)
        values = GAMMA - distance
        for node, value in zip(nodes, values):
            scores[node][relation] = float(value)
    return scores


def build_path_graph() -> nx.DiGraph:
    """Relation-filtered directed graph for the receipt BFS.

    Edges are oriented in the direction a receipt reads - compound to gene, gene to
    disease - which is sometimes the reverse of how DRKG stores them (Hetionet writes
    Disease:Gene). Gene-gene edges go both ways because the interaction is symmetric.
    """
    graph = nx.DiGraph()
    for head, relation, tail in drkg.iter_triples():
        label = ALLOWED.get(relation)
        if label is None:
            continue
        if relation.endswith("Disease:Gene"):
            head, tail = tail, head  # store gene -> disease
        if graph.has_edge(head, tail):
            continue
        graph.add_edge(head, tail, rel=label, source=relation)
        if relation in GENE_GENE and not graph.has_edge(tail, head):
            graph.add_edge(tail, head, rel=label, source=relation)
    return graph


def find_path(
    graph: nx.DiGraph, compound: str, symbols: dict[str, str], compound_name: str | None = None
) -> list[dict[str, str]] | None:
    """Shortest allowed path from a compound to the ALS node, as UI-ready hops.

    BFS over three passes, in decreasing strength of claim: curated gene-disease edges
    without pathways, then curated edges with pathways, then any allowed edge. A receipt
    that lands on a curated ALS gene is worth more than a shorter one that lands on a
    literature co-occurrence, so strength is preferred over length.
    """
    if compound not in graph or drkg.ALS_NODE not in graph:
        return None

    for strong_only, allow_pathways in ((True, False), (True, True), (False, True)):
        queue = collections.deque([(compound, [compound])])
        seen = {compound}
        while queue:
            node, trail = queue.popleft()
            if len(trail) > MAX_HOPS:
                continue
            for nxt in graph.successors(node):
                if nxt in seen:
                    continue
                if nxt == drkg.ALS_NODE:
                    if strong_only and graph[node][nxt]["source"] not in STRONG_GENE_DISEASE:
                        continue
                    full = trail + [nxt]
                    labels = [node_label(n, symbols) for n in full]
                    if compound_name:
                        labels[0] = compound_name
                    return [
                        {"from": labels[i], "rel": graph[a][b]["rel"], "to": labels[i + 1]}
                        for i, (a, b) in enumerate(zip(full, full[1:]))
                    ]
                if nxt.startswith("Pathway::") and not allow_pathways:
                    continue
                if len(trail) + 1 > MAX_HOPS:
                    continue
                seen.add(nxt)
                queue.append((nxt, trail + [nxt]))
    return None


def existing_als_treats_edges() -> set[str]:
    """Compounds that already have a treats edge to ALS, i.e. not missing-link
    predictions at all. Needed to report an honest rank for the positive controls."""
    treats = set(drkg.TREATS_RELATIONS)
    als_nodes = {drkg.ALS_NODE, "Disease::DOID:332"}
    return {
        head
        for head, relation, tail in drkg.iter_triples()
        if relation in treats and tail in als_nodes
    }


def run() -> dict:
    drkg.download()
    entity_index = drkg.load_entity_index()
    relation_index = drkg.load_relation_index()
    symbols = load_gene_symbols()

    # The candidate universe: approved substances that carry a DRKG compound node,
    # joined on an RDKit InChIKey rather than a name. Falls back to every DRKG compound
    # node if the crosswalk has not been built yet, so this module never hard-blocks.
    universe: dict[str, dict] = {}
    try:
        for row in crosswalk.load():
            for node in filter(None, row["drkg_ids"].split("|")):
                universe.setdefault(
                    node,
                    {
                        "inchikey": row["inchikey"],
                        "name": row["drugcentral_name"],
                        "smiles": row["smiles"],
                        "drugcentral_id": row["drugcentral_id"],
                    },
                )
    except FileNotFoundError:
        print("no crosswalk yet; scoring every DRKG compound node", file=sys.stderr)

    all_compounds = drkg.compound_nodes(entity_index)
    scores = score_compounds(all_compounds, entity_index, relation_index)
    already_treats = existing_als_treats_edges()

    primary = drkg.SCORING_RELATION
    ranked_all = sorted(scores, key=lambda c: -scores[c][primary])
    rank_all = {c: i + 1 for i, c in enumerate(ranked_all)}

    in_universe = [c for c in ranked_all if c in universe] if universe else ranked_all
    rank_universe = {c: i + 1 for i, c in enumerate(in_universe)}

    # The held-out view: rank among compounds with no existing ALS treats edge, so a
    # drug that was in the training graph does not flatter itself.
    novel = [c for c in in_universe if c not in already_treats]
    rank_novel = {c: i + 1 for i, c in enumerate(novel)}

    graph = build_path_graph()

    compounds = []
    for node in in_universe:
        meta = universe.get(node, {})
        entry = {
            "drkg_id": node,
            "drugbank_id": node.split("::", 1)[1] if node.startswith("Compound::DB") else None,
            "inchikey": meta.get("inchikey"),
            "name": meta.get("name") or POSITIVE_CONTROLS.get(node) or node.split("::", 1)[1],
            "smiles": meta.get("smiles"),
            "score": round(scores[node][primary], 4),
            "rank": rank_universe[node],
            "rank_all_compounds": rank_all[node],
            "rank_excluding_known_als_drugs": rank_novel.get(node),
            "in_training_graph": node in already_treats,
            "scores_by_relation": {
                relation: round(scores[node][relation], 4) for relation in drkg.TREATS_RELATIONS
            },
            "path": None,
        }
        compounds.append(entry)

    for entry in compounds[:TOP_N_PATHS]:
        entry["path"] = find_path(graph, entry["drkg_id"], symbols, entry["name"])

    with_paths = sum(1 for e in compounds[:TOP_N_PATHS] if e["path"])
    controls = {}
    for node, name in POSITIVE_CONTROLS.items():
        entry = next((e for e in compounds if e["drkg_id"] == node), None)
        controls[name] = (
            {
                "drkg_id": node,
                "score": entry["score"],
                "rank": entry["rank"],
                "rank_all_compounds": entry["rank_all_compounds"],
                "in_training_graph": entry["in_training_graph"],
                "universe_size": len(in_universe),
            }
            if entry
            else None
        )

    doc = {
        "meta": {
            "als_node": drkg.ALS_NODE,
            "scoring_relation": primary,
            "model": "DRKG pretrained TransE_l2, 400d (not retrained)",
            "score_definition": "gamma - L2(head + relation - tail), gamma = 12.0",
            "gamma": GAMMA,
            "universe_size": len(in_universe),
            "all_drkg_compound_nodes": len(scores),
            "compounds_with_existing_als_treats_edge": len(
                [c for c in in_universe if c in already_treats]
            ),
            "paths_requested": TOP_N_PATHS,
            "paths_found": with_paths,
            "max_hops": MAX_HOPS,
        },
        "validation": {
            "positive_controls": controls,
            "caveat": (
                "Riluzole and edaravone already have treats edges to "
                f"{drkg.ALS_NODE} in DRKG, so these embeddings saw them. Their ranks "
                "verify the scoring function, they are not a held-out evaluation; "
                "rank_excluding_known_als_drugs is the honest comparison for every "
                "other compound."
            ),
        },
        "compounds": compounds,
    }

    ensure_dirs()
    KG_SCORES_JSON.write_text(json.dumps(doc, indent=2) + "\n")
    return doc


def main() -> int:
    doc = run()
    meta = doc["meta"]
    print(f"ALS node          {meta['als_node']}")
    print(f"relation          {meta['scoring_relation']}")
    print(f"universe          {meta['universe_size']} approved compounds with a DRKG node")
    print(f"scored            {meta['all_drkg_compound_nodes']} DRKG compound nodes")
    print(f"paths             {meta['paths_found']}/{meta['paths_requested']} found")
    print()
    print("positive controls")
    for name, control in doc["validation"]["positive_controls"].items():
        if control is None:
            print(f"  {name:10} NOT FOUND in the universe")
            continue
        print(
            f"  {name:10} rank {control['rank']}/{control['universe_size']} "
            f"(score {control['score']}, rank {control['rank_all_compounds']} among all "
            f"DRKG compounds, in_training_graph={control['in_training_graph']})"
        )
    print()
    print("top 15")
    for entry in doc["compounds"][:15]:
        hops = len(entry["path"]) if entry["path"] else 0
        print(f"  {entry['rank']:>3}. {entry['name'][:34]:34} {entry['score']:>8.4f}  {hops} hops")
    print(f"\nwrote {KG_SCORES_JSON}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
