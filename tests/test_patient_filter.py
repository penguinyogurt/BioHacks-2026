"""Unit tests for the eight patient-filter rules.

Two things are being tested, and they matter about equally:

1. Each rule fires on the right trigger and stays quiet otherwise.
2. Each reason string names the chart line that justifies it. The reason
   strings are a judged artifact, not debug output, so a reason that stops
   citing the chart is a regression.

Run with `python -m pytest tests/ -q`, or `python tests/test_patient_filter.py`
if pytest is not installed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import patient_filter as pf  # noqa: E402

CHART = pf.ALEX_CHEN


def filters_for(**fields) -> dict[str, dict]:
    """Run all rules on a drug built from kwargs; return {rule: entry}."""
    base = {"name": "testdrug"}
    base.update(fields)
    return {entry["rule"]: entry for entry in pf.apply_patient_filter(base)}


def rule(rule_id: str, **fields) -> dict:
    """Run all rules on a drug built from kwargs; return one rule's entry."""
    return filters_for(**fields)[rule_id]


# --------------------------------------------------------------------------
# Contract
# --------------------------------------------------------------------------


def test_filters_is_an_ordered_list_matching_rule_order():
    entries = pf.apply_patient_filter({"name": "testdrug"})
    assert isinstance(entries, list)
    assert [e["rule"] for e in entries] == list(pf.RULE_ORDER)


def test_filter_entries_carry_exactly_the_frozen_keys():
    for entry in pf.apply_patient_filter({"name": "testdrug"}):
        assert set(entry) == {"rule", "passed", "reason"}
        assert isinstance(entry["passed"], bool)
        assert isinstance(entry["reason"], str) and entry["reason"]


def test_every_rule_in_the_spec_table_is_implemented():
    assert set(pf.RULES) == {
        "cyp1a2",
        "respiratory",
        "weight_loss",
        "myopathy",
        "swallow",
        "dexterity",
        "bbb_direction",
        "canada",
    }


def test_reasons_are_sentences_a_clinician_would_accept():
    """Full sentences, capitalized, terminated. No bare flags, no snake_case."""
    for entry in pf.apply_patient_filter({"name": "testdrug"}):
        reason = entry["reason"]
        assert reason[0].isupper(), f"{entry['rule']}: not capitalized"
        assert reason.rstrip().endswith("."), f"{entry['rule']}: no full stop"
        assert "_" not in reason, f"{entry['rule']}: leaked an identifier"
        assert len(reason.split()) >= 8, f"{entry['rule']}: too terse to be a sentence"


def test_first_failure_is_the_first_failing_rule_in_order():
    verdict = pf.evaluate(
        {
            "name": "testdrug",
            # fails respiratory (rule 2) and myopathy (rule 4)
            "atc_codes": ["N02AA01"],
            "adverse_events": ["myopathy"],
        }
    )
    assert verdict.passed is False
    assert verdict.first_failure == "respiratory"


def test_a_clean_drug_passes_all_eight():
    verdict = pf.evaluate(
        {
            "name": "testdrug",
            "cyp1a2": {"inhibitor": False, "inducer": False},
            "atc_codes": ["N04BD02"],
            "adverse_events": ["headache"],
            "formulations": ["oral solution"],
            "routes": ["oral"],
            "target_compartment": "cns",
            "bbb": {"prob": 0.9, "in_domain": True},
            "in_health_canada_dpd": True,
        }
    )
    assert verdict.passed is True
    assert verdict.first_failure is None


# --------------------------------------------------------------------------
# Rule 1: cyp1a2  (chart: riluzole 50 mg twice daily since July 2026)
# --------------------------------------------------------------------------


def test_cyp1a2_inhibitor_flag_disqualifies():
    entry = rule("cyp1a2", cyp1a2={"inhibitor": True, "strength": "strong"})
    assert entry["passed"] is False
    assert "inhibitor" in entry["reason"]
    assert "strong" in entry["reason"]


