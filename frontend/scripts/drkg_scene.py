"""Precompute the stage-3 DRKG scene: a 3D projection of every DRKG entity, plus the
real traversal for Jeremy's five profiles (frontend/src/lib/pipeline.ts PROFILES).

    python frontend/scripts/drkg_scene.py

Needs numpy and the raw release in data/raw/drkg/ (gitignored):
    curl -fL -o data/raw/drkg/drkg.tar.gz https://dgl-data.s3-us-west-2.amazonaws.com/dataset/DRKG/drkg.tar.gz
    tar -xzf data/raw/drkg/drkg.tar.gz -C data/raw/drkg
    curl -fL -o data/raw/drkg/hetionet-v1.0-nodes.tsv https://github.com/hetio/hetionet/raw/main/hetnet/tsv/hetionet-v1.0-nodes.tsv
    # optional, names for biologics/investigationals (DrugBank ID, Wikidata P715):
    curl -fsS -G https://query.wikidata.org/sparql -H "Accept: text/tab-separated-values" \\
      --data-urlencode 'query=SELECT ?id ?label WHERE { ?item wdt:P715 ?id . ?item rdfs:label ?label . FILTER(lang(?label)="en") }' \\
      -o data/raw/drkg/wikidata-drugbank-names.tsv

Writes frontend/public/drkg/{points.bin, types.bin, names.json, scene.json}. Those are
committed, so the frontend never needs the 207 MB tarball.

Method
------
Projection: global PCA-3 (eigh of the 400x400 covariance), P(x) = ((x - mu) W) s, with s
chosen so the 98th-percentile radius is 10. It is linear, so P(e - r) = P(e) - s (r W):
the translation arrows drawn in 3D are exact. Distances are NOT read off the 3D picture;
every distance below is the true 400-d L2.

Query: TransE fits head + relation ~ tail. For (compound, DRUGBANK::target, gene) the
compound should sit near q = e[gene] - r[target]. Each compound in the universe
(Compound::DB\\d{5}) gets d = ||e[c] - q||_2 per gene; a profile's distance is the minimum
over its genes (one inspectable witness gene, no averaging of unrelated anchors).
"""

from __future__ import annotations

import collections
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "drkg"
OUT = ROOT / "frontend" / "public" / "drkg"
PIPELINE_TS = ROOT / "frontend" / "src" / "lib" / "pipeline.ts"

ALS = "Disease::MESH:D000690"
RELATION = "DRUGBANK::target::Compound:Gene"
TOP_K = 5
EDGE_CAP = 24
UNIVERSE = re.compile(r"^Compound::DB\d{5}$")


def r3(v) -> list[float]:
    return [round(float(x), 3) for x in v]


def load_index(path: Path) -> dict[str, int]:
    out = {}
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            name, idx = line.rstrip("\n").split("\t")
            out[name] = int(idx)
    return out


