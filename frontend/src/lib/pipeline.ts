/**
 * Addo Labs discovery pipeline: types, a sample patient, and a SCRIPTED run.
 *
 *   1. Patient analysis agent  (NCBI / ClinVar / Open Targets tool calls)
 *   2. 5 profile agents in parallel, each writing a slightly different ideal-drug profile
 *   3. DRKG embedding: each profile → TransE vector → cosine search over compounds
 *   4. Research agent (open web search) ranks candidates for THIS patient on
 *      fit, safety/interactions, cost, availability/regulation, acceptance
 *   5. Cited report
 *
 * `runDemoStage` replays one stage of fixed events on timers, the way Callio Labs' demo
 * sequence does. A live backend only has to emit the same `PipelineEvent`s.
 * All outputs below are ILLUSTRATIVE — the UI labels the run "Simulated".
 */

export type StageId = 'analysis' | 'profiles' | 'embedding' | 'research' | 'report'

export const STAGES: { id: StageId; label: string; detail: string }[] = [
  { id: 'analysis', label: 'Patient analysis', detail: 'NCBI · ClinVar · Open Targets' },
  { id: 'profiles', label: '5 profile agents', detail: 'Ideal-drug profiles, in parallel' },
  { id: 'embedding', label: 'DRKG embedding', detail: 'Cosine search over compounds' },
  { id: 'research', label: 'Research agent', detail: 'Open search · patient-specific ranking' },
  { id: 'report', label: 'Report', detail: 'Cited, exportable' },
]

export type AgentStep = {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'output'
  label: string
  content: string
}

export type Patient = {
  id: string
  label: string
  age: number
  sex: string
  onset: string
  monthsSinceDx: number
  alsfrs: number
  slope: number // points / month
  fvc: number // % predicted
  genetics: string
  medications: string[]
  comorbidities: string[]
  location: string
  coverage: string
  preferences: string[]
  fusEligible: boolean
}

export const SAMPLE_PATIENT: Patient = {
  id: 'A-0417',
  label: 'Patient A-0417',
  age: 58,
  sex: 'F',
  onset: 'Bulbar onset',
  monthsSinceDx: 14,
  alsfrs: 38,
  slope: -0.9,
  fvc: 72,
  genetics: 'Panel negative (SOD1, C9orf72, FUS, TARDBP)',
  medications: ['Riluzole 50 mg BID', 'Edaravone (oral)', 'Lisinopril 10 mg'],
  comorbidities: ['Hypertension', 'CKD stage 2'],
  location: 'Toronto, ON, Canada',
  coverage: 'OHIP + private drug plan',
  preferences: ['Open to clinical trials', 'Prefers outpatient care', 'Avoids daily injections if possible'],
  fusEligible: true,
}

export type DrugProfile = {
  lane: number
  name: string
  hypothesis: string
  targets: string[]
  modality: string
  constraints: string[]
}

export const PROFILES: DrugProfile[] = [
  {
    lane: 0,
    name: 'Neurotrophic rescue',
    hypothesis: 'Support surviving upper and lower motor neurons with growth-factor signalling.',
    targets: ['IGF1R', 'RET (GDNF)', 'NTRK2 (BDNF)'],
    modality: 'Recombinant protein · ≤ 150 kDa',
    constraints: ['BBB not required (MRgFUS)', 'No hypoglycaemia-prone co-medication'],
  },
  {
    lane: 1,
    name: 'Cytokine neuroinflammation',
    hypothesis: 'Dampen microglial and astrocytic IL-6 / IL-1 signalling in motor cortex.',
    targets: ['IL6R', 'IL1R1', 'TNF'],
    modality: 'Monoclonal antibody / receptor antagonist',
    constraints: ['Infection risk acceptable with monitoring', 'Renal dosing compatible with CKD 2'],
  },
  {
    lane: 2,
    name: 'Complement blockade',
    hypothesis: 'Interrupt complement-mediated synapse and neuromuscular-junction loss.',
    targets: ['C5', 'C3', 'C1QA'],
    modality: 'Monoclonal antibody',
    constraints: ['Requires meningococcal vaccination', 'Infusion schedule'],
  },
  {
    lane: 3,
    name: 'TDP-43 proteostasis',
    hypothesis: 'Clear cytoplasmic TDP-43 aggregates via autophagy enhancement.',
    targets: ['TARDBP', 'MTOR', 'TFEB'],
    modality: 'Small molecule or ASO',
    constraints: ['Sporadic ALS: TDP-43 pathology expected', 'Avoid immunosuppression stacking'],
  },
  {
    lane: 4,
    name: 'Excitotoxicity & oxidative stress',
    hypothesis: 'Reduce glutamate excitotoxicity and oxidative damage beyond current therapy.',
    targets: ['SLC1A2 (EAAT2)', 'GRIA2', 'NFE2L2 (NRF2)'],
    modality: 'Small molecule',
    constraints: ['Must not duplicate riluzole / edaravone', 'No CYP1A2 inhibition'],
  },
]