def test_cyp1a2_inducer_flag_disqualifies_and_explains_the_opposite_direction():
    entry = rule("cyp1a2", cyp1a2={"inducer": True})
    assert entry["passed"] is False
    assert "inducer" in entry["reason"]
    assert "down" in entry["reason"]


def test_cyp1a2_falls_back_to_the_hand_list_when_no_flag_is_supplied():
    assert rule("cyp1a2", name="fluvoxamine")["passed"] is False
    assert rule("cyp1a2", name="ciprofloxacin")["passed"] is False
    assert rule("cyp1a2", name="rifampicin")["passed"] is False
    assert rule("cyp1a2", name="acetaminophen")["passed"] is True


def test_cyp1a2_hand_list_is_the_promised_size_and_has_both_directions():
    assert len(pf.CYP1A2_INHIBITORS) >= 20
    assert len(pf.CYP1A2_INDUCERS) >= 10
    assert "strong" in pf.CYP1A2_INHIBITORS.values()
    assert "strong" in pf.CYP1A2_INDUCERS.values()


def test_cyp1a2_reason_names_his_riluzole_prescription():
    for entry in (
        rule("cyp1a2", name="fluvoxamine"),
        rule("cyp1a2", name="acetaminophen"),
    ):
        assert "riluzole" in entry["reason"]
        assert CHART.current_dose in entry["reason"]
        assert CHART.current_since in entry["reason"]


# --------------------------------------------------------------------------
# Rule 2: respiratory  (chart: FVC 76% sitting / 61% supine, CPF 310 L/min)
# --------------------------------------------------------------------------


def test_respiratory_catches_each_class_the_spec_names():
    for atc in ("N02AA01", "N05BA01", "N05CA02", "R06AA02"):
        assert rule("respiratory", atc_codes=[atc])["passed"] is False


def test_respiratory_catches_gabapentinoids():
    assert rule("respiratory", atc_codes=["N03AX12"])["passed"] is False
    assert rule("respiratory", name="pregabalin")["passed"] is False


def test_respiratory_matches_atc_by_prefix_not_exact_code():
    assert rule("respiratory", atc_codes=["N02AA05"])["passed"] is False


def test_respiratory_falls_back_to_names_without_an_atc_code():
    assert rule("respiratory", name="diazepam")["passed"] is False
    assert rule("respiratory", name="metformin")["passed"] is True


def test_respiratory_passes_an_unrelated_class():
    assert rule("respiratory", atc_codes=["C10AA01"])["passed"] is True


def test_respiratory_reason_quotes_his_supine_fvc():
    entry = rule("respiratory", name="morphine")
    assert entry["passed"] is False
    assert f"{CHART.fvc_supine_pct}%" in entry["reason"]
    assert str(CHART.cough_peak_flow_lpm) in entry["reason"]
    assert "Respiratory depressant" in entry["reason"]


# --------------------------------------------------------------------------
# Rule 3: weight_loss  (chart: 86 -> 77.5 kg, meals 35-40 min)
# --------------------------------------------------------------------------


def test_weight_loss_catches_meddra_terms():
    for term in ("weight decreased", "decreased appetite", "anorexia", "cachexia"):
        entry = rule("weight_loss", adverse_events=[term])
        assert entry["passed"] is False, term
        assert term in entry["reason"]


def test_weight_loss_passes_an_unrelated_adverse_event():
    assert rule("weight_loss", adverse_events=["headache"])["passed"] is True


def test_weight_loss_does_not_enforce_without_adverse_event_data():
    entry = rule("weight_loss")
    assert entry["passed"] is True
    assert "not enforced" in entry["reason"]


def test_weight_loss_reason_quotes_the_eight_and_a_half_kilos():
    entry = rule("weight_loss", adverse_events=["weight decreased"])
    assert "8.5 kg" in entry["reason"]
    assert "86 to 77.5 kg" in entry["reason"]
    assert CHART.meal_duration_min in entry["reason"]


