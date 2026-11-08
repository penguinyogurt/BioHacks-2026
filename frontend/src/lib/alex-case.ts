/**
 * Alex Chen's monitoring data, transcribed from the BioHacks 2026 case file
 * (Hacker Package, pp. 7–15). Every value here is stated in the file; nothing
 * is interpolated. Months are counted from first symptom, June 2024 = 0.
 * Alex and every clinician in the file are fictional (p. 19).
 */

export const PATIENT = {
  name: 'Alex Chen',
  age: 47,
  sex: 'M',
  summary: 'Limb-onset ALS (right hand), early bulbar and respiratory involvement',
  firstSymptom: 'June 2024',
  diagnosed: '14 July 2026',
  monthsFromOnset: 27,
  medication: 'Riluzole 50 mg twice daily since July 2026 · edaravone declined for now',
  genetics: 'Panel negative (C9orf72, SOD1, TARDBP, FUS + 28 genes)',
}

/** ALSFRS-R over time (Measurements, p. 15). */
export const ALSFRS = [
  { m: 0, score: 48 },
  { m: 6, score: 43 },
  { m: 12, score: 39 },
  { m: 18, score: 36 },
  { m: 24, score: 33 },
  { m: 27, score: 32 },
]
/** "Decline of about 0.6 points per month since onset, roughly linear" (ALS clinic, p. 14). */
export const ALSFRS_SLOPE = -0.6

/** ALSFRS-R domains at 27 months, each out of 12 (ALS clinic, p. 14). */
export const ALSFRS_DOMAINS = [
  { domain: 'Bulbar', score: 9 },
  { domain: 'Fine motor', score: 6 },
  { domain: 'Gross motor', score: 7 },
  { domain: 'Breathing', score: 10 },
]

/** Forced vital capacity, % predicted (Pulmonary lab p. 11; ALS clinic p. 14). Reference: above 80 sitting, supine within 10 of sitting. */
export const FVC = [
  { m: 24, label: 'Jun 2026', sitting: 78, supine: 64 },
  { m: 27, label: 'Sep 2026', sitting: 76, supine: 61 },
]

/** Weight in kg (neurology p. 9; dietitian p. 14). */
export const WEIGHT = [
  { m: 0, label: 'Jun 2024', kg: 86 },
  { m: 24, label: 'Jun 2026', kg: 78 },
  { m: 27, label: 'Sep 2026', kg: 77.5 },
]

/** Same reading passage at 9 am and 4 pm (speech-language pathology, p. 14–15). */
export const SPEECH = {
  rate: { am: 165, pm: 118, typical: [150, 190] as const, unit: 'words/min' },
  intelligibility: { am: 98, pm: 91, typical: 97, unit: '%' },
}

/** Hand function, right / left vs typical (Measurements, p. 15). */
export const HAND = [
  { measure: 'Grip strength', unit: 'kg', right: 14, left: 32, typical: 48, higherIsBetter: true },
  { measure: 'Key pinch', unit: 'kg', right: 3, left: 8, typical: 11, higherIsBetter: true },
  { measure: 'Nine-hole peg', unit: 's', right: 44, left: 23, typical: 20, higherIsBetter: false },
]

/** Single measurements with their reference ranges. */
export const TESTS = [
  { test: 'Serum neurofilament light', value: '88 pg/mL', reference: 'Below 15 at age 47', abnormal: true, source: 'Lab, 12 Jun 2026' },
  { test: 'Creatine kinase', value: '470 U/L', reference: 'Below 195', abnormal: true, source: 'Lab, 12 Jun 2026' },
  { test: 'Sniff nasal inspiratory pressure', value: '52 cm H₂O', reference: 'Above 70', abnormal: true, source: 'Pulmonary lab, 18 Jun 2026' },
  { test: 'Cough peak flow', value: '310 L/min', reference: '—', abnormal: false, source: 'ALS clinic, 22 Sep 2026' },
  { test: '10-metre walk (cane)', value: '14.2 s', reference: 'Under 8 s', abnormal: true, source: 'ALS clinic, 22 Sep 2026' },
  { test: 'Falls, past three months', value: '2 (both after 6 pm)', reference: 'None', abnormal: true, source: 'ALS clinic, 22 Sep 2026' },
  { test: 'ECAS cognitive screen', value: '101 / 136', reference: 'Fluency & executive below cut-off', abnormal: true, source: 'ALS clinic, 22 Sep 2026' },
  { test: 'Timed water swallow, 100 mL', value: 'Cough on thin liquid', reference: 'No cough', abnormal: true, source: 'ALS clinic, 22 Sep 2026' },
]

/** Manual muscle testing, MRC grade out of 5. */
export const STRENGTH = [
  { muscle: 'Right grip', grades: [{ label: 'Dec 2024', g: 4 }, { label: 'Jun 2026', g: 4 }, { label: 'Sep 2026', g: 3 }] },
  { muscle: 'Left grip', grades: [{ label: 'Jun 2026', g: 5 }, { label: 'Sep 2026', g: 4 }] },
  { muscle: 'Right ankle dorsiflexion', grades: [{ label: 'Aug 2025', g: 4 }, { label: 'Feb 2026', g: 3 }, { label: 'Jun 2026', g: 3 }] },
  { muscle: 'Right finger abduction', grades: [{ label: 'Jun 2026', g: 3 }] },
  { muscle: 'Right hip flexion', grades: [{ label: 'Jun 2026', g: 4 }] },
]

/** The road to diagnosis (pp. 7–14). */
export const TIMELINE = [
  { m: 0, label: 'Jun 2024', event: 'Handwriting fades across the whiteboard' },
  { m: 4, label: 'Oct 2024', event: 'GP referral: suspected carpal tunnel' },
  { m: 7, label: 'Jan 2025', event: 'Carpal tunnel release — no benefit' },
  { m: 14, label: 'Aug 2025', event: 'Physio for right foot drop' },
  { m: 20, label: 'Feb 2026', event: 'Urgent neurology referral' },
  { m: 24, label: 'Jun 2026', event: 'Neurology, EMG in four regions, MRI' },
  { m: 25, label: 'Jul 2026', event: 'Diagnosis: ALS · riluzole started' },
  { m: 27, label: 'Sep 2026', event: 'First regional ALS clinic visit' },
]

export type Level = 'flag' | 'watch'

/** What the file itself raises as a concern, with the measurement behind it. */
export const FLAGS: { level: Level; title: string; detail: string }[] = [
  { level: 'flag', title: 'Vital capacity drops 15 points lying flat', detail: '76% sitting, 61% supine — diaphragm weakness. Night ventilation discussed, not yet indicated.' },
  { level: 'flag', title: 'Two falls in three months', detail: 'Both after 6 pm, on the stairs or at dusk. Alone at home until 4:30 pm.' },
  { level: 'watch', title: 'Speech 29% slower by 4 pm', detail: '165 → 118 words/min; intelligibility 98 → 91%. Students ask him to repeat after lunch.' },
  { level: 'watch', title: 'Cough on thin liquids', detail: 'Timed water swallow. Meals take 35–40 minutes.' },
  { level: 'watch', title: 'Weight down 8.5 kg (10%)', detail: '86 → 77.5 kg. Calorie supplement started; feeding tube discussed early.' },
]