export type Match = { drug: string; lane: number; cosine: number; x: number; y: number; note?: string }

/** Top DRKG neighbours per profile, with a 2D projection for the embedding plot. */
export const MATCHES: Match[] = [
  { drug: 'Mecasermin', lane: 0, cosine: 0.81, x: -2.1, y: 1.6 },
  { drug: 'Somatropin', lane: 0, cosine: 0.64, x: -2.6, y: 2.3 },
  { drug: 'Tocilizumab', lane: 1, cosine: 0.78, x: 1.4, y: 1.9 },
  { drug: 'Anakinra', lane: 1, cosine: 0.74, x: 1.9, y: 1.2 },
  { drug: 'Sarilumab', lane: 1, cosine: 0.71, x: 1.1, y: 2.6 },
  { drug: 'Ravulizumab', lane: 2, cosine: 0.76, x: 2.4, y: -1.1 },
  { drug: 'Eculizumab', lane: 2, cosine: 0.75, x: 2.9, y: -0.6 },
  { drug: 'Sirolimus', lane: 3, cosine: 0.62, x: -0.4, y: -2.3 },
  { drug: 'Tofersen', lane: 3, cosine: 0.6, x: -1.1, y: -2.8, note: 'SOD1-targeted' },
  { drug: 'Riluzole', lane: 4, cosine: 0.84, x: -2.4, y: -0.9 },
  { drug: 'Edaravone', lane: 4, cosine: 0.8, x: -2.9, y: -0.3 },
  { drug: 'Ceftriaxone', lane: 4, cosine: 0.71, x: -1.8, y: -1.4 },
]

/** Profile centroids in the same 2D projection. */
export const PROFILE_POINTS = [
  { lane: 0, x: -2.2, y: 2.0 },
  { lane: 1, x: 1.5, y: 1.8 },
  { lane: 2, x: 2.6, y: -0.9 },
  { lane: 3, x: -0.7, y: -2.5 },
  { lane: 4, x: -2.3, y: -0.8 },
]

export type Criterion = 'fit' | 'safety' | 'cost' | 'availability' | 'acceptance'

export const CRITERIA: { key: Criterion; label: string; short: string; hint: string }[] = [
  { key: 'fit', label: 'Mechanistic fit', short: 'Fit', hint: 'Embedding similarity to the profile' },
  { key: 'safety', label: 'Safety & interactions', short: 'Safety', hint: 'Side effects, comorbidities, current medication' },
  { key: 'cost', label: 'Cost', short: 'Cost', hint: 'Drug + delivery cost to the patient and system' },
  { key: 'availability', label: 'Availability & regulation', short: 'Access', hint: 'Approved / accessible in the patient’s country' },
  { key: 'acceptance', label: 'Patient acceptance', short: 'Accept.', hint: 'Burden, route, how established the drug is' },
]

export type Candidate = {
  drug: string
  lane: number
  cls: string
  sizeKDa: number
  bbbAlone: string
  withFus: string
  scores: Record<Criterion, number>
  rationale: string
  evidence: string
  safety: string
  cost: string
  availability: string
  acceptance: string
  cites: number[]
}

