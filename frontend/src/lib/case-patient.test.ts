// Run: node --test src/lib/case-patient.test.ts   (Node 23+ strips the types)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCasePatient } from './case-patient.ts'

// Lines lifted verbatim from the BioHacks 2026 hacker package (Alex Chen's file),
// one string per page, as pdfjs extracts them.
const ALEX = [
  'Mountain Brow Family Health Team Hamilton, Ontario Referral 14 October 2024 Alex Chen, 45, male To: Plastic and Hand Surgery Clinic',
  'He has no significant past history, takes no medication, does not smoke and runs regularly.',
  'Genetic panel: C9orf72 repeat expansion, SOD1, TARDBP, FUS and 28 further genes No pathogenic variant detected Reported 30 July 2026 Forced vital capacity, sitting 78 per cent of predicted Above 80 per cent',
  'Diagnosis: amyotrophic lateral sclerosis (ALS), limb onset, with early bulbar and respiratory involvement',
  'Alex Chen, 47 27 months from first symptom, 10 weeks from diagnosis Medication Riluzole 50 mg twice daily since July. Tolerating. Edaravone declined for now.',
  'ALSFRS-R 32 of 48 (bulbar 9, fine motor 6, gross motor 7, breathing 10). Decline of about 0.6 points per month since onset, roughly linear.',
  'Forced vital capacity, sitting and lying flat 76 and 61 per cent of predicted',
  'ALSFRS-R and vital capacity over time (892 records), drawn from 12 per cent of trials.',
]

test("parses Alex Chen's case into the latest values", () => {
  const p = parseCasePatient(ALEX)
  assert.equal(p.label, 'Alex Chen')
  assert.equal(p.age, 47) // the later letter, not the 2024 referral
  assert.equal(p.sex, 'M')
  assert.equal(p.onset, 'Limb onset')
  assert.equal(p.monthsSinceDx, 2)
  assert.equal(p.alsfrs, 32)
  assert.equal(p.slope, -0.6)
  assert.equal(p.fvc, 76) // latest sitting value; the dataset blurb must not leak in
  assert.equal(p.genetics, 'Panel negative (C9orf72, SOD1, TARDBP, FUS + 28 more)')
  assert.deepEqual(p.medications, ['Riluzole 50 mg twice daily'])
  assert.deepEqual(p.comorbidities, [])
  assert.equal(p.location, 'Hamilton, Ontario')
  assert.equal(p.coverage, 'Not stated')
})

test('leaves what a file does not say as not stated, never invented', () => {
  const p = parseCasePatient(['A one-line note with nothing clinical in it.'])
  assert.ok(Number.isNaN(p.age))
  assert.ok(Number.isNaN(p.alsfrs))
  assert.ok(Number.isNaN(p.fvc))
  assert.equal(p.genetics, 'Not stated')
  assert.equal(p.location, 'Not stated')
})