def git_json(ref: str) -> dict | None:
    try:
        text = subprocess.run(["git", "show", ref], cwd=ROOT, capture_output=True, check=True).stdout
        return json.loads(text)
    except (subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        print(f"warning: could not read {ref}: {exc}", file=sys.stderr)
        return None


def parse_pipeline() -> tuple[list[dict], list[tuple[str, int, str]]]:
    """Jeremy's PROFILES, MATCHES and CANDIDATES, read from the TS so they never drift."""
    src = PIPELINE_TS.read_text(encoding="utf-8")
    block = lambda a, b: src[src.index(a) : src.index(b)]
    profiles = [
        {"lane": int(lane), "name": name,
         "targets": [re.sub(r"\s*\(.*?\)", "", t).strip() for t in re.findall(r"'([^']+)'", targets)]}
        for lane, name, targets in re.findall(
            r"lane: (\d+),\s*name: '([^']+)',[\s\S]*?targets: \[([^\]]*)\]",
            block("export const PROFILES", "export type Match"),
        )
    ]
    hand = [(d, int(l), "MATCHES") for d, l in re.findall(
        r"drug: '([^']+)', lane: (\d+)", block("export const MATCHES", "export const PROFILE_POINTS"))]
    hand += [(d, int(l), "CANDIDATES") for d, l in re.findall(
        r"drug: '([^']+)',\s*lane: (\d+)", block("export const CANDIDATES", "export const EXCLUDED"))]
    return profiles, hand


def main() -> int:
    t0 = time.time()
    OUT.mkdir(parents=True, exist_ok=True)

    ent = load_index(RAW / "embed" / "entities.tsv")
    rel = load_index(RAW / "embed" / "relations.tsv")
    names_by_row = sorted(ent, key=ent.get)
    n = len(names_by_row)
    E = np.load(RAW / "embed" / "DRKG_TransE_l2_entity.npy").astype(np.float64)
    R = np.load(RAW / "embed" / "DRKG_TransE_l2_relation.npy").astype(np.float64)
    assert E.shape == (n, 400), E.shape

    # --- projection -------------------------------------------------------------
    mu = E.mean(axis=0)
    X = E - mu
    evals, evecs = np.linalg.eigh(X.T @ X / n)
    order = np.argsort(evals)[::-1]
    W = evecs[:, order[:3]]
    explained = evals[order[:3]] / evals.sum()
    raw3 = X @ W
    s = 10.0 / np.percentile(np.linalg.norm(raw3, axis=1), 98)
    pts = (raw3 * s).astype("<f4")
    P = lambda x: ((x - mu) @ W) * s
    r_target = R[rel[RELATION]]

    # --- types ------------------------------------------------------------------
    kinds = [name.split("::", 1)[0] for name in names_by_row]
    counts = collections.Counter(kinds).most_common()
    type_index = {k: i for i, (k, _) in enumerate(counts)}
    types = np.asarray([type_index[k] for k in kinds], dtype=np.uint8)

    # --- names ------------------------------------------------------------------
    het_name: dict[str, str] = {}
    gene_symbol: dict[str, list[str]] = collections.defaultdict(list)
    with (RAW / "hetionet-v1.0-nodes.tsv").open(encoding="utf-8") as fh:
        next(fh)
        for line in fh:
            hid, name, kind = line.rstrip("\n").split("\t")
            het_name[hid] = name
            if kind == "Gene":
                gene_symbol[name.upper()].append(hid)
    label: dict[str, str] = {k: v for k, v in het_name.items() if k in ent}
    kg = git_json("origin/cursor/pipeline-graph-ui:data/kg_scores.json")
    for c in (kg or {}).get("compounds", []):
        if c["drkg_id"] in ent and c.get("name") and c["drkg_id"] not in label:
            label[c["drkg_id"]] = c["name"]
    levi = git_json("origin/agentic-query-generation:backend/query-generation/snapshots/alex-gated.json")
    for cid, name in (levi or {}).get("ingredient_names", {}).items():
        if cid in ent:
            label.setdefault(cid, name)
    # Hetionet and DrugCentral cover almost no biologics or investigationals; Wikidata's
    # DrugBank-ID property (P715) does. Optional: skipped with a warning if not fetched.
    wiki = RAW / "wikidata-drugbank-names.tsv"
    if wiki.exists():
        with wiki.open(encoding="utf-8") as fh:
            next(fh)
            for line in fh:
                db, name = (x.strip().strip('"').removesuffix('"@en') for x in line.rstrip("\n").split("\t", 1))
                if f"Compound::{db}" in ent:
                    label.setdefault(f"Compound::{db}", name)
    else:
        print(f"warning: {wiki} missing; most biologic/investigational compounds stay unnamed", file=sys.stderr)
    for k, v in label.items():
        if k.startswith("Compound::"):
            label[k] = v[:1].upper() + v[1:]
    label[ALS] = "Amyotrophic Lateral Sclerosis"
    # Hover labels: GO terms are long and nobody hovers them at an expo; keep the rest.
    hover = {str(ent[k]): v for k, v in label.items()
             if k.split("::", 1)[0] not in {"Biological Process", "Molecular Function", "Cellular Component"}}

    # --- profiles: resolve genes --------------------------------------------------
    profiles, hand = parse_pipeline()
    assert len(profiles) == 5, profiles
    gene_ids: dict[str, str] = {}
    for p in profiles:
        p["unresolved"] = []
        for sym in p["targets"]:
            hits = [h for h in gene_symbol.get(sym.upper(), []) if h in ent]
            if len(hits) == 1:
                gene_ids[sym] = hits[0]
            else:
                p["unresolved"].append(sym)
    wanted = set(gene_ids.values())

    # --- one streaming pass: compound-gene edges on profile genes, gene-ALS edges ----
    neighbours: dict[str, dict[str, list[str]]] = {g: collections.defaultdict(list) for g in wanted}
    edge_count = collections.Counter()
    als_edge: dict[str, str] = {}
    with (RAW / "drkg.tsv").open(encoding="utf-8") as fh:
        for line in fh:
            h, r, t = line.rstrip("\n").split("\t")
            if h in wanted or t in wanted:
                g, other = (h, t) if h in wanted else (t, h)
                if other.startswith("Compound::"):
                    neighbours[g][other].append(r)
                    edge_count[g] += 1
                elif other == ALS:
                    als_edge.setdefault(g, r)

    # --- distances ----------------------------------------------------------------
    uni_rows = np.asarray([ent[k] for k in names_by_row if UNIVERSE.match(k)])
    U = E[uni_rows]
    uni_names = [names_by_row[i] for i in uni_rows]
    gene_d = {g: np.linalg.norm(U - (E[ent[g]] - r_target), axis=1) for g in wanted}
    sym_of = {v: k for k, v in gene_ids.items()}

    scene_profiles = []
    profile_rank: dict[int, dict[str, tuple[int, float]]] = {}
    for p in profiles:
        genes = [gene_ids[s_] for s_ in p["targets"] if s_ in gene_ids]
        if not genes:
            scene_profiles.append({"lane": p["lane"], "name": p["name"], "genes": [],
                                   "unresolved": p["unresolved"], "matches": [], "edges": []})
            continue
        D = np.stack([gene_d[g] for g in genes])
        best = D.min(axis=0)
        via = D.argmin(axis=0)
        order_ = np.argsort(best, kind="stable")
        profile_rank[p["lane"]] = {uni_names[i]: (r + 1, float(best[i])) for r, i in enumerate(order_)}
        matches = []
        for r, i in enumerate(order_[:TOP_K]):
            cid, g = uni_names[i], genes[via[i]]
            matches.append({
                "rank": r + 1, "id": cid, "row": ent[cid], "name": label.get(cid, cid.split("::", 1)[1]),
                "pos": r3(pts[ent[cid]]), "distance": round(float(best[i]), 3),
                "viaGene": sym_of[g], "directEdge": cid in neighbours[g],
            })
        match_ids = {m["id"] for m in matches}
        edges = []
        for g in genes:
            nb = neighbours[g]
            gd = dict(zip(uni_names, gene_d[g]))
            ranked = sorted(nb, key=lambda c: (c not in match_ids, c not in label, gd.get(c, 1e9), c))
            for c in [c for c in ranked if c in match_ids or c in label][:EDGE_CAP]:
                rels = nb[c]
                edges.append({"from": ent[g], "to": ent[c], "rel": RELATION if RELATION in rels else rels[0]})
        scene_profiles.append({
            "lane": p["lane"], "name": p["name"],
            "genes": [{"symbol": sym_of[g], "id": g, "row": ent[g], "pos": r3(pts[ent[g]]),
                       "query": r3(P(E[ent[g]] - r_target)), "targetEdges": edge_count[g],
                       "alsEdge": als_edge.get(g)} for g in genes],
            "unresolved": p["unresolved"], "matches": matches, "edges": edges,
        })

    # --- where the hand-written drugs actually land --------------------------------
    by_name: dict[str, str] = {}
    for k, v in label.items():
        if k.startswith("Compound::"):
            by_name.setdefault(v.lower(), k)
    hand_out = []
    for drug, lane, source in hand:
        cid = by_name.get(drug.lower())
        rank_, dist = profile_rank.get(lane, {}).get(cid, (None, None)) if cid else (None, None)
        hand_out.append({"drug": drug, "lane": lane, "source": source, "id": cid, "rank": rank_,
                         "distance": None if dist is None else round(dist, 3)})

    scene = {
        "meta": {
            "model": "DRKG pretrained TransE_l2, 400d", "entities": n, "projection": "PCA-3, global, numpy",
            "explainedVariance": [round(float(v), 4) for v in explained], "relation": RELATION,
            "formula": "q = e[gene] − r[target]; d(c) = ‖e[c] − q‖₂ in 400-d; profile distance = min over its genes",
            "universe": len(uni_rows), "topK": TOP_K,
        },
        "types": [{"name": k, "count": c} for k, c in counts],
        "als": {"id": ALS, "row": ent[ALS], "pos": r3(pts[ent[ALS]]), "label": "Amyotrophic Lateral Sclerosis"},
        "profiles": scene_profiles,
        "handWritten": hand_out,
    }

    (OUT / "points.bin").write_bytes(pts.tobytes())
    (OUT / "types.bin").write_bytes(types.tobytes())
    (OUT / "names.json").write_text(json.dumps(hover, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "scene.json").write_text(json.dumps(scene, ensure_ascii=False, indent=1), encoding="utf-8")

    # --- check (runnable, fails loudly if the maths or the wiring breaks) -------------
    g0 = next(iter(wanted))
    assert np.allclose(P(E[ent[g0]] - r_target), P(E[ent[g0]]) - s * (r_target @ W), atol=1e-4)
    assert np.allclose(np.frombuffer((OUT / "points.bin").read_bytes(), "<f4").reshape(-1, 3), pts)
    il6r = gene_ids.get("IL6R")
    if il6r:
        known = [c for c, rels in neighbours[il6r].items() if RELATION in rels and UNIVERSE.match(c)]
        order_il6r = {uni_names[i]: r + 1 for r, i in enumerate(np.argsort(gene_d[il6r]))}
        best_known = min(order_il6r[c] for c in known)
        assert best_known <= 300, f"IL6R's own DrugBank targets rank no better than {best_known}"
        print(f"check: IL6R's DrugBank-target compounds best rank {best_known}/{len(uni_rows)} "
              f"({', '.join(label.get(c, c) for c in known)})")

    # --- summary --------------------------------------------------------------------
    print(f"entities {n}  universe {len(uni_rows)} Compound::DB  relation {RELATION}")
    print(f"explained variance PC1-3 {[round(float(v), 4) for v in explained]}  (sum {explained.sum():.4f})")
    for sp in scene_profiles:
        print(f"\n[{sp['lane']}] {sp['name']}  genes {[(g['symbol'], g['targetEdges'], g['alsEdge']) for g in sp['genes']]}"
              f"  unresolved {sp['unresolved']}  edges drawn {len(sp['edges'])}")
        for m in sp["matches"]:
            print(f"   {m['rank']}. {m['name'][:30]:30} d={m['distance']:7.3f}  via {m['viaGene']:7} direct={m['directEdge']}")
    print("\nhand-written drugs, rank within their lane's profile:")
    for h in hand_out:
        print(f"   {h['source']:10} lane {h['lane']} {h['drug']:12} {h['id'] or 'NOT IN DRKG/names':22} "
              f"rank {h['rank']}  d={h['distance']}")
    print()
    for f in ("points.bin", "types.bin", "names.json", "scene.json"):
        print(f"   {f:12} {(OUT / f).stat().st_size / 1024:8.1f} KB")
    print(f"runtime {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