export const CANDIDATES: Candidate[] = [
  {
    drug: 'Anakinra',
    lane: 1,
    cls: 'IL-1 receptor antagonist (recombinant protein)',
    sizeKDa: 17,
    bbbAlone: 'Low',
    withFus: 'Motor-cortex delivery plausible',
    scores: { fit: 74, safety: 74, cost: 55, availability: 82, acceptance: 60 },
    rationale: 'Blocks IL-1 signalling, one of the cytokine pathways implicated in ALS neuroinflammation. Its small size relative to antibodies makes it a reasonable first candidate for focused-ultrasound-assisted delivery.',
    evidence: 'Mechanistic and preclinical support; early human ALS data are limited.',
    safety: 'Injection-site reactions, infection risk, neutropenia. No expected interaction with riluzole or edaravone. Dose adjustment only needed in severe renal impairment (patient: CKD 2).',
    cost: 'Moderate–high (biologic).',
    availability: 'Marketed in Canada for other indications; ALS use would be off-label or within a trial.',
    acceptance: 'Daily subcutaneous injection conflicts with the patient’s stated preference; FUS sessions would be periodic.',
    cites: [1, 7],
  },
  {
    drug: 'Tocilizumab',
    lane: 1,
    cls: 'Anti-IL-6 receptor monoclonal antibody',
    sizeKDa: 148,
    bbbAlone: 'Very low',
    withFus: 'Requires BBB opening',
    scores: { fit: 78, safety: 58, cost: 40, availability: 85, acceptance: 66 },
    rationale: 'Most similar compound to the cytokine-neuroinflammation profile. As a full-size antibody it is essentially excluded from the CNS without BBB opening, which is exactly the gap MRgFUS addresses.',
    evidence: 'Small exploratory ALS studies only; no phase 3 data.',
    safety: 'Serious infections, hepatotoxicity (monitor ALT/AST), neutropenia, lipid elevation. IL-6 blockade can restore CYP450 activity, including CYP1A2 — riluzole’s main pathway — so riluzole levels should be monitored.',
    cost: 'High (monoclonal antibody, infusion).',
    availability: 'Approved in Canada for other indications; ALS use off-label or within a trial.',
    acceptance: 'Monthly infusion schedule; widely used biologic.',
    cites: [1, 3, 7],
  },
  {
    drug: 'Mecasermin',
    lane: 0,
    cls: 'Recombinant human IGF-1',
    sizeKDa: 7.6,
    bbbAlone: 'Low',
    withFus: 'Motor-cortex delivery plausible',
    scores: { fit: 81, safety: 70, cost: 35, availability: 45, acceptance: 72 },
    rationale: 'Strongest match to the neurotrophic profile. Systemic IGF-1 did not slow ALS in a 2-year trial; limited CNS exposure is one proposed explanation that direct, FUS-assisted delivery could test.',
    evidence: 'Negative 2-year subcutaneous trial; delivery-limited hypothesis untested.',
    safety: 'Hypoglycaemia (monitor glucose), injection-site reactions. No expected interaction with current medication.',
    cost: 'High.',
    availability: 'Canadian supply to be confirmed; may require Health Canada’s Special Access Programme.',
    acceptance: 'Established drug class; twice-daily injections when used systemically.',
    cites: [1, 6, 7],
  },
  {
    drug: 'Ravulizumab',
    lane: 2,
    cls: 'Anti-C5 complement monoclonal antibody',
    sizeKDa: 148,
    bbbAlone: 'Very low',
    withFus: 'Requires BBB opening',
    scores: { fit: 76, safety: 45, cost: 15, availability: 70, acceptance: 48 },
    rationale: 'Top match for the complement profile. A phase 3 ALS trial with intravenous dosing was stopped for lack of efficacy; whether CNS-directed exposure changes that is unknown.',
    evidence: 'Phase 3 (IV) discontinued for futility; CNS delivery untested.',
    safety: 'Boxed warning for meningococcal infection — vaccination required before treatment.',
    cost: 'Very high.',
    availability: 'Approved in Canada for other indications; ALS use off-label or within a trial.',
    acceptance: 'Vaccination plus infusions; higher burden.',
    cites: [1, 7],
  },
]