# --------------------------------------------------------------------------
# Rule 4: myopathy  (chart: CK 470 U/L, reference ceiling 195)
# --------------------------------------------------------------------------


def test_myopathy_catches_statin_style_terms():
    for term in ("myopathy", "rhabdomyolysis", "blood creatine phosphokinase increased"):
        assert rule("myopathy", adverse_events=[term])["passed"] is False, term


def test_myopathy_passes_an_unrelated_adverse_event():
    assert rule("myopathy", adverse_events=["dry mouth"])["passed"] is True


def test_myopathy_does_not_enforce_without_adverse_event_data():
    assert "not enforced" in rule("myopathy")["reason"]


def test_myopathy_reason_quotes_his_ck_against_the_reference():
    entry = rule("myopathy", adverse_events=["rhabdomyolysis"])
    assert f"{CHART.ck_u_per_l} U/L" in entry["reason"]
    assert str(CHART.ck_reference_ceiling) in entry["reason"]


# --------------------------------------------------------------------------
# Rule 5: swallow  (chart: coughs on thin liquids)
# --------------------------------------------------------------------------


def test_swallow_accepts_every_form_he_can_manage():
    for form in (
        "oral film",
        "tablet, orally disintegrating",
        "tablet, dispersible",
        "oral solution",
        "oral suspension",
        "oral granules",
    ):
        entry = rule("swallow", formulations=[form], routes=["oral"])
        assert entry["passed"] is True, form


def test_swallow_rejects_a_plain_film_coated_tablet():
    entry = rule("swallow", formulations=["tablet, film coated"], routes=["oral"])
    assert entry["passed"] is False
    assert "wash a solid dose down" in entry["reason"]


def test_swallow_rejects_a_capsule_only_drug():
    assert rule("swallow", formulations=["capsule"], routes=["oral"])["passed"] is False


def test_swallow_accepts_a_small_tablet_but_says_it_must_go_in_puree():
    entry = rule(
        "swallow",
        formulations=["tablet"],
        routes=["oral"],
        smallest_tablet_mm=pf.SMALL_TABLET_MAX_MM,
    )
    assert entry["passed"] is True
    assert "puree" in entry["reason"]


def test_swallow_rejects_a_tablet_just_over_the_size_limit():
    entry = rule(
        "swallow",
        formulations=["tablet"],
        routes=["oral"],
        smallest_tablet_mm=pf.SMALL_TABLET_MAX_MM + 0.5,
    )
    assert entry["passed"] is False


def test_swallow_does_not_apply_to_a_parenteral_only_drug():
    entry = rule("swallow", formulations=["injection"], routes=["intravenous"])
    assert entry["passed"] is True
    assert "bypasses swallowing" in entry["reason"]


def test_swallow_does_not_enforce_without_formulation_data():
    assert "not enforced" in rule("swallow")["reason"]


def test_swallow_reason_names_the_water_swallow_finding():
    entry = rule("swallow", formulations=["tablet, film coated"], routes=["oral"])
    assert CHART.swallow_finding in entry["reason"]


def test_the_delivery_gap_riluzole_tablet_fails_where_the_film_passes():
    """The headline clinical finding, as a test rather than an assertion."""
    tablet = rule("swallow", formulations=["tablet, film coated"], routes=["oral"])
    film = rule("swallow", formulations=["oral film"], routes=["oral"])
    assert tablet["passed"] is False
    assert film["passed"] is True


# --------------------------------------------------------------------------
# Rule 6: dexterity  (chart: pinch 3 kg, grip 14 kg vs 48 typical)
# --------------------------------------------------------------------------


def test_dexterity_rejects_grip_actuated_and_self_injected_administration():
    for form in (
        "metered dose inhaler",
        "dry powder inhaler",
        "prefilled syringe",
        "autoinjector",
        "nasal spray",
    ):
        entry = rule("dexterity", formulations=[form])
        assert entry["passed"] is False, form


