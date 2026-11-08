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


if __name__ == "__main__":
    unittest.main()