export const EXCLUDED: { drug: string; reason: string; cites: number[] }[] = [
  { drug: 'Tofersen', reason: 'SOD1-targeted antisense oligonucleotide; this patient is SOD1-negative.', cites: [5] },
  { drug: 'Riluzole', reason: 'Already prescribed.', cites: [3] },
  { drug: 'Edaravone', reason: 'Already prescribed.', cites: [4] },
  { drug: 'Ceftriaxone', reason: 'Phase 3 trial in ALS did not show benefit.', cites: [] },
]

const pubmed = (q: string) => `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(q)}`

export const REFERENCES: { n: number; text: string; url: string }[] = [
  {
    n: 1,
    text: 'Abrahao A, et al. First-in-human trial of blood–brain barrier opening in amyotrophic lateral sclerosis using MR-guided focused ultrasound. Nat Commun. 2019;10:4373.',
    url: pubmed('blood-brain barrier opening amyotrophic lateral sclerosis MR-guided focused ultrasound Abrahao'),
  },
  {
    n: 2,
    text: 'Ioannidis VN, et al. DRKG — Drug Repurposing Knowledge Graph. 2020.',
    url: 'https://github.com/gnn4dr/DRKG',
  },
  {
    n: 3,
    text: 'Bensimon G, Lacomblez L, Meininger V. A controlled trial of riluzole in amyotrophic lateral sclerosis. N Engl J Med. 1994;330:585–591.',
    url: pubmed('Bensimon controlled trial of riluzole in amyotrophic lateral sclerosis'),
  },
  {
    n: 4,
    text: 'Writing Group; Edaravone (MCI-186) ALS 19 Study Group. Safety and efficacy of edaravone in well defined patients with ALS. Lancet Neurol. 2017;16:505–512.',
    url: pubmed('edaravone well defined patients amyotrophic lateral sclerosis randomised double-blind'),
  },
  {
    n: 5,
    text: 'Miller TM, et al. Trial of antisense oligonucleotide tofersen for SOD1 ALS. N Engl J Med. 2022;387:1099–1110.',
    url: pubmed('Trial of antisense oligonucleotide tofersen for SOD1 ALS'),
  },
  {
    n: 6,
    text: 'Sorenson EJ, et al. Subcutaneous IGF-1 is not beneficial in 2-year ALS trial. Neurology. 2008;71:1770–1775.',
    url: pubmed('Subcutaneous IGF-1 is not beneficial in 2-year ALS trial'),
  },
  {
    n: 7,
    text: 'Pardridge WM. The blood-brain barrier: bottleneck in brain drug development. NeuroRx. 2005;2:3–14.',
    url: pubmed('Pardridge blood-brain barrier bottleneck in brain drug development'),
  },
]

export type Weights = Record<Criterion, boolean>

/** Fit counts double; every other enabled criterion counts once. */
export function rank(candidates: Candidate[], weights: Weights) {
  return candidates
    .map((c) => {
      let sum = 0
      let n = 0
      for (const { key } of CRITERIA) {
        if (!weights[key]) continue
        const w = key === 'fit' ? 2 : 1
        sum += c.scores[key] * w
        n += w
      }
      return { ...c, overall: n ? Math.round(sum / n) : 0 }
    })
    .sort((a, b) => b.overall - a.overall)
}

// ---------------------------------------------------------------- the run --

export type PipelineEvent =
  | { type: 'stage'; stage: StageId; status: 'running' | 'done' }
  | { type: 'step'; stage: StageId; lane?: number; step: AgentStep }
  | { type: 'profile'; profile: DrugProfile }
  | { type: 'matches' }
  | { type: 'candidates' }
  | { type: 'report' }

type Timed = { at: number; event: PipelineEvent }

/** What the analysis agent is told about the uploaded case PDF. */
export type CaseInput = { name: string; pages: number; words: number; excerpt: string } | null