def test_dexterity_rejects_bare_subcutaneous_self_injection():
    assert rule("dexterity", routes=["subcutaneous"])["passed"] is False


def test_dexterity_allows_a_clinician_administered_route():
    entry = rule("dexterity", formulations=["prefilled syringe"], routes=["intravenous"])
    assert entry["passed"] is True


def test_dexterity_allows_a_transdermal_patch():
    assert rule("dexterity", formulations=["transdermal patch"])["passed"] is True


def test_dexterity_allows_a_plain_oral_form():
    assert rule("dexterity", formulations=["oral film"], routes=["oral"])["passed"] is True


def test_dexterity_reason_quotes_his_pinch_and_grip():
    entry = rule("dexterity", formulations=["metered dose inhaler"])
    assert "3 kg" in entry["reason"]
    assert "14 kg" in entry["reason"]
    assert "48 kg" in entry["reason"]
    assert CHART.dexterity_finding in entry["reason"]


# --------------------------------------------------------------------------
# Rule 7: bbb_direction  (signed, and counterintuitive)
# --------------------------------------------------------------------------


def test_bbb_direction_rejects_a_cns_target_that_cannot_cross():
    entry = rule(
        "bbb_direction", target_compartment="cns", bbb={"prob": 0.12, "in_domain": True}
    )
    assert entry["passed"] is False
    assert "cannot reach" in entry["reason"]


def test_bbb_direction_accepts_a_cns_target_that_crosses():
    entry = rule(
        "bbb_direction", target_compartment="cns", bbb={"prob": 0.91, "in_domain": True}
    )
    assert entry["passed"] is True


def test_bbb_direction_rejects_a_muscle_target_that_crosses():
    """The counterintuitive half: BBB+ is a liability for a peripheral target."""
    entry = rule(
        "bbb_direction",
        target_compartment="skeletal muscle",
        bbb={"prob": 0.88, "in_domain": True},
    )
    assert entry["passed"] is False
    assert "tirasemtiv" in entry["reason"]
    assert "reldesemtiv" in entry["reason"]


def test_bbb_direction_accepts_a_muscle_target_that_stays_out():
    entry = rule(
        "bbb_direction",
        target_compartment="skeletal muscle",
        bbb={"prob": 0.24, "in_domain": True},
    )
    assert entry["passed"] is True
    assert "right sign" in entry["reason"]


def test_bbb_direction_is_signed_not_absolute():
    """Identical probability, opposite verdicts, because the target differs."""
    prob = {"prob": 0.9, "in_domain": True}
    assert rule("bbb_direction", target_compartment="cns", bbb=prob)["passed"] is True
    assert rule("bbb_direction", target_compartment="muscle", bbb=prob)["passed"] is False

    low = {"prob": 0.1, "in_domain": True}
    assert rule("bbb_direction", target_compartment="cns", bbb=low)["passed"] is False
    assert rule("bbb_direction", target_compartment="muscle", bbb=low)["passed"] is True


def test_bbb_direction_refuses_to_fire_out_of_domain():
    entry = rule(
        "bbb_direction", target_compartment="cns", bbb={"prob": 0.04, "in_domain": False}
    )
    assert entry["passed"] is True
    assert "applicability domain" in entry["reason"]


def test_bbb_direction_does_not_enforce_without_a_prediction():
    assert rule("bbb_direction", target_compartment="cns")["passed"] is True
    assert rule("bbb_direction", bbb={"prob": 0.9, "in_domain": True})["passed"] is True


def test_bbb_direction_docstring_carries_the_tirasemtiv_precedent():
    """Whoever presents this reads the defense off the docstring."""
    doc = pf.rule_bbb_direction.__doc__ or ""
    assert "tirasemtiv" in doc
    assert "reldesemtiv" in doc
    assert "VITALITY-ALS" in doc


# --------------------------------------------------------------------------
# Rule 8: canada  (chart: lives in Hamilton, Ontario)
# --------------------------------------------------------------------------


