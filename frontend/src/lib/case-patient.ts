import type { Patient } from './pipeline'

/**
 * Pull the structured patient profile out of a case file's text. Clinical
 * letters repeat facts as they change (age 45 → 47, FVC 78 → 76), so for
 * anything that evolves we take the LAST mention, which is the most recent.
 * Anything the file doesn't state is left as "Not stated", never guessed.
 */

const NOT_STATED = 'Not stated'
const PROVINCES = 'Ontario|Quebec|British Columbia|Alberta|Manitoba|Saskatchewan|Nova Scotia|New Brunswick|Newfoundland and Labrador|Prince Edward Island|ON|QC|BC|AB|MB|SK|NS|NB|NL|PE'

const last = (text: string, re: RegExp) => [...text.matchAll(re)].at(-1)
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function parseCasePatient(pages: string[]): Patient {
  const t = pages.join('\n').replace(/\s+/g, ' ')

  // "Alex Chen, 45, male" … "Alex Chen, 47": the name and the latest age.
  const people = [...t.matchAll(/\b([A-Z][a-z]+ [A-Z][a-z]+), (\d{1,3})\b(?:,? (male|female))?/g)]
  const name = people[0]?.[1] ?? 'Uploaded patient'
  const mentions = people.filter((m) => m[1] === name)
  const age = Number(mentions.at(-1)?.[2] ?? NaN)
  const sexWord = mentions.find((m) => m[3])?.[3]
  const sex = sexWord === 'male' ? 'M' : sexWord === 'female' ? 'F' : ''

  const onset = t.match(/\b(limb|bulbar|spinal|respiratory)[ -]onset\b/i)?.[1]
  const weeks = last(t, /(\d+) weeks? (?:from|since) diagnosis/gi)?.[1]
  const months = last(t, /(\d+) months? (?:from|since) diagnosis/gi)?.[1]
  const alsfrs = last(t, /ALSFRS-R:? (\d{1,2}) ?(?:of|\/) ?48/g)?.[1]
  const slope = t.match(/decline of (?:about )?([\d.]+) points? (?:per|a) month/i)?.[1]
  // Digits can't be skipped between "vital capacity" and the value, so a table title can't borrow a later number.
  const fvc = last(t, /vital capacity[^.\d]{0,40}(\d{2,3})(?: and \d{2,3})? per ?cent/gi)?.[1]

  const panel = t.match(/Genetic panel:? (.+?) (No pathogenic variant detected|Pathogenic variant detected[^.]*)/i)
  const genes = panel?.[1].replace(/ repeat expansion/g, '').replace(/ and (\d+) further genes/, ' + $1 more')
  const genetics = panel ? (/^no/i.test(panel[2]) ? `Panel negative (${genes})` : `${panel[2]} (${genes})`) : NOT_STATED

  const med = t.match(/Medication:? ([A-Z][^.]+?)(?: since [^.]*)?\./)?.[1]
  const medications = med ? [med] : /takes no medication/i.test(t) ? ['None'] : [NOT_STATED]

  const place = t.match(new RegExp(`\\b([A-Z][a-z]+), (${PROVINCES})\\b`))
  // What the patient has turned down or is hoping for, in the file's own words.
  const preferences = [...t.matchAll(/[^.]*\b(?:declined|[Ww]ants to|[Ww]ould like to)\b[^.]*\./g)]
    .map((m) => sentence(m[0].trim().replace(/^(?:He|She|They) (?:has |have )?/, '').replace(/\.$/, '')))
    .filter((s) => s.length <= 90)
    .slice(0, 4)

  return {
    id: name.split(' ').map((w) => w[0]).join(''),
    label: name,
    age,
    sex,
    onset: onset ? `${sentence(onset.toLowerCase())} onset` : 'Onset not stated',
    monthsSinceDx: weeks ? Math.round(Number(weeks) / 4.345) : Number(months ?? NaN),
    alsfrs: Number(alsfrs ?? NaN),
    slope: slope ? -Number(slope) : NaN,
    fvc: Number(fvc ?? NaN),
    genetics,
    medications,
    comorbidities: /no significant past history/i.test(t) ? [] : [NOT_STATED],
    location: place ? `${place[1]}, ${place[2]}` : NOT_STATED,
    coverage: NOT_STATED,
    preferences,
    fusEligible: false,
  }
}
