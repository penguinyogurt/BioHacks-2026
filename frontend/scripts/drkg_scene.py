"""Precompute the stage-3 DRKG scene: a clustered 3D layout of every DRKG entity, plus the
real traversal for a set of profiles.

    python frontend/scripts/drkg_scene.py                         # Jeremy's 5 PROFILES
    python frontend/scripts/drkg_scene.py --profiles p.json --out run.json
    python frontend/scripts/drkg_scene.py --from-levi backend/query-generation/snapshots/coordinated-alex
    python frontend/scripts/drkg_scene.py --relayout              # rebuild the layout (~10 min)

Per run (profiles -> queries, L2 ranks, edges) takes seconds: the layout and a binary index
of all 5.87M triples are cached in data/raw/drkg/cache/ (gitignored) and reused unless
--relayout is passed or a cached file is missing. The layout's public outputs
(points/types/clusters/degree .bin, names.json) are committed; scene.json is per run.

Needs numpy and the raw release in data/raw/drkg/ (gitignored):
    curl -fL -o data/raw/drkg/drkg.tar.gz https://dgl-data.s3-us-west-2.amazonaws.com/dataset/DRKG/drkg.tar.gz
    tar -xzf data/raw/drkg/drkg.tar.gz -C data/raw/drkg
    curl -fL -o data/raw/drkg/hetionet-v1.0-nodes.tsv https://github.com/hetio/hetionet/raw/main/hetnet/tsv/hetionet-v1.0-nodes.tsv
    # optional, names for biologics/investigationals (DrugBank ID, Wikidata P715):
    curl -fsS -G https://query.wikidata.org/sparql -H "Accept: text/tab-separated-values" \\
      --data-urlencode 'query=SELECT ?id ?label WHERE { ?item wdt:P715 ?id . ?item rdfs:label ?label . FILTER(lang(?label)="en") }' \\
      -o data/raw/drkg/wikidata-drugbank-names.tsv

Profiles JSON (--profiles): [{"lane": 0, "name": "...", "targets": ["IGF1R", "Gene::5979", ...]}]
(see frontend/public/drkg/profiles.example.json). Targets are HGNC symbols or DRKG Gene ids.

Method
------
Layout: k-means (k=24) on PCA-50 of the 400-d vectors; islands placed by PCA-3 of the
centroids and pushed apart until they don't overlap; each point = its centroid + a local
PCA-3 offset. Query points go to their nearest island the same way. Reads as clean clusters
but is NOT distance-preserving, so arrows are illustrative. Every distance is true 400-d L2.
(Global PCA-3 kept arrows exact but carried 10% of the variance and rendered as one blob;
UMAP needs numba, which has no Python 3.14 wheels.)

Query (--profiles / default): TransE fits head + relation ~ tail, so a compound targeting a
gene should sit near q = e[gene] - r[DRUGBANK::target]. Every Compound::DB\\d{5} gets
d = ||e[c] - q||_2 per gene; a profile keeps the minimum over its genes.

Query (--from-levi): one profile per agent in <snapshot>/handoff/<agent>/. q is rebuilt from
each query's `formula` ("e[X] - r[A] + r[B]"), matches are the agent's own ranking.json
top_k (its pool, its ranks), and every reused l2 is re-checked against our own vectors.
"""

from __future__ import annotations

import argparse
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
CACHE = RAW / "cache"
OUT = ROOT / "frontend" / "public" / "drkg"
PIPELINE_TS = ROOT / "frontend" / "src" / "lib" / "pipeline.ts"

