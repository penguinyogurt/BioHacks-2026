"""The InChIKey crosswalk between DRKG, DrugCentral and B3DB.

The three sources do not share an identifier: DRKG uses DrugBank / MeSH / ChEBI ids on
its compound nodes, B3DB ships SMILES, DrugCentral has its own integer struct_ids. The
crosswalk is keyed on an InChIKey that we compute ourselves with RDKit from a
standardized structure, so the same molecule lands on the same key in all three.

**Never join on names.** Drug synonymy is a swamp - salts, stereoisomers, brand names,
hydrates - and name matching silently loses half the drugs while confidently matching a
few of the wrong ones.

DRKG compound nodes carry no structure at all, so they cannot be keyed directly. They
join through DrugCentral's `identifier` table, which maps its struct_ids to DrugBank,
ChEBI and MeSH ids. That is still an id-to-id join, not a name join.

Two tiers of key, both emitted:

- `inchikey` - the full 27-character key. Exact match: same connectivity, same
  stereochemistry, same protonation.
- `inchikey_skeleton` - the first 14-character block, which encodes connectivity only.
  Matches across stereoisomers and charge states. Used as a fallback tier and reported
  separately, because a skeleton match is a weaker claim than an exact one.

Run it:

    python -m src.crosswalk

Writes artifacts/crosswalk.csv and artifacts/crosswalk_coverage.json. Both are small and
committed, so no other module needs to re-run this or re-download anything.
"""

from __future__ import annotations

import collections
import csv
import gzip
import json
import subprocess
import sys
from pathlib import Path
from typing import Iterator

from rdkit import Chem, RDLogger
from rdkit.Chem.MolStandardize import rdMolStandardize

from src import drkg
from src.paths import ARTIFACTS, RAW, ensure_dirs

RDLogger.DisableLog("rdApp.*")

B3DB_URL = "https://raw.githubusercontent.com/theochem/B3DB/main/B3DB/B3DB_classification.tsv"
DRUGCENTRAL_DUMP_URL = (
    "https://unmtid-dbs.net/download/DrugCentral/2027/db_dump/drugcentral.dump.09022026.sql.gz"
)

B3DB_TSV = RAW / "B3DB_classification.tsv"
DRUGCENTRAL_DUMP = RAW / "drugcentral.dump.09022026.sql.gz"

CROSSWALK_CSV = ARTIFACTS / "crosswalk.csv"
COVERAGE_JSON = ARTIFACTS / "crosswalk_coverage.json"

_CHOOSER = rdMolStandardize.LargestFragmentChooser()
_UNCHARGER = rdMolStandardize.Uncharger()

# DrugCentral id_type -> the prefix that turns its value into a DRKG node name.
# CHEBI values already carry their own "CHEBI:" prefix, DrugBank values are bare.
_ID_TYPE_TO_DRKG_PREFIX = {
    "DRUGBANK_ID": "Compound::",
    "CHEBI": "Compound::",
    "MESH_DESCRIPTOR_UI": "Compound::MESH:",
    "MESH_SUPPLEMENTAL_RECORD_UI": "Compound::MESH:",
}

FIELDNAMES = [
    "inchikey",
    "inchikey_skeleton",
    "smiles",
    "drugcentral_id",
    "drugcentral_name",
    "drkg_ids",
    "drugbank_ids",
    "in_drkg",
    "in_drugcentral",
    "in_b3db",
    "b3db_label",
    "b3db_logbb",
]


def download() -> None:
    ensure_dirs()
    if not B3DB_TSV.exists():
        print(f"downloading B3DB -> {B3DB_TSV}", file=sys.stderr)
        subprocess.run(["curl", "-sS", "-L", "-o", str(B3DB_TSV), B3DB_URL], check=True)
    if not DRUGCENTRAL_DUMP.exists():
        print(f"downloading DrugCentral dump (~2 GB) -> {DRUGCENTRAL_DUMP}", file=sys.stderr)
        subprocess.run(
            ["curl", "-sS", "-L", "-o", str(DRUGCENTRAL_DUMP), DRUGCENTRAL_DUMP_URL], check=True
        )


