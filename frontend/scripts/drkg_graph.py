"""Precompute the browsable DRKG graph: every entity's id, label, capped neighbour list,
per-relation triple counts and 10 nearest same-type neighbours, sharded for lazy loading.

    python frontend/scripts/drkg_graph.py        # ~1-2 min, writes frontend/public/drkg/graph/

Needs the raw release in data/raw/drkg/ (see drkg_scene.py) and its triples cache
(data/raw/drkg/cache/triples.npz, built by drkg_scene.py on first run). Reads the committed
types.bin / degree.bin / names.json / scene.json; never rewrites them.

Output (frontend/public/drkg/graph/), little-endian:
    index.json        version, counts, shardSize, edgeCap, knnK, relations[], types[], externalUrl{}
    ids.txt           line i = DRKG id of entity row i
    names-extra.json  {row: label} for labelled rows NOT in ../names.json: Hetionet names (GO terms...)
                      plus MeSH labels for Disease::MESH / Compound::MESH ids, fetched once from the
                      NLM MeSH SPARQL endpoint into data/raw/drkg/cache/mesh_labels.json (offline: cache
                      only, or none)
    shard-NNN.bin     rows [NNN*1024, ...):
        u32 header[8] = magic 0x314B4744, firstRow, rowCount, nEdges, nRelCounts, knnK, 0, 0
        u32 edgeOffsets[rowCount+1], u32 edges[nEdges]  nbr | rel<<17 | outgoing<<24
        u32 relOffsets[rowCount+1],  u32 relCounts[...] rel<<24 | count (desc by count)
        u32 knnRows[rowCount*knnK],  f32 knnDist[rowCount*knnK]

Edges per entity: duplicates (nbr, rel, dir) removed, a self-loop kept once (as outgoing),
capped at edgeCap by round-robin over that entity's relations (source priority by relation-name
prefix DRUGBANK, Hetionet, INTACT, STRING, DGIDB, bioarx, GNBR, then relIdx; the glossary spells
three of them differently, so it is not used for ranking) and, within a relation,
neighbour degree desc. relCounts count raw triple incidences, so they sum to degree.bin
(a self-loop counts twice there, as in degree.bin). kNN = true 400-d L2 within the type.
"""

from __future__ import annotations

import csv
import json
import re
import sys
import time
import urllib.parse
import urllib.request

import numpy as np

from drkg_scene import CACHE, OUT, RAW, load_index, load_labels, load_triples

GRAPH = OUT / "graph"
SHARD = 1024
KNN_K = 10
BUDGET = 20_200_000  # bytes for all of graph/ (~20 MB; holds edgeCap 44 with the MeSH labels)
CAPS = tuple(range(16, 513, 4))
MAGIC = 0x314B4744
SOURCES = ["DRUGBANK", "Hetionet", "INTACT", "STRING", "DGIDB", "bioarx", "GNBR"]
EXTERNAL_URL = {  # longest prefix wins; {id} = the part after the prefix
    "Compound::DB": "https://go.drugbank.com/drugs/DB{id}",
    "Compound::CHEMBL": "https://www.ebi.ac.uk/chembl/compound_report_card/CHEMBL{id}/",
    "Compound::CHEBI:": "https://www.ebi.ac.uk/chebi/searchId.do?chebiId=CHEBI:{id}",
    "Compound::MESH:": "https://meshb.nlm.nih.gov/record/ui?ui={id}",
    "Gene::": "https://www.ncbi.nlm.nih.gov/gene/{id}",
    "Gene::drugbank:": "https://go.drugbank.com/bio_entities/{id}",
    "Gene::NVA": "",  # DRKG-internal gene ids: no external record
    "Gene::NH": "",
    "Disease::MESH:": "https://meshb.nlm.nih.gov/record/ui?ui={id}",
    "Disease::DOID:": "http://purl.obolibrary.org/obo/DOID_{id}",
    "Disease::OMIM:": "https://omim.org/entry/{id}",
    "Symptom::": "https://meshb.nlm.nih.gov/record/ui?ui={id}",
    "Anatomy::UBERON:": "http://purl.obolibrary.org/obo/UBERON_{id}",
    "Biological Process::GO:": "https://amigo.geneontology.org/amigo/term/GO:{id}",
    "Molecular Function::GO:": "https://amigo.geneontology.org/amigo/term/GO:{id}",
    "Cellular Component::GO:": "https://amigo.geneontology.org/amigo/term/GO:{id}",
    "Atc::": "https://atcddd.fhi.no/atc_ddd_index/?code={id}",
    "Tax::": "https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?id={id}",
}