def test_canada_rejects_a_drug_absent_from_the_dpd():
    entry = rule("canada", in_health_canada_dpd=False)
    assert entry["passed"] is False
    assert "Health Canada Drug Product Database" in entry["reason"]
    assert CHART.city in entry["reason"]


def test_canada_accepts_a_dpd_listed_drug_and_quotes_the_din():
    entry = rule("canada", in_health_canada_dpd=True, health_canada_din="02240897")
    assert entry["passed"] is True
    assert "02240897" in entry["reason"]


def test_canada_does_not_enforce_before_the_dpd_is_queried():
    entry = rule("canada")
    assert entry["passed"] is True
    assert "not enforced" in entry["reason"]


# --------------------------------------------------------------------------
# Tolerance of whatever merge.py hands over
# --------------------------------------------------------------------------


def test_an_empty_record_produces_eight_valid_entries_and_crashes_nothing():
    entries = pf.apply_patient_filter({})
    assert len(entries) == 8
    assert all(e["reason"] for e in entries)


def test_field_aliases_are_accepted():
    record = pf.DrugRecord.from_mapping(
        {"drug_name": "Memantine", "drugbank_id": "DB00740", "atc": "N06DX01"}
    )
    assert record.name == "memantine"
    assert record.id == "DB00740"
    assert record.atc_codes == ["N06DX01"]


def test_scalar_values_are_accepted_where_a_list_is_expected():
    record = pf.DrugRecord.from_mapping({"name": "x", "formulations": "oral film"})
    assert record.formulations == ["oral film"]


def test_a_junk_cyp1a2_value_does_not_crash_the_rule():
    assert rule("cyp1a2", cyp1a2="unknown")["passed"] is True


# --------------------------------------------------------------------------
# End to end
# --------------------------------------------------------------------------


def test_the_sample_annotation_set_exercises_all_eight_rules():
    drugs = json.loads(pf.DEFAULT_INPUT.read_text())["drugs"]
    fired = {
        entry["rule"]
        for drug in drugs
        for entry in pf.apply_patient_filter(drug)
        if not entry["passed"]
    }
    assert fired == set(pf.RULE_ORDER), f"never fired: {set(pf.RULE_ORDER) - fired}"


def test_the_sample_set_leaves_survivors():
    drugs = json.loads(pf.DEFAULT_INPUT.read_text())["drugs"]
    survivors = [v.name for v in pf.evaluate_all(drugs) if v.passed]
    assert len(survivors) >= 3, f"only {survivors} survived"


def test_build_output_is_json_serializable_and_well_formed():
    drugs = json.loads(pf.DEFAULT_INPUT.read_text())["drugs"]
    output = pf.build_output(drugs)
    reparsed = json.loads(json.dumps(output))

    assert reparsed["meta"]["patient"] == "alex_chen"
    assert reparsed["meta"]["rule_order"] == list(pf.RULE_ORDER)
    assert reparsed["meta"]["n_input"] == len(drugs)
    assert (
        reparsed["meta"]["n_passed"] + reparsed["meta"]["n_eliminated"]
        == reparsed["meta"]["n_input"]
    )
    assert reparsed["top_reason"] in pf.RULE_ORDER
    assert sum(reparsed["eliminated_by_rule"].values()) == reparsed["meta"]["n_eliminated"]
    for result in reparsed["results"]:
        assert [e["rule"] for e in result["filters"]] == list(pf.RULE_ORDER)


def test_exservan_clears_the_swallow_rule_and_fails_only_on_canada():
    """The delivery-gap finding, end to end on the real annotation set."""
    drugs = json.loads(pf.DEFAULT_INPUT.read_text())["drugs"]
    film = next(d for d in drugs if d.get("id") == "EXSERVAN")
    verdict = pf.evaluate(film)
    failures = [e["rule"] for e in verdict.filters if not e["passed"]]
    assert failures == ["canada"]


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