def standard_inchikey(smiles: str) -> str | None:
    """Standardize, then compute the InChIKey. One code path for every source.

    Largest-fragment first so a hydrochloride and its free base agree, then uncharge so a
    carboxylate and its acid agree. If two sources standardize differently the whole
    crosswalk is quietly wrong, so this function is the only place structures are keyed.
    """
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    try:
        mol = _CHOOSER.choose(mol)
        mol = rdMolStandardize.Cleanup(mol)
        mol = _UNCHARGER.uncharge(mol)
        key = Chem.MolToInchiKey(mol)
    except Exception:
        return None
    return key or None


def canonical_smiles(smiles: str) -> str | None:
    mol = Chem.MolFromSmiles(smiles)
    return Chem.MolToSmiles(mol) if mol is not None else None


def iter_pg_copy(path: Path, table: str) -> Iterator[dict[str, str]]:
    """Stream one table out of a plain-text pg_dump, without a database.

    Reads the `COPY public.<table> (cols) FROM stdin;` header so column order comes from
    the dump rather than from an assumption about the release.
    """
    opener = gzip.open if path.suffix == ".gz" else open
    marker = f"COPY public.{table} ("
    with opener(path, "rt", encoding="utf-8", errors="replace") as fh:
        columns: list[str] | None = None
        for line in fh:
            if columns is None:
                if line.startswith(marker):
                    columns = [
                        c.strip().strip('"')
                        for c in line[len(marker) :].split(")", 1)[0].split(",")
                    ]
                continue
            if line.startswith("\\."):
                return
            values = line.rstrip("\n").split("\t")
            if len(values) != len(columns):
                continue
            yield {c: (None if v == "\\N" else v) for c, v in zip(columns, values)}


def load_drugcentral() -> tuple[dict[int, dict], dict[int, dict[str, list[str]]]]:
    """(struct_id -> structure row, struct_id -> {id_type: [external ids]})."""
    structures: dict[int, dict] = {}
    for row in iter_pg_copy(DRUGCENTRAL_DUMP, "structures"):
        smiles = row.get("smiles")
        if not smiles:
            continue
        structures[int(row["id"])] = {"smiles": smiles, "name": row.get("name") or ""}
    if not structures:
        raise RuntimeError(f"no structures parsed out of {DRUGCENTRAL_DUMP}")

    identifiers: dict[int, dict[str, list[str]]] = collections.defaultdict(
        lambda: collections.defaultdict(list)
    )
    for row in iter_pg_copy(DRUGCENTRAL_DUMP, "identifier"):
        id_type = row.get("id_type")
        value = row.get("identifier")
        struct_id = row.get("struct_id")
        if not (id_type and value and struct_id):
            continue
        if id_type in _ID_TYPE_TO_DRKG_PREFIX:
            identifiers[int(struct_id)][id_type].append(value)
    return structures, identifiers


def load_b3db() -> dict[str, dict]:
    """InChIKey -> {label, logbb}, computed from B3DB's SMILES, not its Inchi column."""
    out: dict[str, dict] = {}
    with B3DB_TSV.open(newline="") as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            key = standard_inchikey(row["SMILES"])
            if key is None:
                continue
            out.setdefault(
                key,
                {"label": (row.get("BBB+/BBB-") or "").strip(), "logbb": row.get("logBB") or ""},
            )
    return out


