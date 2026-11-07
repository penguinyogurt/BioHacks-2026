import type { PatientProfile, Pipeline } from "./contract";

/** Fallback when merge.py has not yet emitted `patient_profile`. */
export const ALEX_PROFILE: PatientProfile = {
  display_name: "Alex Chen",
  summary:
    "47, Hamilton, Ontario. Ranked against ALS biology, then cut against his chart — not a generic ALS patient.",
  findings: [
    {
      label: "Current therapy",
      value: "Riluzole 50 mg twice daily since July 2026",
      implication: "Cleared by CYP1A2; inhibitors and inducers move his exposure.",
      drives: ["cyp1a2"],
    },
    {
      label: "Vital capacity",
      value: "FVC 76% sitting · 61% supine · cough peak flow 310 L/min",
      implication: "Respiratory-depressant classes are disqualified first.",
      drives: ["respiratory"],
    },
    {
      label: "Weight",
      value: "86 → 77.5 kg · meals 35–40 minutes",
      implication: "Anorexants and further weight-loss agents are out.",
      drives: ["weight_loss"],
    },
    {
      label: "CK",
      value: "470 U/L (ceiling 195)",
      implication: "Myotoxic drugs would stack on an already elevated CK.",
      drives: ["myopathy"],
    },
    {
      label: "Swallow",
      value: "Coughs on thin liquids",
      implication: "Capsules and large tablets he cannot crush are unusable.",
      drives: ["swallow"],
    },
    {
      label: "Hands",
      value: "Pinch 3 kg · grip 14 kg vs typical 48 kg",
      implication: "Devices and fiddly packs fail the dexterity rule.",
      drives: ["dexterity"],
    },
  ],
};

export function profileOf(data: Pipeline): PatientProfile {
  if (data.patient_profile) return data.patient_profile;
  return ALEX_PROFILE;
}