function script(p: Patient, caseInput: CaseInput): Timed[] {
  const out: Timed[] = []
  let t = 0
  const at = (dt: number, event: PipelineEvent) => {
    t += dt
    out.push({ at: t, event })
  }
  const step = (stage: StageId, type: AgentStep['type'], label: string, content: string, dt: number, lane?: number) =>
    at(dt, { type: 'step', stage, lane, step: { type, label, content } })

  // 1 — patient analysis
  at(200, { type: 'stage', stage: 'analysis', status: 'running' })
  if (caseInput) {
    step('analysis', 'tool_call', 'pdf.extract_text', `{
  "file": ${JSON.stringify(caseInput.name)},
  "pages": ${caseInput.pages}
}`, 700)
    step('analysis', 'tool_result', 'Case PDF — result', `Extracted ${caseInput.words.toLocaleString()} words from ${caseInput.pages} page${caseInput.pages === 1 ? '' : 's'}.

“${caseInput.excerpt}…”`, 900)
  }
  step('analysis', 'thinking', 'Reading patient record', `${p.label}: ${p.age}${p.sex}, ${p.onset.toLowerCase()}, ${p.monthsSinceDx} months from diagnosis. ALSFRS-R ${p.alsfrs}/48, slope ${p.slope} pts/month, FVC ${p.fvc}%. On ${p.medications.join(', ')}.`, 900)
  step('analysis', 'tool_call', 'ncbi.gene_lookup', '{\n  "genes": ["SOD1", "C9orf72", "FUS", "TARDBP"],\n  "organism": "Homo sapiens"\n}', 1100)
  step('analysis', 'tool_result', 'NCBI Gene — result', 'Retrieved gene records and ALS-associated variant summaries for 4 genes.', 1100)
  step('analysis', 'tool_call', 'clinvar.match_patient_variants', '{\n  "panel": "ALS core",\n  "patient_result": "negative"\n}', 800)
  step('analysis', 'tool_result', 'ClinVar — result', 'No pathogenic variant reported for this patient. Classified as sporadic ALS; TDP-43 proteinopathy expected. SOD1-directed therapies not indicated.', 1000)
  step('analysis', 'output', 'Patient summary', `Sporadic, ${p.onset.toLowerCase()} ALS progressing at ${Math.abs(p.slope)} pts/month on standard therapy. Eligible for MRgFUS blood–brain barrier opening, so large molecules are in scope.`, 800)
  at(300, { type: 'stage', stage: 'analysis', status: 'done' })

  // 2 — five profile agents, interleaved
  at(200, { type: 'stage', stage: 'profiles', status: 'running' })
  const base = t
  PROFILES.forEach((prof, lane) => {
    const s = base + lane * 350
    out.push({ at: s + 400, event: { type: 'step', stage: 'profiles', lane, step: { type: 'thinking', label: `Agent ${lane + 1}: framing hypothesis`, content: prof.hypothesis } } })
    out.push({ at: s + 1500, event: { type: 'step', stage: 'profiles', lane, step: { type: 'tool_call', label: `Agent ${lane + 1}: opentargets.associations`, content: `{\n  "disease": "amyotrophic lateral sclerosis",\n  "targets": ${JSON.stringify(prof.targets)}\n}` } } })
    out.push({ at: s + 2900, event: { type: 'step', stage: 'profiles', lane, step: { type: 'tool_result', label: `Agent ${lane + 1}: target evidence`, content: `Association evidence retrieved for ${prof.targets.length} targets. Constraints applied: ${prof.constraints.join('; ')}.` } } })
    out.push({ at: s + 3900, event: { type: 'profile', profile: prof } })
  })
  t = base + 4 * 350 + 3900
  at(300, { type: 'stage', stage: 'profiles', status: 'done' })

  // 3 — embedding
  at(200, { type: 'stage', stage: 'embedding', status: 'running' })
  step('embedding', 'tool_call', 'drkg.query_profiles', '{\n  "model": "TransE_l2",\n  "dim": 400,\n  "profiles": 5,\n  "query": "e[gene] − r[DRUGBANK::target::Compound:Gene]",\n  "universe": "Compound::DB* (10,551)"\n}', 900)
  step('embedding', 'tool_result', 'DRKG — result', '15 target genes resolved to DRKG gene entities. Each gives a query point e[gene] − r[target]; every compound is scored by 400-d L2 distance and keeps its best gene per profile. Top 5 kept per profile.', 1500)
  at(400, { type: 'matches' })
  at(300, { type: 'stage', stage: 'embedding', status: 'done' })

  // 4 — research agent
  at(200, { type: 'stage', stage: 'research', status: 'running' })
  step('research', 'thinking', 'Filtering for this patient', 'Drop drugs already prescribed (riluzole, edaravone), SOD1-specific therapies (patient SOD1-negative), and compounds with negative phase 3 data in ALS without a delivery-limited explanation.', 1000)
  step('research', 'tool_call', 'web.search', '{ "query": "tocilizumab amyotrophic lateral sclerosis trial" }', 900)
  step('research', 'tool_result', 'Search — result', 'Exploratory ALS studies only; no phase 3.', 1000)
  step('research', 'tool_call', 'interactions.check', `{\n  "candidates": ["Tocilizumab", "Anakinra", "Mecasermin", "Ravulizumab"],\n  "current": ${JSON.stringify(p.medications)},\n  "conditions": ${JSON.stringify(p.comorbidities)}\n}`, 900)
  step('research', 'tool_result', 'Interactions — result', 'Tocilizumab: may normalise CYP1A2 activity (riluzole) → monitor levels. Anakinra: renal adjustment only in severe impairment. Mecasermin: hypoglycaemia monitoring. Ravulizumab: meningococcal vaccination required.', 1100)
  step('research', 'tool_call', 'web.search', `{ "query": "availability in Canada: tocilizumab, anakinra, ravulizumab, mecasermin" }`, 800)
  step('research', 'tool_result', 'Search — result', 'Three of four marketed in Canada for other indications; mecasermin may need the Special Access Programme.', 1000)
  step('research', 'output', 'Ranking', 'Scored on mechanistic fit (×2), safety & interactions, cost, availability & regulation, and patient acceptance.', 700)
  at(300, { type: 'candidates' })
  at(300, { type: 'stage', stage: 'research', status: 'done' })

  // 5 — report
  at(200, { type: 'stage', stage: 'report', status: 'running' })
  step('report', 'output', 'Report compiled', '4 ranked candidates, 4 exclusions, 7 references.', 1100)
  at(300, { type: 'report' })
  at(100, { type: 'stage', stage: 'report', status: 'done' })

  return out.sort((a, b) => a.at - b.at)
}