def mesh_labels(ids: list[str]) -> dict[str, str]:
    """MeSH id (D000544 / C059514) -> label from NLM's SPARQL endpoint, cached; fail-soft offline."""
    path = CACHE / "mesh_labels.json"
    have = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    todo = sorted(set(ids) - set(have) - set(have.get("__missing__", [])))
    q = ("PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> PREFIX mesh: <http://id.nlm.nih.gov/mesh/> "
         "SELECT ?d ?l FROM <http://id.nlm.nih.gov/mesh> WHERE { VALUES ?d { %s } ?d rdfs:label ?l }")
    try:
        for a in range(0, len(todo), 300):
            batch = todo[a:a + 300]
            url = "https://id.nlm.nih.gov/mesh/sparql?" + urllib.parse.urlencode(
                {"query": q % " ".join("mesh:" + i for i in batch), "format": "JSON", "limit": 1000})
            for b in json.load(urllib.request.urlopen(url, timeout=60))["results"]["bindings"]:
                have[b["d"]["value"].rsplit("/", 1)[1]] = b["l"]["value"]
            have["__missing__"] = sorted(set(have.get("__missing__", [])) | (set(batch) - set(have)))
    except OSError as e:  # offline: keep whatever is cached
        print(f"warning: MeSH labels not fetched ({e}); {len(todo)} ids stay unlabelled", file=sys.stderr)
    if todo:
        path.write_text(json.dumps(have, ensure_ascii=False, indent=0), encoding="utf-8")
    return {k: v for k, v in have.items() if k != "__missing__"}


def knn_within(E: np.ndarray, rows: np.ndarray, k: int, chunk: int = 256) -> tuple[np.ndarray, np.ndarray]:  # d2 = chunk x typeSize f32
    """k nearest rows (global index) by 400-d L2 among `rows`, self excluded by index.
    Candidates from the float32 expansion, then distances recomputed exactly by difference."""
    X = np.ascontiguousarray(E[rows], dtype=np.float32)
    sq = (X * X).sum(axis=1)
    m = min(k + 6, len(rows) - 1)  # a few spares so expansion error can't drop a true neighbour
    out_r = np.empty((len(rows), k), np.int64)
    out_d = np.empty((len(rows), k), np.float32)
    for a in range(0, len(rows), chunk):
        b = min(a + chunk, len(rows))
        d2 = sq[a:b, None] + sq[None, :] - 2 * (X[a:b] @ X.T)
        d2[np.arange(b - a), np.arange(a, b)] = np.inf
        cand = np.argpartition(d2, m, axis=1)[:, :m]
        exact = np.sqrt(((X[cand] - X[a:b, None, :]).astype(np.float64) ** 2).sum(axis=2))
        o = np.argsort(exact, axis=1, kind="stable")[:, :k]
        out_r[a:b] = rows[np.take_along_axis(cand, o, axis=1)]
        out_d[a:b] = np.take_along_axis(exact, o, axis=1)
    return out_r, out_d


