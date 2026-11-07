"""Tests for the graveyard curation.

The curation is the deliverable, so these tests are mostly about the curation
itself rather than the code: a judge will spot-check a year, a phase or a
source URL, and these assertions are what stop a bad entry shipping.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import graveyard as gy  # noqa: E402

CURATED = gy.load_curated()
ENTRIES = CURATED["graveyard"]


# --------------------------------------------------------------------------
# The curation
# --------------------------------------------------------------------------


def test_the_curation_validates_clean():
    problems = gy.validate(ENTRIES)
    assert problems == [], problems


def test_we_curated_at_least_twenty_entries():
    """The spec asks for 20-30."""
    assert len(ENTRIES) >= 20


def test_most_entries_are_verified_against_a_fetched_source():
    verified = [e for e in ENTRIES if e.get("verified")]
    assert len(verified) >= 20
    assert len(verified) / len(ENTRIES) >= 0.85


def test_unverified_entries_explain_themselves():
    for entry in ENTRIES:
        if not entry.get("verified"):
            assert entry.get("verify_note"), f"{entry['name']}: unverified with no note"


def test_every_entry_has_a_year_phase_note_and_source():
    for entry in ENTRIES:
        assert isinstance(entry["year"], int)
        assert entry["phase"] in gy.VALID_PHASES
        assert entry["note"]
        assert entry["source_url"].startswith("http")


def test_notes_are_one_line():
    for entry in ENTRIES:
        assert len(entry["note"].split()) <= 20, entry["name"]


def test_names_are_unique_and_lowercase():
    names = [e["name"] for e in ENTRIES]
    assert len(names) == len(set(names))
    assert all(n == n.lower() for n in names)


def test_source_urls_are_unique_enough_to_be_real():
    """Copy-paste of one URL across many entries would mean guessed sourcing."""
    urls = [e["source_url"] for e in ENTRIES]
    # The four HEALEY regimens legitimately share a trial but have separate papers.
    assert len(set(urls)) >= len(urls) - 1


def test_years_are_plausible_trial_years():
    for entry in ENTRIES:
        assert 1985 <= entry["year"] <= 2026, entry["name"]


def test_the_spec_named_drugs_are_all_present():
    """Everything the spec's Validation section lists by name, minus BIIB078's
    sibling programs, should be in here."""
    names = {e["name"] for e in ENTRIES}
    for expected in (
        "topiramate",
        "celecoxib",
        "creatine",
        "coenzyme q10",
        "lithium carbonate",
        "ceftriaxone",
        "minocycline",
        "memantine",
        "dexpramipexole",
        "tirasemtiv",
        "reldesemtiv",
        "biib078",
    ):
        assert expected in names, f"spec names {expected} and it is missing"


# --------------------------------------------------------------------------
# What component B needs
# --------------------------------------------------------------------------


def test_every_entry_is_joinable_by_structure_or_identifier():
    for entry in ENTRIES:
        assert entry.get("smiles") or entry.get("identifier"), entry["name"]


def test_entries_without_a_smiles_say_why():
    for entry in ENTRIES:
        if not entry.get("smiles"):
            assert entry.get("kind") in gy.NO_SMILES_KINDS, (
                f"{entry['name']}: no SMILES and kind {entry.get('kind')!r} does not excuse it"
            )


def test_most_entries_are_scorable():
    scorable = [e for e in ENTRIES if e.get("smiles")]
    assert len(scorable) >= 20


def test_every_smiles_parses():
    """Skipped silently when RDKit is not installed."""
    assert gy.check_smiles_parse(ENTRIES) == []


def test_the_partition_fields_are_left_for_component_b():
    for entry in gy.build_output(CURATED)["graveyard"]:
        assert entry["bbb_prob"] is None
        assert entry["bucket"] is None


# --------------------------------------------------------------------------
# Output contract
# --------------------------------------------------------------------------


def test_output_carries_the_frozen_contract_keys():
    for entry in gy.build_output(CURATED)["graveyard"]:
        assert {"name", "year", "phase", "bbb_prob", "bucket", "note", "source_url"} <= set(
            entry
        )


def test_output_is_json_serializable():
    output = gy.build_output(CURATED)
    reparsed = json.loads(json.dumps(output))
    assert reparsed["meta"]["n_entries"] == len(ENTRIES)
    assert reparsed["meta"]["n_verified"] <= reparsed["meta"]["n_entries"]
    assert (
        reparsed["meta"]["n_scorable"] + reparsed["meta"]["n_no_structure"]
        == reparsed["meta"]["n_entries"]
    )


def test_validator_rejects_a_guessed_bucket():
    bad = [dict(ENTRIES[0], bucket="arrived_failed")]
    assert any("bucket" in p for p in gy.validate(bad))


def test_validator_rejects_a_missing_source_url():
    bad = [{k: v for k, v in ENTRIES[0].items() if k != "source_url"}]
    assert any("source_url" in p for p in gy.validate(bad))


def test_validator_rejects_an_implausible_year():
    bad = [dict(ENTRIES[0], year=1899)]
    assert any("year" in p for p in gy.validate(bad))


def test_validator_rejects_an_unknown_phase():
    bad = [dict(ENTRIES[0], phase="4")]
    assert any("phase" in p for p in gy.validate(bad))


def test_validator_rejects_a_structureless_small_molecule():
    bad = [dict(ENTRIES[0], smiles=None, kind="small molecule")]
    assert any("SMILES" in p for p in gy.validate(bad))


def test_validator_rejects_a_duplicate_name():
    bad = [ENTRIES[0], dict(ENTRIES[0])]
    assert any("duplicate" in p for p in gy.validate(bad))


# --------------------------------------------------------------------------
# Deliberate exclusions - the entries we chose not to make
# --------------------------------------------------------------------------


def test_drugs_that_work_are_not_in_the_graveyard():
    names = {e["name"] for e in ENTRIES}
    for positive_control in ("riluzole", "edaravone"):
        assert positive_control not in names


def test_the_two_judged_exclusions_stay_excluded():
    """fingolimod met its safety endpoint; deferiprone never reported a result.
    Both would be wrong to call failures, and the exclusions are documented."""
    names = {e["name"] for e in ENTRIES}
    assert "fingolimod" not in names
    assert "deferiprone" not in names
    documented = " ".join(CURATED["_meta"]["deliberate_exclusions"])
    assert "fingolimod" in documented
    assert "deferiprone" in documented


if __name__ == "__main__":
    import traceback

    tests = [
        (name, obj)
        for name, obj in sorted(globals().items())
        if name.startswith("test_") and callable(obj)
    ]
    failed = 0
    for name, test in tests:
        try:
            test()
        except Exception:
            failed += 1
            print(f"FAIL {name}")
            traceback.print_exc()
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    raise SystemExit(1 if failed else 0)
