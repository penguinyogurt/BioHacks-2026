"""DRKG loading, and the one piece of knowledge everything downstream depends on:
which node and which relation actually represent "treats ALS".

Do not guess the ALS node. DRKG entity ids carry no names, so grepping the entity
list for "amyotrophic" returns nothing - you have to grep for the ontology ids and
then count the edges. Run this module to redo that check from scratch:

    python -m src.drkg

It prints the report and writes artifacts/als_node.json.
"""

from __future__ import annotations

import collections
import json
import subprocess
import sys
import tarfile
from typing import Iterator

import numpy as np

from src.paths import ARTIFACTS, RAW, ensure_dirs

DRKG_URL = "https://dgl-data.s3-us-west-2.amazonaws.com/dataset/DRKG/drkg.tar.gz"

TRIPLES = RAW / "drkg.tsv"
EMBED_DIR = RAW / "embed"
ENTITIES_TSV = EMBED_DIR / "entities.tsv"
RELATIONS_TSV = EMBED_DIR / "relations.tsv"
ENTITY_EMB = EMBED_DIR / "DRKG_TransE_l2_entity.npy"
RELATION_EMB = EMBED_DIR / "DRKG_TransE_l2_relation.npy"

# Confirmed by edge count, not by assumption. See module docstring and
# artifacts/als_node.json. MeSH D000690 is amyotrophic lateral sclerosis.
ALS_NODE = "Disease::MESH:D000690"

# Candidates checked when resolving the ALS node. DOID:332 is also ALS, but it is a
# near-orphan in DRKG; D016472 is motor neuron disease, the parent term.
ALS_CANDIDATES = [
    "Disease::MESH:D000690",
    "Disease::DOID:332",
    "Disease::OMIM:105400",
    "Disease::MESH:D016472",
]

# The three relations DRKG uses for "a compound treats a disease". They come from
# different sources and - critically - they do not share a disease namespace.
TREATS_RELATIONS = [
    "DRUGBANK::treats::Compound:Disease",
    "GNBR::T::Compound:Disease",
    "Hetionet::CtD::Compound:Disease",
]

# The relation we score the missing edge with. GNBR::T carries 55 of the 57 existing
# treats edges on the ALS node, so it is the one the embedding actually learned.
SCORING_RELATION = "GNBR::T::Compound:Disease"


def download() -> None:
    """Fetch and unpack drkg.tar.gz if it is not already on disk.

    The tarball includes the pretrained TransE_l2 embeddings, so this is the only
    download component A needs.
    """
    ensure_dirs()
    if TRIPLES.exists() and ENTITY_EMB.exists():
        return
    archive = RAW / "drkg.tar.gz"
    if not archive.exists():
        print(f"downloading {DRKG_URL} (~207 MB)", file=sys.stderr)
        subprocess.run(["curl", "-sS", "-L", "-o", str(archive), DRKG_URL], check=True)
    print("unpacking", file=sys.stderr)
    with tarfile.open(archive) as tf:
        tf.extractall(RAW)


def load_entity_index() -> dict[str, int]:
    """entity name -> row in the entity embedding matrix."""
    out: dict[str, int] = {}
    with ENTITIES_TSV.open() as fh:
        for line in fh:
            name, idx = line.rstrip("\n").split("\t")
            out[name] = int(idx)
    return out


def load_relation_index() -> dict[str, int]:
    out: dict[str, int] = {}
    with RELATIONS_TSV.open() as fh:
        for line in fh:
            name, idx = line.rstrip("\n").split("\t")
            out[name] = int(idx)
    return out


def load_embeddings() -> tuple[np.ndarray, np.ndarray]:
    """(entity, relation) embedding matrices, memory-mapped.

    Pretrained TransE_l2, 400 dimensions, 97,238 entities and 107 relations. We do not
    train our own; that is the first thing on the cut list.
    """
    return (
        np.load(ENTITY_EMB, mmap_mode="r"),
        np.load(RELATION_EMB, mmap_mode="r"),
    )


def iter_triples() -> Iterator[tuple[str, str, str]]:
    """All 5,874,261 head/relation/tail triples."""
    with TRIPLES.open() as fh:
        for line in fh:
            h, r, t = line.rstrip("\n").split("\t")
            yield h, r, t


def compound_nodes(entity_index: dict[str, int] | None = None) -> list[str]:
    idx = entity_index or load_entity_index()
    return [name for name in idx if name.startswith("Compound::")]


def resolve_als_node() -> dict:
    """Count every edge on each ALS-candidate node, and report which relations and
    which disease namespaces the treats edges actually use.

    This is the gotcha the spec warns about, done as a measurement.
    """
    download()
    entity_index = load_entity_index()

    edges: dict[str, collections.Counter] = {c: collections.Counter() for c in ALS_CANDIDATES}
    treats_namespaces: dict[str, collections.Counter] = {
        r: collections.Counter() for r in TREATS_RELATIONS
    }
    treats_edges: dict[str, list[str]] = {c: [] for c in ALS_CANDIDATES}

    candidates = set(ALS_CANDIDATES)
    treats = set(TREATS_RELATIONS)
    for head, rel, tail in iter_triples():
        if rel in treats:
            namespace = tail.split("::", 1)[1].split(":", 1)[0]
            treats_namespaces[rel][namespace] += 1
        for node in (head, tail):
            if node in candidates:
                edges[node][rel] += 1
                if rel in treats:
                    treats_edges[node].append(f"{head} -[{rel}]-> {tail}")

    report = {
        "resolved_als_node": ALS_NODE,
        "scoring_relation": SCORING_RELATION,
        "candidates": [
            {
                "node": c,
                "in_entity_index": c in entity_index,
                "embedding_row": entity_index.get(c),
                "total_edges": sum(edges[c].values()),
                "treats_edges": sum(edges[c][r] for r in TREATS_RELATIONS),
                "edges_by_relation": dict(edges[c].most_common()),
                "treats_edge_examples": treats_edges[c][:5],
            }
            for c in ALS_CANDIDATES
        ],
        "treats_relation_disease_namespaces": {
            r: dict(treats_namespaces[r].most_common()) for r in TREATS_RELATIONS
        },
    }
    return report


def main() -> int:
    report = resolve_als_node()
    ensure_dirs()
    out = ARTIFACTS / "als_node.json"
    out.write_text(json.dumps(report, indent=2) + "\n")

    print("ALS node candidates in DRKG")
    print(f"{'node':28} {'in index':>9} {'edges':>7} {'treats':>7}")
    for c in report["candidates"]:
        print(
            f"{c['node']:28} {str(c['in_entity_index']):>9} "
            f"{c['total_edges']:>7} {c['treats_edges']:>7}"
        )
    print()
    print("disease namespace used by each treats relation")
    for rel, namespaces in report["treats_relation_disease_namespaces"].items():
        print(f"  {rel:42} {namespaces}")
    print()
    print(f"resolved: {report['resolved_als_node']}  scoring with {report['scoring_relation']}")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