ALS = "Disease::MESH:D000690"
RELATION = "DRUGBANK::target::Compound:Gene"
TOP_K = 5
EDGE_CAP = 24
UNIVERSE = re.compile(r"^Compound::DB\d{5}$")
PCA_DIMS = 50     # k-means runs here, not in raw 400-d: same clusters, ~8x faster
K_CLUSTERS = 24   # islands on screen; uint8 in clusters.bin
ISLAND = 1.6      # radius of an average-size island before the final rescale
LAYOUT_BINS = ("points.bin", "types.bin", "clusters.bin", "degree.bin")
LEVI_AGENTS = {  # order = Levi's fallback-weight order
    "disease-indications": "Disease / indications",
    "genes-targets": "Genes / targets",
    "safety-interactions-class": "Safety / interactions",
    "pathways-processes": "Pathways / processes",
    "symptoms-function": "Symptoms / function",
}


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
        {"lane": int(lane), "name": name, "targets": re.findall(r"'([^']+)'", targets)}
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


def kmeans(Z: np.ndarray, k: int, iters: int = 25, seed: int = 42) -> tuple[np.ndarray, np.ndarray]:
    """Plain Lloyd's with k-means++ seeding; deterministic for a fixed seed."""
    rng = np.random.default_rng(seed)
    sq = (Z ** 2).sum(axis=1)
    C = [Z[rng.integers(len(Z))]]
    d2 = ((Z - C[0]) ** 2).sum(axis=1)
    for _ in range(1, k):
        C.append(Z[rng.choice(len(Z), p=d2 / d2.sum())])
        d2 = np.minimum(d2, ((Z - C[-1]) ** 2).sum(axis=1))
    C = np.asarray(C)
    for _ in range(iters):
        labels = np.argmin(sq[:, None] - 2 * Z @ C.T + (C ** 2).sum(axis=1)[None, :], axis=1)
        newC = np.asarray([Z[labels == j].mean(axis=0) if (labels == j).any() else C[j] for j in range(k)])
        if np.allclose(newC, C):
            break
        C = newC
    return labels, C


def layout_centres(C: np.ndarray, rho: np.ndarray, gap: float = 0.6, steps: int = 400) -> np.ndarray:
    """PCA-3 of the centroids (related islands sit near each other), then push apart until
    no two islands overlap."""
    Cc = C - C.mean(axis=0)
    ev, vec = np.linalg.eigh(Cc.T @ Cc)
    P3 = Cc @ vec[:, np.argsort(ev)[::-1][:3]]
    P3 *= 8.0 / np.linalg.norm(P3, axis=1).max()
    for _ in range(steps):
        moved = False
        for i in range(len(P3)):
            for j in range(i + 1, len(P3)):
                d = P3[j] - P3[i]
                dist = np.linalg.norm(d) or 1e-6
                need = rho[i] + rho[j] + gap
                if dist < need:
                    push = (need - dist) / 2 * d / dist
                    P3[i] -= push
                    P3[j] += push
                    moved = True
        if not moved:
            break
    return P3


def load_triples(ent: dict[str, int], rel: dict[str, int], force: bool) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """All DRKG triples as int32 (head row, relation row, tail row). One slow parse, cached."""
    path = CACHE / "triples.npz"
    if path.exists() and not force:
        z = np.load(path)
        return z["h"], z["r"], z["t"]
    h, r, t = (np.empty(5_874_261, np.int32) for _ in range(3))
    i = 0
    with (RAW / "drkg.tsv").open(encoding="utf-8") as fh:
        for i, line in enumerate(fh):
            a, b, c = line.rstrip("\n").split("\t")
            h[i], r[i], t[i] = ent[a], rel[b], ent[c]
    assert i + 1 == len(h), i
    CACHE.mkdir(parents=True, exist_ok=True)
    np.savez(path, h=h, r=r, t=t)
    return h, r, t


