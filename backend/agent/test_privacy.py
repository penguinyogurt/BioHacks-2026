"""The privacy wall, checked without an API key or network.

  python -m unittest agent.test_privacy
"""
import asyncio
import unittest

from agent.privacy import REDACTED, load_record, sanitize_brief, sensitive_terms
from agent.schemas import Brief


class PrivacyWall(unittest.TestCase):
    def setUp(self):
        self.record = load_record()
        self.terms = sensitive_terms(self.record)

    def test_identifiers_and_clinical_values_are_scrubbed(self):
        leaky = Brief(
            criterion="B2",
            objective="Find cramp relief for Alex Moreau (DOB 1979-04-12, MRN HHS-0048213) in Hamilton, 47 years old",
            constraints=["safe with riluzole 50 mg", "FVC 61% supine", "CK 470 U/L", "call 905-555-0142 or alex.moreau@example.com"],
            avoid=["anything from Dr. Priya Raman's list", "trial NCT04297683"],
        )
        safe, n = sanitize_brief(leaky, self.terms)
        text = " ".join([safe.objective, *safe.constraints, *safe.avoid]).lower()
        for leaked in ["alex", "moreau", "1979", "hhs-0048213", "hamilton", "47 years", "riluzole", "61%", "470",
                       "905-555", "example.com", "priya", "raman", "nct04297683"]:
            self.assertNotIn(leaked, text, leaked)
        self.assertGreater(n, 10)
        self.assertIn(REDACTED.lower(), text)

    def test_pharmacological_constraints_survive(self):
        good = Brief(criterion="B2", objective="Find drugs that relieve muscle cramps in ALS",
                     constraints=["available as liquid or dispersible formulation"],
                     avoid=["respiratory depressants", "CYP1A2 inhibitors or inducers"])
        safe, n = sanitize_brief(good, self.terms)
        self.assertEqual(n, 0)
        self.assertEqual(safe, good)

    def test_brief_has_no_patient_field(self):
        self.assertEqual(set(Brief.model_fields), {"criterion", "objective", "constraints", "avoid"})

    def test_subagent_tools_expose_no_patient_data(self):
        from agent.mcp_server import mcp, pipeline_top_candidates
        from agent.subagent import SUBAGENT_TOOLS

        names = {t.name for t in asyncio.run(mcp.list_tools())}
        self.assertFalse({n for n in names if "patient" in n}, names)
        self.assertLessEqual(SUBAGENT_TOOLS, names)
        # sub-agents describe targets; drug-level lookups would steer them toward named drugs
        self.assertFalse(SUBAGENT_TOOLS & {"chembl_drug", "fda_label", "pubchem_properties", "pipeline_drug",
                                           "pipeline_top_candidates", "opentargets_als_drugs", "opentargets_target_drugs"})
        for c in pipeline_top_candidates(50):  # stage-4 reasons are patient-specific
            self.assertNotIn("filters", c)


class NoDrugNames(unittest.TestCase):
    def test_drug_names_and_codes_are_removed_but_biology_kept(self):
        from agent.no_drugs import PLACEHOLDER, scrub

        out, n = scrub("Like tofersen (BIIB067) or Nuedexta; botulinum toxin type A blocks CHRM3. "
                       "Lowers SOD1 and glutamate release; creatine kinase high; see NCT02623699 and C9orf72.")
        for name in ["tofersen", "BIIB067", "Nuedexta", "botulinum"]:
            self.assertNotIn(name.lower(), out.lower())
        for kept in ["CHRM3", "SOD1", "glutamate release", "creatine kinase", "NCT02623699", "C9orf72"]:
            self.assertIn(kept, out)
        self.assertEqual(n, 4)
        self.assertIn(PLACEHOLDER, out)