def main() -> int:
    t0 = time.time()
    ent = load_index(RAW / "embed" / "entities.tsv")
    rel = load_index(RAW / "embed" / "relations.tsv")
    ids = sorted(ent, key=ent.get)
    rel_names = sorted(rel, key=rel.get)
    n, nr = len(ids), len(rel_names)
    assert n < 1 << 17 and nr < 1 << 7, (n, nr)
    H, Rr, T = (a.astype(np.int64) for a in load_triples(ent, rel, force=False))
    types_of = np.frombuffer((OUT / "types.bin").read_bytes(), np.uint8)
    degree = np.frombuffer((OUT / "degree.bin").read_bytes(), "<u4").astype(np.int64)
    scene = json.loads((OUT / "scene.json").read_text(encoding="utf-8"))
    names = json.loads((OUT / "names.json").read_text(encoding="utf-8"))
    type_names = [t["name"] for t in scene["types"]]
    assert all(type_names[types_of[i]] == ids[i].split("::", 1)[0] for i in range(n)), "types.bin stale"
    assert (degree == np.bincount(H, minlength=n) + np.bincount(T, minlength=n)).all(), "degree.bin stale"
    GRAPH.mkdir(parents=True, exist_ok=True)

    # --- relations --------------------------------------------------------------------
    gloss = {r["Relation-name"].strip(): r for r in
             csv.DictReader((RAW / "relation_glossary.tsv").open(encoding="utf-8"), delimiter="\t")}
    rel_count = np.bincount(Rr, minlength=nr)
    relations, mismatched = [], []
    for i, name in enumerate(rel_names):
        head, tail = name.split("::")[-1].split(":")[-2:]
        g = gloss[name]
        relations.append({"name": name, "source": g["Data-source"].strip(), "label": g["Interaction-type"].strip(),
                          "head": head, "tail": tail, "count": int(rel_count[i])})
        sel = np.flatnonzero(Rr == i)[:2000]
        if not ((types_of[H[sel]] == type_names.index(head)).all() and (types_of[T[sel]] == type_names.index(tail)).all()):
            mismatched.append(name)
    prefix = [r["name"].split("::")[0] for r in relations]  # glossary says HETIONET / IntAct / BIBLIOGRAPHY
    src_rank = np.asarray([SOURCES.index(p) if p in SOURCES else len(SOURCES) for p in prefix])
    assert set(SOURCES) <= set(prefix), set(SOURCES) - set(prefix)

    # --- relCounts: raw incidences (sum == degree.bin by construction) ----------------
    inc = np.bincount(np.concatenate([H * 128 + Rr, T * 128 + Rr]), minlength=n * 128)
    nz = np.flatnonzero(inc)
    rc_ent, rc_rel, rc_cnt = nz // 128, nz % 128, inc[nz]
    o = np.lexsort((rc_rel, -rc_cnt, rc_ent))
    rc_ent, rc_rel, rc_cnt = rc_ent[o], rc_rel[o], rc_cnt[o]
    assert rc_cnt.max() < 1 << 24
    rc_packed = (rc_rel << 24 | rc_cnt).astype("<u4")
    rel_off = np.concatenate([[0], np.cumsum(np.bincount(rc_ent, minlength=n))])

    # --- edges: dedup, self-loop once, round-robin cap --------------------------------
    loop = H == T
    e_ent = np.concatenate([H, T[~loop]])
    e_nbr = np.concatenate([T, H[~loop]])
    e_rel = np.concatenate([Rr, Rr[~loop]])
    e_out = np.concatenate([np.ones(len(H), np.int64), np.zeros((~loop).sum(), np.int64)])
    key = np.unique(e_ent << 32 | e_nbr | e_rel << 17 | e_out << 24)
    e_ent, packed = key >> 32, key & 0xFFFFFFFF
    e_nbr, e_rel = packed & 0x1FFFF, packed >> 17 & 0x7F
    dup_removed, n_unique = len(e_out) - len(key), len(key)
    o = np.lexsort((e_nbr, -degree[e_nbr], e_rel, e_ent))  # within (entity, rel): nbr degree desc
    e_ent, e_rel, packed = e_ent[o], e_rel[o], packed[o]
    grp = e_ent * 128 + e_rel
    start = np.flatnonzero(np.r_[True, grp[1:] != grp[:-1]])
    pos = np.arange(len(grp)) - np.repeat(start, np.diff(np.r_[start, len(grp)]))
    o = np.lexsort((e_rel, src_rank[e_rel], pos, e_ent))  # round-robin: rank k of every relation, then k+1
    e_ent, packed = e_ent[o], packed[o]
    ent_start = np.searchsorted(e_ent, np.arange(n))
    slot = np.arange(len(e_ent)) - ent_start[e_ent]
    uniq_deg = np.bincount(e_ent, minlength=n)

    # --- names-extra, ids --------------------------------------------------------------
    label, _ = load_labels(ent)
    extra = {str(ent[k]): v for k, v in label.items() if str(ent[k]) not in names}
    mesh_rows = [i for i in range(n) if re.fullmatch(r"[^:]+::MESH:[CD]\d+", ids[i])  # 17 "a|MESH:b" ids skipped
                 and str(i) not in names and str(i) not in extra]
    mesh = mesh_labels([ids[i].split("::MESH:", 1)[1] for i in mesh_rows])
    n_het = len(extra)
    for i in mesh_rows:
        if (m := mesh.get(ids[i].split("::MESH:", 1)[1])):
            extra[str(i)] = m
    ids_bytes = "\n".join(ids).encode("utf-8")
    extra_bytes = json.dumps(extra, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    # --- edgeCap: largest that keeps graph/ within BUDGET ------------------------------
    shards = -(-n // SHARD)
    fixed = (len(ids_bytes) + len(extra_bytes) + 30_000  # + index.json
             + shards * 4 * (8 + 2) + 4 * 2 * n + 4 * len(rc_packed) + 8 * KNN_K * n)
    size_at = {c: fixed + 4 * int(np.minimum(uniq_deg, c).sum()) for c in CAPS}
    cap = max([c for c in CAPS if size_at[c] <= BUDGET] or [CAPS[0]])
    keep = slot < cap
    k_ent, k_edges = e_ent[keep], packed[keep].astype("<u4")
    edge_off = np.concatenate([[0], np.cumsum(np.bincount(k_ent, minlength=n))])
    del key, packed, e_ent, e_nbr, e_rel, e_out, grp, pos, slot, keep, inc, o  # ~1 GB back before kNN

    # --- kNN per type ------------------------------------------------------------------
    t_knn = time.time()
    E = np.load(RAW / "embed" / "DRKG_TransE_l2_entity.npy", mmap_mode="r")
    knn_r = np.empty((n, KNN_K), np.int64)
    knn_d = np.empty((n, KNN_K), np.float32)
    for ti in range(len(type_names)):
        rows = np.flatnonzero(types_of == ti)
        assert len(rows) > KNN_K, type_names[ti]
        knn_r[rows], knn_d[rows] = knn_within(E, rows, KNN_K)
    t_knn = time.time() - t_knn

    # --- write ---------------------------------------------------------------------------
    for old in GRAPH.glob("shard-*.bin"):
        old.unlink()
    for s in range(shards):
        a, b = s * SHARD, min(n, (s + 1) * SHARD)
        eo = edge_off[a:b + 1] - edge_off[a]
        ro = rel_off[a:b + 1] - rel_off[a]
        hdr = np.asarray([MAGIC, a, b - a, eo[-1], ro[-1], KNN_K, 0, 0], "<u4")
        parts = [hdr, eo.astype("<u4"), k_edges[edge_off[a]:edge_off[b]], ro.astype("<u4"),
                 rc_packed[rel_off[a]:rel_off[b]], knn_r[a:b].astype("<u4").ravel(), knn_d[a:b].astype("<f4").ravel()]
        (GRAPH / f"shard-{s:03d}.bin").write_bytes(b"".join(p.tobytes() for p in parts))
    (GRAPH / "ids.txt").write_bytes(ids_bytes)
    (GRAPH / "names-extra.json").write_bytes(extra_bytes)
    index = {"version": 1, "entities": n, "triples": len(H), "shardSize": SHARD, "shards": shards,
             "edgeCap": cap, "knnK": KNN_K, "knnScope": "same entity type, 400-d L2",
             "relations": relations, "types": scene["types"], "externalUrl": EXTERNAL_URL}
    (GRAPH / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    # --- check: decode the written bytes independently --------------------------------
    def read_shard(s: int) -> dict:
        buf = (GRAPH / f"shard-{s:03d}.bin").read_bytes()
        u = np.frombuffer(buf, "<u4")
        magic, first, cnt, ne, nrc, kk = (int(x) for x in u[:6])
        assert magic == MAGIC and kk == KNN_K
        p = 8
        eo = u[p:p + cnt + 1]; p += cnt + 1
        ed = u[p:p + ne]; p += ne
        ro = u[p:p + cnt + 1]; p += cnt + 1
        rcs = u[p:p + nrc]; p += nrc
        kr = u[p:p + cnt * kk].reshape(cnt, kk); p += cnt * kk
        kd = np.frombuffer(buf, "<f4", offset=p * 4, count=cnt * kk).reshape(cnt, kk); p += cnt * kk
        assert p * 4 == len(buf)
        return {"first": first, "cnt": cnt, "eo": eo, "ed": ed, "ro": ro, "rc": rcs, "kr": kr, "kd": kd}

    triple_key = np.unique(H << 40 | Rr << 20 | T)
    rng = np.random.default_rng(7)
    checked = 0
    for s in (0, shards // 2, shards - 1):
        sh = read_shard(s)
        assert sh["first"] == s * SHARD and sh["eo"][-1] == len(sh["ed"])
        for li in rng.choice(sh["cnt"], 40, replace=False):
            row = sh["first"] + li
            ed = sh["ed"][sh["eo"][li]:sh["eo"][li + 1]].astype(np.int64)
            nb, rl, out = ed & 0x1FFFF, ed >> 17 & 0x7F, ed >> 24 & 1
            hh, tt = np.where(out == 1, row, nb), np.where(out == 1, nb, row)
            q = hh << 40 | rl << 20 | tt
            at = np.searchsorted(triple_key, q).clip(max=len(triple_key) - 1)
            assert (triple_key[at] == q).all(), f"row {row}: stored edge is not a triple"  # (a)
            assert len(ed) == min(uniq_deg[row], cap) and len(np.unique(ed)) == len(ed)
            rc = sh["rc"][sh["ro"][li]:sh["ro"][li + 1]]
            assert int((rc & 0xFFFFFF).sum()) == degree[row], f"row {row}: relCounts != degree"  # (b)
            assert (np.diff((rc & 0xFFFFFF).astype(np.int64)) <= 0).all()
            checked += 1
        for li in rng.choice(sh["cnt"], 10, replace=False):  # (c) brute force, float64
            row = sh["first"] + li
            same = np.flatnonzero(types_of == types_of[row])
            d = np.sqrt(((np.asarray(E[same], np.float64) - np.asarray(E[row], np.float64)) ** 2).sum(axis=1))
            d[same == row] = np.inf
            o = np.argsort(d, kind="stable")[:KNN_K]
            assert np.allclose(sh["kd"][li], d[o], atol=1e-4), f"row {row}: knn distances"
            untied = np.r_[np.diff(d[o]) > 1e-4, True] & np.r_[True, np.diff(d[o]) > 1e-4]
            assert (sh["kr"][li][untied] == same[o][untied]).all(), f"row {row}: knn rows"
    assert sum(1 for _ in GRAPH.glob("shard-*.bin")) == shards
    assert ids_bytes.count(b"\n") == n - 1 and not ids_bytes.endswith(b"\n")

    # --- summary -------------------------------------------------------------------------
    sizes = {p.name: p.stat().st_size for p in GRAPH.iterdir()}
    shard_sizes = [v for k, v in sizes.items() if k.startswith("shard-")]
    total = sum(sizes.values())
    name_of = lambda r: names.get(str(r)) or extra.get(str(r)) or ids[r]
    print(f"edgeCap {cap}: largest of {CAPS[0]}..{CAPS[-1]} step 4 with graph/ <= {BUDGET / 1e6:.1f} MB "
          f"(estimate {size_at[cap] / 1e6:.2f} MB; next {next((c for c in CAPS if c > cap), None)} -> "
          f"{size_at.get(next((c for c in CAPS if c > cap), cap), 0) / 1e6:.2f} MB)")
    print(f"edges: {len(H) * 2 - loop.sum():,} incidences -> {n_unique:,} unique ({dup_removed:,} dups, "
          f"{loop.sum():,} self-loop triples kept once) -> {len(k_edges):,} stored; "
          f"{(uniq_deg > cap).sum():,} entities capped ({(uniq_deg > cap).mean():.1%})")
    print(f"relCounts entries {len(rc_packed):,}; relations whose sampled triples disagree with name types: {mismatched or 'none'}")
    print(f"total graph/ {total / 1e6:.2f} MB ({total:,} B) · index.json {sizes['index.json']:,} · ids.txt "
          f"{sizes['ids.txt']:,} · names-extra.json {sizes['names-extra.json']:,} · {shards} shards "
          f"min {min(shard_sizes):,} max {max(shard_sizes):,}")
    print(f"names-extra adds {len(extra):,} labels ({n_het:,} Hetionet, {len(extra) - n_het:,} of {len(mesh_rows):,} "
          f"unlabelled MeSH ids from NLM; names.json has {len(names):,}); unlabelled rows "
          f"{n - len(names) - len(extra):,}")
    print(f"check: {checked} entities edges/relCounts, 30 knn brute-force OK · knn {t_knn:.1f}s · runtime {time.time() - t0:.1f}s")
    top_of = lambda t: ids[max(np.flatnonzero(types_of == type_names.index(t)), key=lambda r: degree[r])]
    for ident in ("Disease::MESH:D000690", "Gene::3480", "Compound::DB00945", top_of("Biological Process"), top_of("Side Effect")):
        row = ent[ident]
        sh = read_shard(row // SHARD)
        li = row - sh["first"]
        rc = sh["rc"][sh["ro"][li]:sh["ro"][li + 1]][:3]
        ed = sh["ed"][sh["eo"][li]:sh["eo"][li + 1]][:3]
        print(f"\n  {name_of(row)} ({ident}) degree {degree[row]:,}")
        print("    relCounts " + "; ".join(f"{relations[x >> 24]['label']} [{relations[x >> 24]['name']}] {x & 0xFFFFFF}" for x in rc))
        print("    edges     " + "; ".join(f"{'->' if x >> 24 & 1 else '<-'} {name_of(x & 0x1FFFF)} ({relations[x >> 17 & 0x7F]['label']})" for x in ed))
        print("    knn       " + "; ".join(f"{name_of(r)} {d:.3f}" for r, d in zip(sh["kr"][li][:3], sh["kd"][li][:3])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
