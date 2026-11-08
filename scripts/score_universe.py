"""Score every KG compound with the trained BBB model, then run the patient filter.

Does not invent chart-derived annotations. Overlay is the hand-annotated sample
file (matched by name / InChIKey, never by a colliding DrugBank id) plus the
CYP1A2 / respiratory hand-lists already inside patient_filter.py. Missing
fields stay missing so those rules report themselves as not enforced.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from bbb.featurize import UnparseableSmilesError
from bbb.model import load_model
from src.patient_filter import build_output

KG = ROOT / "data" / "kg_scores.json"
ANNOT = ROOT / "data" / "drug_annotations.sample.json"
GRAVEYARD = ROOT / "data" / "graveyard.json"
BBB_OUT = ROOT / "data" / "bbb_scores.json"
PF_OUT = ROOT / "data" / "patient_filter.json"
METRICS = ROOT / "artifacts" / "bbb_metrics.json"
B3CLF = ROOT / "artifacts" / "b3clf_comparison.json"


def _index_annotations(drugs: list[dict]) -> dict[str, dict]:
    idx: dict[str, dict] = {}
    for d in drugs:
        name = str(d.get("name") or "").strip().lower()
        if name:
            idx[f"name:{name}"] = d
        key = d.get("inchikey")
        if key:
            idx[f"inchi:{key}"] = d
    return idx


def _overlay(kg: dict, annot_idx: dict, bbb: dict | None) -> dict:
    rec = {
        "id": kg.get("drugbank_id") or kg.get("id"),
        "name": kg.get("name"),
        "inchikey": kg.get("inchikey"),
        "smiles": kg.get("smiles"),
        "target_compartment": kg.get("target_compartment"),
    }
    annot = None
    if kg.get("inchikey"):
        annot = annot_idx.get(f"inchi:{kg['inchikey']}")
    if annot is None and kg.get("name"):
        annot = annot_idx.get(f"name:{str(kg['name']).strip().lower()}")
    if annot:
        merged = {k: v for k, v in annot.items() if k != "_meta"}
        merged["id"] = annot.get("id") or rec["id"]
        merged["name"] = annot.get("name") or rec["name"]
        merged["inchikey"] = rec.get("inchikey") or annot.get("inchikey")
        merged["smiles"] = rec.get("smiles") or annot.get("smiles")
        merged["target_compartment"] = annot.get("target_compartment") or rec.get("target_compartment")
        rec = merged
    if bbb:
        rec["bbb"] = {
            "prob": bbb.get("prob"),
            "in_domain": bbb.get("in_domain"),
        }
    return rec


def _score_one(model, smi: str) -> tuple[dict | None, str | None]:
    try:
        p = model.predict(smi)
    except UnparseableSmilesError as exc:
        return None, str(exc)
    except Exception as exc:
        return None, str(exc)
    return (
        {
            "prob": p.prob,
            "in_domain": p.in_domain,
            "nearest_tanimoto": p.nearest_tanimoto,
            "descriptors": p.descriptors,
            "domain_reason": p.domain_reason,
            "call": p.call,
        },
        None,
    )


def main() -> int:
    kg_doc = json.loads(KG.read_text(encoding="utf-8"))
    compounds = kg_doc.get("compounds") or []
    annot_doc = json.loads(ANNOT.read_text(encoding="utf-8"))
    annot_idx = _index_annotations(annot_doc.get("drugs") or [])
    gy_doc = json.loads(GRAVEYARD.read_text(encoding="utf-8")) if GRAVEYARD.exists() else {}
    gy_rows = gy_doc.get("graveyard") or gy_doc.get("entries") or []

    print(f"loading BBB model for {len(compounds)} KG compounds", flush=True)
    model = load_model()
    t0 = time.time()
    candidates = []
    by_inchi: dict[str, dict] = {}
    by_name: dict[str, dict] = {}
    n_ok = n_ood = n_fail = n_nosmi = 0
    for i, kg in enumerate(compounds, 1):
        smi = kg.get("smiles")
        row = {
            "name": kg.get("name"),
            "inchikey": kg.get("inchikey"),
            "id": kg.get("drugbank_id"),
            "smiles": smi,
            "rank": kg.get("rank"),
        }
        if not smi:
            row["scorable"] = False
            row["bbb"] = None
            n_nosmi += 1
        else:
            block, err = _score_one(model, smi)
            if block is None:
                row["scorable"] = False
                row["bbb"] = None
                row["error"] = err
                n_fail += 1
            else:
                row["scorable"] = True
                row["bbb"] = {
                    "prob": block["prob"],
                    "in_domain": block["in_domain"],
                    "nearest_tanimoto": block["nearest_tanimoto"],
                    "descriptors": block["descriptors"],
                    "domain_reason": block["domain_reason"],
                }
                row["detail"] = {"call": block["call"], "domain_reason": block["domain_reason"]}
                n_ok += 1
                if not block["in_domain"]:
                    n_ood += 1
        candidates.append(row)
        if row.get("inchikey") and row.get("bbb"):
            by_inchi[row["inchikey"]] = row["bbb"]
        if row.get("name") and row.get("bbb"):
            by_name[str(row["name"]).strip().lower()] = row["bbb"]
        if i % 200 == 0 or i == len(compounds):
            print(
                f"  bbb {i}/{len(compounds)}  ok={n_ok} ood={n_ood} "
                f"fail={n_fail} nosmiles={n_nosmi}  {time.time() - t0:.1f}s",
                flush=True,
            )

    graveyard = []
    for g in gy_rows:
        smi = g.get("smiles")
        row = {k: g[k] for k in ("name", "year", "phase", "note", "smiles", "source_url", "inchikey") if k in g}
        block = None
        if smi:
            block, err = _score_one(model, smi)
            if err:
                row["error"] = err
        if block is None and g.get("name"):
            block = by_name.get(str(g["name"]).strip().lower())
        if block:
            row["scorable"] = True
            row["bbb"] = {
                "prob": block.get("prob"),
                "in_domain": block.get("in_domain"),
                "nearest_tanimoto": block.get("nearest_tanimoto"),
                "descriptors": block.get("descriptors"),
                "domain_reason": block.get("domain_reason"),
            }
            if block.get("in_domain") and (block.get("prob") or 0) >= 0.5:
                row["bucket"] = "arrived_failed"
            elif block.get("in_domain"):
                row["bucket"] = "never_arrived"
            else:
                row["bucket"] = "undetermined"
        else:
            row["scorable"] = False
            row["bbb"] = None
            row["bucket"] = "undetermined"
        graveyard.append(row)

    part = {
        "never_arrived": [g for g in graveyard if g.get("bucket") == "never_arrived"],
        "arrived_failed": [g for g in graveyard if g.get("bucket") == "arrived_failed"],
        "undetermined": [g for g in graveyard if g.get("bucket") == "undetermined"],
    }
    counts = {k: len(v) for k, v in part.items()}
    metrics = json.loads(METRICS.read_text(encoding="utf-8")) if METRICS.exists() else {}
    b3clf = json.loads(B3CLF.read_text(encoding="utf-8")) if B3CLF.exists() else None
    BBB_OUT.write_text(
        json.dumps(
            {
                "meta": {
                    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "candidate_source": "data/kg_scores.json",
                    "graveyard_source": "data/graveyard.json",
                    "n_input": len(compounds),
                    "n_scored": n_ok,
                    "n_out_of_domain": n_ood,
                    "n_unparseable": n_fail,
                    "n_no_smiles": n_nosmi,
                },
                "model": {
                    "scaffold_split": metrics.get("scaffold_split", {}).get("summary"),
                    "random_split_contrast": metrics.get("random_split", {}).get("summary"),
                    "b3clf_comparison": b3clf,
                },
                "summary": {
                    "n_candidates_in_domain": n_ok - n_ood,
                    "n_candidates_out_of_domain": n_ood,
                    "graveyard_partition": counts,
                },
                "candidates": candidates,
                "graveyard": graveyard,
                "graveyard_partition": {"counts": counts, "members": {k: [x.get("name") for x in v] for k, v in part.items()}},
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"wrote {BBB_OUT}  scored={n_ok} ood={n_ood} graveyard={counts}", flush=True)

    pf_inputs = [_overlay(kg, annot_idx, by_inchi.get(kg.get("inchikey") or "") or by_name.get(str(kg.get("name") or "").lower())) for kg in compounds]
    output = build_output(pf_inputs)
    PF_OUT.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    meta = output["meta"]
    print(
        f"wrote {PF_OUT} - {meta['n_input']} drugs, {meta['n_passed']} passed, "
        f"{meta['n_eliminated']} eliminated, top reason {output['top_reason']!r}",
        flush=True,
    )
    for rule, count in output["eliminated_by_rule"].items():
        if count:
            print(f"  {rule:<14} eliminated {count}", flush=True)
    print(f"elapsed {time.time() - t0:.1f}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