def build_layout(E: np.ndarray) -> dict:
    mu = E.mean(axis=0)
    X = E - mu
    evals, evecs = np.linalg.eigh(X.T @ X / len(E))
    W50 = evecs[:, np.argsort(evals)[::-1][:PCA_DIMS]]
    Z = X @ W50
    labels, C = kmeans(Z, K_CLUSTERS)
    sizes = np.bincount(labels, minlength=K_CLUSTERS)
    rho = ISLAND * np.cbrt(sizes / sizes.mean())  # equal visual density per island
    centre = layout_centres(C, rho)
    local_W, local_s = [], []
    for k in range(K_CLUSTERS):
        res = Z[labels == k] - C[k]
        ev, vec = np.linalg.eigh(res.T @ res / len(res))
        Wk = vec[:, np.argsort(ev)[::-1][:3]]
        local_W.append(Wk)
        local_s.append(rho[k] / max(np.percentile(np.linalg.norm(res @ Wk, axis=1), 90), 1e-9))
    raw3 = np.empty((len(E), 3))
    for k in range(K_CLUSTERS):
        m = labels == k
        raw3[m] = centre[k] + (Z[m] - C[k]) @ local_W[k] * local_s[k]
    s = 10.0 / np.percentile(np.linalg.norm(raw3, axis=1), 98)
    return {"mu": mu, "W50": W50, "C": C, "rho": rho, "centre": centre, "local_W": np.stack(local_W),
            "local_s": np.asarray(local_s), "s": np.float64(s), "labels": labels.astype(np.uint8),
            "pts": (raw3 * s).astype("<f4")}


def placer(L: dict):
    """Place a non-entity vector (a query point) on its nearest island, same map as points.bin."""
    def P(x: np.ndarray) -> np.ndarray:
        z = (x - L["mu"]) @ L["W50"]
        k = int(np.argmin(((L["C"] - z) ** 2).sum(axis=1)))
        off = (z - L["C"][k]) @ L["local_W"][k] * L["local_s"][k]
        norm = np.linalg.norm(off)
        if norm > 1.5 * L["rho"][k]:  # an outlying query stays on the island's rim
            off *= 1.5 * L["rho"][k] / norm
        return (L["centre"][k] + off) * L["s"]
    return P


def load_labels(ent: dict[str, int]) -> tuple[dict[str, str], dict[str, list[str]]]:
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
    return label, gene_symbol


def unmapped_label(u: dict) -> str:
    """Levi's `unmapped` entries come as {target}, {proposal} or a bare {goal}."""
    if "target" in u:
        return u["target"].get("symbol", "?")
    goal = (u.get("proposal") or u).get("goal", "unmapped proposal")
    return goal if len(goal) <= 60 else goal[:57] + "…"


def levi_profiles(snapshot: Path) -> list[dict]:
    """Levi's agents -> profiles of precomputed queries (anchor, formula, ranked top_k)."""
    out = []
    for slug, title in LEVI_AGENTS.items():
        d = snapshot / "handoff" / slug
        if not (d / "trace.json").exists():
            print(f"warning: {d} has no trace.json; agent skipped", file=sys.stderr)
            continue
        trace = json.loads((d / "trace.json").read_text(encoding="utf-8"))
        ranking = json.loads((d / "ranking.json").read_text(encoding="utf-8"))
        out.append({"lane": len(out), "name": title, "agent": slug, "rankType": ranking.get("rank_type"),
                    "queries": trace.get("queries") or [], "top_k": ranking.get("top_k") or [],
                    "unresolved": [unmapped_label(u) for u in trace.get("unmapped") or []]})
    return out


