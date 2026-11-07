#!/usr/bin/env python3
"""The graveyard: drugs that failed a human ALS trial.

Hand-curated, because there is no database of "drugs that failed in ALS" to
download. Every entry carries a year, a phase, a one-line mechanism note and a
source URL that was actually fetched, because judges will check.

This module does two things:

1. Validates `data/graveyard_curated.json` - the curation is the deliverable,
   so the validator is strict about the fields a judge would look up.
2. Emits `data/graveyard.json` in the frozen `graveyard` contract shape for
   `merge.py`.

`bbb_prob` and `bucket` are left null here on purpose. Component B owns the
partition: it scores each entry's SMILES and splits the list into
`never_arrived` (predicted BBB-negative, so the trial may have been testing a
drug that could not reach the tissue) and `arrived_failed` (predicted
BBB-positive, so the biology was wrong rather than the delivery). Writing a
guess into those fields here would corrupt the headline result.

Usage:
    python graveyard.py                 # validate and emit
    python graveyard.py --check         # validate only, non-zero exit on error
    python graveyard.py --stats         # curation coverage summary
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent
CURATED = REPO_ROOT / "data" / "graveyard_curated.json"
OUTPUT = REPO_ROOT / "data" / "graveyard.json"

VALID_PHASES = {"1", "1/2", "2", "2/3", "3"}

# Entries with no practical SMILES - oligonucleotides, proteins, nanocrystal
# suspensions. Component B must refuse to score these rather than guess, which
# is the applicability-domain behaviour the spec asks for. They still belong in
# the graveyard; they just cannot enter the partition.
NO_SMILES_KINDS = {"oligonucleotide", "protein", "biologic", "nanocrystal", "cell therapy"}


def load_curated() -> dict[str, Any]:
    if not CURATED.exists():
        raise SystemExit(f"missing {CURATED}")
    return json.loads(CURATED.read_text())


def validate(entries: list[dict[str, Any]]) -> list[str]:
    """Return a list of problems. Empty list means the curation is clean."""
    problems: list[str] = []
    seen: set[str] = set()

    for i, entry in enumerate(entries):
        where = f"[{i}] {entry.get('name', '<unnamed>')}"

        name = entry.get("name")
        if not name or not isinstance(name, str):
            problems.append(f"{where}: missing name")
            continue
        if name in seen:
            problems.append(f"{where}: duplicate name")
        seen.add(name)

        year = entry.get("year")
        if not isinstance(year, int) or not 1985 <= year <= 2026:
            problems.append(f"{where}: year {year!r} is not a plausible trial year")

        phase = entry.get("phase")
        if phase not in VALID_PHASES:
            problems.append(f"{where}: phase {phase!r} not in {sorted(VALID_PHASES)}")

        note = entry.get("note")
        if not note or not isinstance(note, str):
            problems.append(f"{where}: missing note")
        elif len(note.split()) > 20:
            problems.append(f"{where}: note is {len(note.split())} words, keep it to one line")

        url = entry.get("source_url")
        if not url or not isinstance(url, str) or not url.startswith("http"):
            problems.append(f"{where}: source_url {url!r} is not a URL")

        # Component B needs a structure or an explicit reason it cannot have one.
        kind = entry.get("kind", "small molecule")
        if not entry.get("smiles") and kind not in NO_SMILES_KINDS:
            problems.append(
                f"{where}: no SMILES, and kind {kind!r} is not one that excuses it"
            )
        if not entry.get("smiles") and not entry.get("identifier"):
            problems.append(f"{where}: needs a SMILES or an identifier for component B")

        if entry.get("bucket") is not None:
            problems.append(f"{where}: bucket must stay null, component B assigns it")

    problems.extend(check_smiles_parse(entries))
    return problems


def check_smiles_parse(entries: list[dict[str, Any]]) -> list[str]:
    """Confirm every SMILES parses, if RDKit is importable.

    Component B cannot score a structure it cannot parse, so an unparseable
    SMILES here would silently shrink the partition. RDKit is optional for
    this module - the filter half of this repo has no third-party
    dependencies - so a missing RDKit is not an error.
    """
    try:
        from rdkit import Chem, RDLogger
    except ImportError:
        return []

    RDLogger.DisableLog("rdApp.*")
    problems = []
    for entry in entries:
        smiles = entry.get("smiles")
        if smiles and Chem.MolFromSmiles(smiles) is None:
            problems.append(f"{entry['name']}: RDKit cannot parse its SMILES")
    return problems


def to_contract(entry: dict[str, Any]) -> dict[str, Any]:
    """One graveyard entry in the frozen `pipeline.json` shape.

    The contract's five keys come first, then the fields component B and the
    UI need: the structure to score, the identifier to join on, the trial name
    a judge can look up, and the verification flag.
    """
    return {
        "name": entry["name"],
        "year": entry["year"],
        "phase": entry["phase"],
        "bbb_prob": None,
        "bucket": None,
        "note": entry["note"],
        "source_url": entry["source_url"],
        "smiles": entry.get("smiles"),
        "identifier": entry.get("identifier"),
        "kind": entry.get("kind", "small molecule"),
        "trial_name": entry.get("trial_name"),
        "verified": bool(entry.get("verified")),
        "verify_note": entry.get("verify_note"),
        "context": entry.get("note_extra"),
    }


def build_output(curated: dict[str, Any]) -> dict[str, Any]:
    entries = curated["graveyard"]
    contract = [to_contract(e) for e in entries]
    scorable = [e for e in contract if e["smiles"]]

    return {
        "meta": {
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "module": "graveyard.py",
            "n_entries": len(contract),
            "n_verified": sum(1 for e in contract if e["verified"]),
            "n_scorable": len(scorable),
            "n_no_structure": len(contract) - len(scorable),
            "year_range": [
                min(e["year"] for e in contract),
                max(e["year"] for e in contract),
            ],
            "phases": dict(sorted(Counter(e["phase"] for e in contract).items())),
            "partition_owner": "bbb_model.py (component B) fills bbb_prob and bucket",
            "curation": curated.get("_meta", {}),
        },
        "graveyard": contract,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="validate only")
    parser.add_argument("--stats", action="store_true", help="print a coverage summary")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args(argv)

    curated = load_curated()
    entries = curated["graveyard"]

    problems = validate(entries)
    if problems:
        print(f"{len(problems)} problem(s) in {CURATED}:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        return 1

    output = build_output(curated)
    meta = output["meta"]

    if args.stats or args.check:
        print(f"{meta['n_entries']} entries, {meta['n_verified']} verified against a source")
        print(f"  years {meta['year_range'][0]}-{meta['year_range'][1]}")
        print(f"  phases {meta['phases']}")
        print(f"  {meta['n_scorable']} have a SMILES component B can score")
        print(f"  {meta['n_no_structure']} have no practical structure (out of domain)")
        if args.check:
            return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n")
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