/** The scripted events of one stage, with times relative to the stage's start. */
function stageEvents(patient: Patient, caseInput: CaseInput, stage: StageId): Timed[] {
  let current: StageId | null = null
  const mine: Timed[] = []
  for (const t of script(patient, caseInput)) {
    if (t.event.type === 'stage' && t.event.status === 'running') current = t.event.stage
    if (current === stage) mine.push(t)
  }
  const t0 = mine[0]?.at ?? 0
  return mine.map((t) => ({ at: t.at - t0 + 150, event: t.event }))
}

/**
 * Replays ONE stage of the scripted run; the pipeline waits for the user
 * before the next. Returns `{ cancel, skip }`; `skip` finishes the stage now.
 */
export function runDemoStage(patient: Patient, caseInput: CaseInput, stage: StageId, emit: (e: PipelineEvent) => void, onDone: () => void) {
  const events = stageEvents(patient, caseInput, stage)
  let i = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const start = performance.now()
  const tick = () => {
    const now = performance.now() - start
    while (i < events.length && events[i].at <= now) emit(events[i++].event)
    if (i >= events.length) return onDone()
    timer = setTimeout(tick, Math.max(0, events[i].at - now))
  }
  timer = setTimeout(tick, 0)
  return {
    cancel: () => clearTimeout(timer),
    skip: () => {
      clearTimeout(timer)
      while (i < events.length) emit(events[i++].event)
      onDone()
    },
  }
}
