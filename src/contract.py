"""Validator for the frozen `data/pipeline.json` contract.

Run it after any change to the merge step or the sample file:

    python -m src.contract              # checks data/pipeline.json
    python -m src.contract some.json

Exit code 0 means the file is contract-clean. Anything the frontend reads is
checked here, so a passing file is safe to render against.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from src.paths import PIPELINE_JSON

STAGES = ["universe", "kg_relevance", "bbb", "patient_filter", "trial_history"]
BUCKETS = {"never_arrived", "arrived_failed"}
FILTER_RULES = {
    "cyp1a2",
    "respiratory",
    "weight_loss",
    "myopathy",
    "swallow",
    "dexterity",
    "bbb_direction",
    "canada",
}


def _check(errors: list[str], cond: bool, msg: str) -> None:
    if not cond:
        errors.append(msg)


def validate(doc: dict) -> list[str]:
    errors: list[str] = []

    for key in ("meta", "funnel", "candidates", "graveyard", "validation"):
        _check(errors, key in doc, f"missing top-level key {key!r}")
    if errors:
        return errors

    meta = doc["meta"]
    _check(errors, isinstance(meta.get("generated_at"), str), "meta.generated_at must be a string")
    _check(errors, isinstance(meta.get("n_input"), int), "meta.n_input must be an int")
    _check(errors, isinstance(meta.get("patient"), str), "meta.patient must be a string")

    funnel = doc["funnel"]
    _check(errors, [s["stage"] for s in funnel] == STAGES, f"funnel stages must be exactly {STAGES}")
    for s in funnel:
        where = f"funnel[{s.get('stage')}]"
        _check(errors, isinstance(s.get("label"), str), f"{where}.label must be a string")
        _check(errors, isinstance(s.get("count"), int), f"{where}.count must be an int")
        _check(errors, isinstance(s.get("eliminated"), int), f"{where}.eliminated must be an int")
        _check(errors, "top_reason" in s, f"{where}.top_reason missing (null is allowed)")

    seen_eliminated_at = set()
    for i, c in enumerate(doc["candidates"]):
        where = f"candidates[{i}]"
        for key in ("id", "inchikey", "name", "smiles", "kg", "path", "bbb", "filters", "verdict"):
            _check(errors, key in c, f"{where} missing {key!r}")
        if errors:
            continue
        _check(errors, isinstance(c["kg"].get("score"), (int, float)), f"{where}.kg.score must be numeric")
        _check(errors, isinstance(c["kg"].get("rank"), int), f"{where}.kg.rank must be an int")

        bbb = c["bbb"]
        _check(errors, isinstance(bbb.get("in_domain"), bool), f"{where}.bbb.in_domain must be a bool")
        _check(errors, "prob" in bbb and "nearest_tanimoto" in bbb, f"{where}.bbb needs prob and nearest_tanimoto")
        _check(errors, isinstance(bbb.get("descriptors"), dict), f"{where}.bbb.descriptors must be an object")

        _check(errors, isinstance(c["filters"], list), f"{where}.filters must be an ordered list, not a map")
        for f in c["filters"]:
            _check(errors, f.get("rule") in FILTER_RULES, f"{where} unknown filter rule {f.get('rule')!r}")
            _check(errors, isinstance(f.get("passed"), bool), f"{where} filter {f.get('rule')!r} needs a bool passed")
            _check(errors, bool(f.get("reason")), f"{where} filter {f.get('rule')!r} needs a reason string")

        _check(errors, "eliminated_at" in c, f"{where} missing eliminated_at (null when it survived)")
        if c["verdict"] == "eliminated":
            _check(
                errors,
                c.get("eliminated_at") in STAGES,
                f"{where} is eliminated so eliminated_at must name a stage",
            )
            seen_eliminated_at.add(c.get("eliminated_at"))
        else:
            _check(errors, c.get("eliminated_at") is None, f"{where} survived so eliminated_at must be null")

    _check(errors, bool(seen_eliminated_at), "no eliminated candidate; the UI needs at least one to animate")

    for i, g in enumerate(doc["graveyard"]):
        where = f"graveyard[{i}]"
        for key in ("name", "year", "phase", "bbb_prob", "bucket", "note", "source_url"):
            _check(errors, key in g, f"{where} missing {key!r}")
        _check(errors, g.get("bucket") in BUCKETS, f"{where}.bucket must be one of {sorted(BUCKETS)}")

    v = doc["validation"]
    for key in (
        "riluzole_rank",
        "edaravone_rank",
        "bbb_roc_auc",
        "bbb_roc_auc_published_baseline",
        "negatives_in_top_50",
        "partition",
    ):
        _check(errors, key in v, f"validation missing {key!r}")
    if isinstance(v.get("partition"), dict):
        _check(errors, set(v["partition"]) == BUCKETS, f"validation.partition keys must be {sorted(BUCKETS)}")

    return errors


def main(argv: list[str]) -> int:
    path = Path(argv[1]) if len(argv) > 1 else PIPELINE_JSON
    doc = json.loads(path.read_text())
    errors = validate(doc)
    if errors:
        print(f"{path}: {len(errors)} contract violation(s)")
        for e in errors:
            print(f"  - {e}")
        return 1
    print(
        f"{path}: contract OK "
        f"({len(doc['candidates'])} candidates, {len(doc['graveyard'])} graveyard rows)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