class DrugAssessment(unittest.TestCase):
    def test_drug_researchers_get_only_a_drug_name(self):
        from agent.assess import fan_out

        sends = fan_out({"drugs": [{"name": "memantine", "id": "DB01043", "notes": "Alex Moreau: weight 77.5 kg"}]})
        self.assertEqual(sends[0].arg, {"drug": {"name": "memantine", "id": "DB01043"}, "index": 0})

    def test_web_queries_lose_identifiers_but_keep_drug_names(self):
        from agent.privacy import identifier_terms, redact

        record = load_record()
        q, n = redact("Does memantine interact with riluzole for Alex Moreau in Hamilton, QTc 452 ms?", identifier_terms(record))
        self.assertIn("riluzole", q)
        self.assertIn("memantine", q)
        for leaked in ["Alex", "Moreau", "Hamilton", "452 ms"]:
            self.assertNotIn(leaked, q)
        self.assertEqual(n, 3)  # full name, city, lab value

    def test_drug_list_formats(self):
        import json
        import tempfile
        from pathlib import Path

        from agent.assess import load_drugs

        levi = {"ingredient_names": {"Compound::DB01043": "Memantine"}, "aggregation": {"final": []},
                "fallback": {"final": [{"id": "Compound::DB01043", "score": 0.5, "review": {"action": "caution"}}]}}
        for data, want in [(levi, ["Memantine"]), (["riluzole", {"name": "edaravone", "id": "x"}, "Riluzole"], ["riluzole", "edaravone"])]:
            with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
                json.dump(data, f)
            self.assertEqual([d["name"] for d in load_drugs(Path(f.name))], want)
        self.assertTrue(load_drugs(Path(__file__).parents[1] / "data" / "pipeline.json"))

    def test_coordinated_pipeline_output(self):
        import json
        import tempfile
        from pathlib import Path
        from unittest import mock

        from agent import assess

        data = {"ingredient_names": {"Compound::DB00624": "Testosterone", "Compound::DB11846": "Compound::DB11846", "Compound::DB01065": "Melatonin"},
                "advanced": [], "reassessments": {
                    "Compound::DB01065": {"category": "unresolved", "disposition": "unresolved", "decisive": [{"finding": "marker fell"}]},
                    "Compound::DB12243": {"category": "unresolved", "disposition": "established treatment; comparator only"}},
                "discovery_leads": [{"id": "Compound::DB11846", "rank": 1, "disposition": "unresolved patient safety"},
                                    {"id": "Compound::DB00624", "rank": 2, "disposition": "unresolved patient safety"}]}
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(data, f)
        with mock.patch.object(assess, "drugbank_names", lambda ids: {"DB11846": "Creatinine"}):
            drugs = assess.load_drugs(Path(f.name))
        self.assertEqual([d["name"] for d in drugs], ["Melatonin", "Creatinine", "Testosterone"])  # comparator dropped
        self.assertEqual(json.loads(drugs[1]["notes"])["pipeline"], "discovery lead")

    def test_report_renders_as_pdf(self):
        from agent.report_pdf import render
        from agent.schemas import DrugDossier, DrugReport, ReportDrug

        drug = ReportDrug(index=0, rank=1, name="memantine", verdict="use_with_caution", fit_score=0.4,
                          evidence_strength="human_als_mixed_or_negative", pros=["oral solution → easy to swallow"],
                          cons=["MEDALS trial negative"], rationale="Weak evidence; tolerable.", source_urls=["https://example.org/a"],
                          dossier=DrugDossier(name="memantine", mechanism="NMDA receptor antagonist (GRIN1/GRIN2B)", als_evidence="negative"))
        report = DrugReport(run_id="t", created_at="2026-11-08T00:00:00", patient_id="alex", drugs_source="inline", research_run_id="",
                            models={"orchestrator": "o", "researcher": "r"}, langsmith_project=None, summary="One drug — μ and ≥ render.",
                            drugs=[drug], comparison_notes="n/a", open_questions=["check QTc"], web={}, warnings=["Research aid."]).model_dump()
        pdf = render(report)
        self.assertTrue(pdf.startswith(b"%PDF-"))
        self.assertGreater(len(pdf), 2000)


if __name__ == "__main__":
    unittest.main()