def parse_formula(formula: str, E: np.ndarray, R: np.ndarray, ent: dict, rel: dict) -> np.ndarray:
    """'e[X] - r[A] + r[B]' -> e[X] - r[A] + r[B], with Levi's exact relation names."""
    m = re.match(r"e\[(.+?)\]", formula)
    q = np.asarray(E[ent[m.group(1)]], dtype=np.float64).copy()
    for sign, name in re.findall(r"([+-])\s*r\[(.+?)\]", formula[m.end():]):
        q += (1 if sign == "+" else -1) * R[rel[name]]
    return q


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--profiles", type=Path, help="JSON list of {lane, name, targets}")
    src.add_argument("--from-levi", type=Path, help="Levi snapshot dir containing handoff/<agent>/")
    ap.add_argument("--out", type=Path, default=OUT / "scene.json")
    ap.add_argument("--relayout", action="store_true", help="rebuild layout + triple cache")
    args = ap.parse_args()
    t0 = time.time()
    OUT.mkdir(parents=True, exist_ok=True)

    ent = load_index(RAW / "embed" / "entities.tsv")
    rel = load_index(RAW / "embed" / "relations.tsv")
    names_by_row = sorted(ent, key=ent.get)
    rel_by_row = sorted(rel, key=rel.get)
    n = len(names_by_row)
    E = np.load(RAW / "embed" / "DRKG_TransE_l2_entity.npy", mmap_mode="r")
    R = np.load(RAW / "embed" / "DRKG_TransE_l2_relation.npy").astype(np.float64)
    assert E.shape == (n, 400), E.shape
    kinds = [name.split("::", 1)[0] for name in names_by_row]

    # --- cached: triples index, layout ------------------------------------------------
    relayout = args.relayout or not (CACHE / "layout.npz").exists() or not all((OUT / f).exists() for f in LAYOUT_BINS)
    H, Rr, T = load_triples(ent, rel, force=args.relayout)
    if relayout:
        L = build_layout(np.asarray(E, dtype=np.float64))
        np.savez(CACHE / "layout.npz", **{k: v for k, v in L.items() if k not in ("labels", "pts")})
        counts = collections.Counter(kinds).most_common()
        type_index = {k: i for i, (k, _) in enumerate(counts)}
        degree = (np.bincount(H, minlength=n) + np.bincount(T, minlength=n)).astype("<u4")
        (OUT / "points.bin").write_bytes(L["pts"].tobytes())
        (OUT / "types.bin").write_bytes(np.asarray([type_index[k] for k in kinds], np.uint8).tobytes())
        (OUT / "clusters.bin").write_bytes(L["labels"].tobytes())
        (OUT / "degree.bin").write_bytes(degree.tobytes())
    else:
        L = dict(np.load(CACHE / "layout.npz"))
    pts = np.frombuffer((OUT / "points.bin").read_bytes(), "<f4").reshape(-1, 3)
    clusters_of = np.frombuffer((OUT / "clusters.bin").read_bytes(), np.uint8)
    degree = np.frombuffer((OUT / "degree.bin").read_bytes(), "<u4")
    P = placer(L)
    type_counts = collections.Counter(kinds).most_common()

    # --- names ------------------------------------------------------------------------
    label, gene_symbol = load_labels(ent)
    if relayout:  # hover labels: GO terms are long and nobody hovers them at an expo
        hover = {str(ent[k]): v for k, v in label.items()
                 if k.split("::", 1)[0] not in {"Biological Process", "Molecular Function", "Cellular Component"}}
        (OUT / "names.json").write_text(json.dumps(hover, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # --- clusters: labelled by composition only, no invented biology -------------------
    plural = lambda t: "ATC codes" if t == "Atc" else t + ("es" if t.endswith("s") else "s")
    sizes = np.bincount(clusters_of, minlength=K_CLUSTERS)
    clusters = []
    for k in range(K_CLUSTERS):
        c = collections.Counter(kinds[i] for i in np.flatnonzero(clusters_of == k))
        top = [{"name": t, "share": round(v / sizes[k], 3)} for t, v in c.most_common(3)]
        shown = [t for t in top if t["share"] >= 0.1][:2] or top[:1]
        clusters.append({"id": k, "size": int(sizes[k]), "dominantType": top[0]["name"], "topTypes": top,
                         "label": " · ".join(f"{plural(t['name'])} {round(t['share'] * 100)}%" for t in shown)})

    # --- graph helpers over the cached triples -----------------------------------------
    is_compound = np.asarray([k == "Compound" for k in kinds])

    def compound_neighbours(row: int) -> dict[int, list[str]]:
        """compound row -> relation names, for every edge between `row` and a compound."""
        out: dict[int, list[str]] = collections.defaultdict(list)
        for side, other in ((H == row, T), (T == row, H)):
            idx = np.flatnonzero(side)
            for o, r_ in zip(other[idx], Rr[idx]):
                if is_compound[o]:
                    out[int(o)].append(rel_by_row[r_])
        return out

    def als_edge(row: int) -> str | None:
        a = ent[ALS]
        idx = np.flatnonzero(((H == row) & (T == a)) | ((H == a) & (T == row)))
        return rel_by_row[Rr[idx[0]]] if len(idx) else None

    def edges_for(row: int, nb: dict[int, list[str]], match_rows: set[int], dist_of) -> list[dict]:
        ranked = sorted(nb, key=lambda c: (c not in match_rows, names_by_row[c] not in label, dist_of(c), c))
        keep = [c for c in ranked if c in match_rows or names_by_row[c] in label][:EDGE_CAP]
        return [{"from": row, "to": c, "rel": RELATION if RELATION in nb[c] else nb[c][0]} for c in keep]

    uni_rows = np.asarray([i for i, k in enumerate(names_by_row) if UNIVERSE.match(k)])
    U = np.asarray(E[uni_rows], dtype=np.float64)
    uni_pos = {int(r_): i for i, r_ in enumerate(uni_rows)}
    name_of = lambda row: label.get(names_by_row[row], names_by_row[row].split("::", 1)[1])

    scene_profiles: list[dict] = []
    hand_out: list[dict] = []
    if args.from_levi:
        # --- Levi's agents: his anchors, his formulas, his ranks; our vectors as the check
        for p in levi_profiles(args.from_levi):
            genes, qvecs = [], []
            for q in p["queries"]:
                a = ent[q["anchor"]]
                qv = parse_formula(q["formula"], E, R, ent, rel)
                qvecs.append(qv)
                genes.append({"symbol": q.get("anchor_label") or name_of(a), "id": q["anchor"], "row": a,
                              "pos": r3(pts[a]), "query": r3(P(qv)), "formula": q["formula"],
                              "targetEdges": int(((H == a) & is_compound[T]).sum() + ((T == a) & is_compound[H]).sum()),
                              "alsEdge": als_edge(a)})
            matches = []
            for m in sorted(p["top_k"], key=lambda m: m["rank"])[:TOP_K]:
                c = ent[m["id"]]
                ours = float(np.linalg.norm(np.asarray(E[c], np.float64) - qvecs[m["query"]]))
                assert abs(ours - m["l2"]) < 1e-3, f"{p['agent']} {m['id']}: Levi l2 {m['l2']} vs ours {ours}"
                anchor = ent[p["queries"][m["query"]]["anchor"]]
                matches.append({"rank": m["rank"], "id": m["id"], "row": c, "name": name_of(c), "pos": r3(pts[c]),
                                "distance": round(m["l2"], 3), "viaGene": genes[m["query"]]["symbol"],
                                "directEdge": c in compound_neighbours(anchor)})
            match_rows = {m["row"] for m in matches}
            edges = []
            for q, g in zip(p["queries"], genes):
                if any(e["from"] == g["row"] for e in edges):
                    continue  # several queries can share one anchor
                edges += edges_for(g["row"], compound_neighbours(g["row"]), match_rows, lambda c: 0)
                for h_, r_, t_ in q.get("derivation") or []:  # multi-hop witness, e.g. gene -> GO process
                    edges.append({"from": ent[h_], "to": ent[t_], "rel": r_})
            scene_profiles.append({"lane": p["lane"], "name": p["name"], "agent": p["agent"],
                                   "rankType": p["rankType"], "genes": genes, "unresolved": p["unresolved"],
                                   "matches": matches, "edges": edges})
        projection_note = f"Levi snapshot {args.from_levi.as_posix()}"
    else:
        # --- profiles: target genes -> e[gene] - r[target] -> L2 over Compound::DB* -----
        if args.profiles:
            profiles, hand = json.loads(args.profiles.read_text(encoding="utf-8")), []
        else:
            profiles, hand = parse_pipeline()
        r_target = R[rel[RELATION]]
        profile_rank: dict[int, dict[int, tuple[int, float]]] = {}
        for p in profiles:
            genes_rows, unresolved = [], []
            for raw in p["targets"]:
                sym = re.sub(r"\s*\(.*?\)", "", raw).strip()  # "RET (GDNF)" -> RET
                if sym in ent and sym.startswith("Gene::"):
                    genes_rows.append(ent[sym])
                    continue
                hits = [h for h in gene_symbol.get(sym.upper(), []) if h in ent]
                if len(hits) == 1:
                    genes_rows.append(ent[hits[0]])
                else:
                    unresolved.append(sym)
            if not genes_rows:
                scene_profiles.append({"lane": p["lane"], "name": p["name"], "genes": [],
                                       "unresolved": unresolved, "matches": [], "edges": []})
                continue
            D = np.stack([np.linalg.norm(U - (np.asarray(E[g], np.float64) - r_target), axis=1) for g in genes_rows])
            best, via = D.min(axis=0), D.argmin(axis=0)
            order_ = np.argsort(best, kind="stable")
            profile_rank[p["lane"]] = {int(uni_rows[i]): (r_ + 1, float(best[i])) for r_, i in enumerate(order_)}
            nbs = {g: compound_neighbours(g) for g in genes_rows}
            matches = []
            for r_, i in enumerate(order_[:TOP_K]):
                c, g = int(uni_rows[i]), genes_rows[via[i]]
                matches.append({"rank": r_ + 1, "id": names_by_row[c], "row": c, "name": name_of(c),
                                "pos": r3(pts[c]), "distance": round(float(best[i]), 3),
                                "viaGene": name_of(g), "directEdge": c in nbs[g]})
            match_rows = {m["row"] for m in matches}
            edges = []
            for gi, g in enumerate(genes_rows):
                edges += edges_for(g, nbs[g], match_rows, lambda c, gi=gi: D[gi][uni_pos[c]] if c in uni_pos else 1e9)
            scene_profiles.append({
                "lane": p["lane"], "name": p["name"],
                "genes": [{"symbol": name_of(g), "id": names_by_row[g], "row": g, "pos": r3(pts[g]),
                           "query": r3(P(np.asarray(E[g], np.float64) - r_target)),
                           "targetEdges": sum(len(v) for v in nbs[g].values()), "alsEdge": als_edge(g)}
                          for g in genes_rows],
                "unresolved": unresolved, "matches": matches, "edges": edges,
            })

        # --- where the hand-written drugs land (default profiles only: lanes must match)
        by_name: dict[str, str] = {}
        by_first_word: dict[str, str] = {}  # "Somatropin recombinant" is how DRKG names somatropin
        for k, v in label.items():
            if k.startswith("Compound::"):
                by_name.setdefault(v.lower(), k)
                by_first_word.setdefault(v.lower().split(" ")[0], k)
        for drug, lane, source in hand:
            cid = by_name.get(drug.lower()) or by_first_word.get(drug.lower())
            rank_, dist = profile_rank.get(lane, {}).get(ent[cid], (None, None)) if cid else (None, None)
            hand_out.append({"drug": drug, "lane": lane, "source": source, "id": cid, "rank": rank_,
                             "distance": None if dist is None else round(dist, 3)})
        projection_note = "profiles " + (args.profiles.as_posix() if args.profiles else "pipeline.ts PROFILES")

    scene = {
        "meta": {
            "model": "DRKG pretrained TransE_l2, 400d", "entities": n,
            "projection": (f"Clustered layout: k-means (k={K_CLUSTERS}) on PCA-{PCA_DIMS} of the 400-d vectors; "
                           "islands placed by PCA-3 of the centroids, points by per-cluster local PCA-3. "
                           "Not distance-preserving."),
            "explainedVariance": None,
            "relation": "per query (see genes[].formula)" if args.from_levi else RELATION,
            "formula": ("q rebuilt from each Levi query formula; d = ‖e[c] − q‖₂ in 400-d; ranks are Levi's"
                        if args.from_levi else
                        "q = e[gene] − r[target]; d(c) = ‖e[c] − q‖₂ in 400-d; profile distance = min over its genes"),
            "source": projection_note,
            "universe": len(uni_rows), "topK": TOP_K,
            "degree": {"min": int(degree.min()), "median": int(np.median(degree)),
                       "p99": int(np.percentile(degree, 99)), "max": int(degree.max())},
        },
        "types": [{"name": k, "count": c} for k, c in type_counts],
        "clusters": clusters,
        "als": {"id": ALS, "row": ent[ALS], "pos": r3(pts[ent[ALS]]), "label": "Amyotrophic Lateral Sclerosis"},
        "profiles": scene_profiles,
        "handWritten": hand_out,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(scene, ensure_ascii=False, indent=1), encoding="utf-8")

    # --- check (runnable, fails loudly if the maths or the wiring breaks) ---------------
    assert len(pts) == n and len(clusters_of) == n and len(degree) == n and sizes.sum() == n
    assert degree.sum() == 2 * len(H), "degree.bin is stale against the triples cache"
    for sp in scene_profiles:  # every query point lands inside the drawn scene
        for g in sp["genes"]:
            assert np.linalg.norm(g["query"]) < 15, g
    il6r = next((g for g in gene_symbol.get("IL6R", []) if g in ent), None)
    if il6r and not args.from_levi:
        nb = compound_neighbours(ent[il6r])
        known = [c for c, rels in nb.items() if RELATION in rels and c in uni_pos]
        d = np.linalg.norm(U - (np.asarray(E[ent[il6r]], np.float64) - R[rel[RELATION]]), axis=1)
        rank_of = {int(uni_rows[i]): r_ + 1 for r_, i in enumerate(np.argsort(d))}
        best_known = min(rank_of[c] for c in known)
        assert best_known <= 300, f"IL6R's own DrugBank targets rank no better than {best_known}"
        print(f"check: IL6R's DrugBank-target compounds best rank {best_known}/{len(uni_rows)} "
              f"({', '.join(name_of(c) for c in known)})")

    # --- summary ----------------------------------------------------------------------
    print(f"{'relayout' if relayout else 'cached layout'} · {projection_note} · universe {len(uni_rows)}")
    if relayout:
        for cl in clusters:
            print(f"   cluster {cl['id']:2}  {cl['size']:6}  {cl['label']}")
        for i in np.argsort(degree)[::-1][:5]:
            print(f"   hub {name_of(i)[:40]:40} {names_by_row[i]:32} {degree[i]}")
    for sp in scene_profiles:
        print(f"\n[{sp['lane']}] {sp['name']}  genes {[(g['symbol'], g['targetEdges'], g['alsEdge']) for g in sp['genes']]}"
              f"  unresolved {sp['unresolved']}  edges drawn {len(sp['edges'])}")
        for m in sp["matches"]:
            print(f"   {m['rank']}. {m['name'][:30]:30} d={m['distance']:7.3f}  via {m['viaGene'][:14]:14} direct={m['directEdge']}")
    if hand_out:
        print("\nhand-written drugs, rank within their lane's profile:")
        for h in hand_out:
            print(f"   {h['source']:10} lane {h['lane']} {h['drug']:12} {h['id'] or 'NOT IN DRKG/names':22} "
                  f"rank {h['rank']}  d={h['distance']}")
    print(f"\nwrote {args.out}  ({args.out.stat().st_size / 1024:.1f} KB)  runtime {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