def build() -> dict:
    download()
    drkg.download()

    drkg_compounds = set(drkg.compound_nodes())
    structures, identifiers = load_drugcentral()
    b3db = load_b3db()

    rows: dict[str, dict] = {}
    unparseable = 0
    for struct_id, struct in structures.items():
        key = standard_inchikey(struct["smiles"])
        if key is None:
            unparseable += 1
            continue

        drkg_ids: set[str] = set()
        drugbank_ids: set[str] = set()
        for id_type, values in identifiers.get(struct_id, {}).items():
            prefix = _ID_TYPE_TO_DRKG_PREFIX[id_type]
            for value in values:
                node = f"{prefix}{value}"
                if node in drkg_compounds:
                    drkg_ids.add(node)
                if id_type == "DRUGBANK_ID":
                    drugbank_ids.add(value)

        b3db_hit = b3db.get(key)
        row = rows.setdefault(
            key,
            {
                "inchikey": key,
                "inchikey_skeleton": key.split("-")[0],
                "smiles": canonical_smiles(struct["smiles"]) or struct["smiles"],
                "drugcentral_id": str(struct_id),
                "drugcentral_name": struct["name"],
                "drkg_ids": set(),
                "drugbank_ids": set(),
                "in_drugcentral": 1,
                "in_b3db": 1 if b3db_hit else 0,
                "b3db_label": b3db_hit["label"] if b3db_hit else "",
                "b3db_logbb": b3db_hit["logbb"] if b3db_hit else "",
            },
        )
        row["drkg_ids"] |= drkg_ids
        row["drugbank_ids"] |= drugbank_ids

    for row in rows.values():
        row["in_drkg"] = 1 if row["drkg_ids"] else 0

    # B3DB compounds DrugCentral has never heard of. They are not candidates - the
    # universe is approved drugs - but E2 trains on them, so they belong in the table
    # with in_drugcentral = 0 rather than being dropped on the floor.
    for key, hit in b3db.items():
        if key in rows:
            continue
        rows[key] = {
            "inchikey": key,
            "inchikey_skeleton": key.split("-")[0],
            "smiles": "",
            "drugcentral_id": "",
            "drugcentral_name": "",
            "drkg_ids": set(),
            "drugbank_ids": set(),
            "in_drkg": 0,
            "in_drugcentral": 0,
            "in_b3db": 1,
            "b3db_label": hit["label"],
            "b3db_logbb": hit["logbb"],
        }

    ensure_dirs()
    with CROSSWALK_CSV.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDNAMES)
        writer.writeheader()
        for key in sorted(rows):
            row = dict(rows[key])
            row["drkg_ids"] = "|".join(sorted(row["drkg_ids"]))
            row["drugbank_ids"] = "|".join(sorted(row["drugbank_ids"]))
            writer.writerow({k: row[k] for k in FIELDNAMES})

    coverage = _coverage(rows, structures, b3db, drkg_compounds, unparseable)
    COVERAGE_JSON.write_text(json.dumps(coverage, indent=2) + "\n")
    return coverage


def _coverage(
    rows: dict[str, dict],
    structures: dict[int, dict],
    b3db: dict[str, dict],
    drkg_compounds: set[str],
    unparseable: int,
) -> dict:
    all_three = sum(1 for r in rows.values() if r["in_drkg"] and r["in_drugcentral"] and r["in_b3db"])
    drkg_and_dc = sum(1 for r in rows.values() if r["in_drkg"] and r["in_drugcentral"])
    dc_and_b3db = sum(1 for r in rows.values() if r["in_drugcentral"] and r["in_b3db"])
    mapped_drkg_nodes = {node for r in rows.values() for node in r["drkg_ids"]}
    drugbank_nodes = {n for n in drkg_compounds if n.startswith("Compound::DB")}

    skeletons = collections.defaultdict(set)
    for r in rows.values():
        skeletons[r["inchikey_skeleton"]].add(r["inchikey"])
    collisions = sum(1 for keys in skeletons.values() if len(keys) > 1)

    return {
        "rows": len(rows),
        "drugcentral_structures": len(structures),
        "drugcentral_unparseable_smiles": unparseable,
        "b3db_unique_structures": len(b3db),
        "drkg_compound_nodes": len(drkg_compounds),
        "drkg_drugbank_nodes": len(drugbank_nodes),
        "drkg_nodes_mapped_to_a_structure": len(mapped_drkg_nodes),
        "in_all_three": all_three,
        "in_drkg_and_drugcentral": drkg_and_dc,
        "in_drugcentral_and_b3db": dc_and_b3db,
        "in_drkg_and_drugcentral_not_b3db": sum(
            1 for r in rows.values() if r["in_drkg"] and not r["in_b3db"]
        ),
        "in_b3db_only": sum(1 for r in rows.values() if r["in_b3db"] and not r["in_drugcentral"]),
        "skeletons_with_multiple_full_keys": collisions,
    }


def load() -> list[dict]:
    """Read the cached crosswalk. This is what the other modules call."""
    with CROSSWALK_CSV.open(newline="") as fh:
        return list(csv.DictReader(fh))


def main() -> int:
    coverage = build()
    width = max(len(k) for k in coverage)
    for key, value in coverage.items():
        print(f"{key:{width}}  {value}")
    print(f"\nwrote {CROSSWALK_CSV}\nwrote {COVERAGE_JSON}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
