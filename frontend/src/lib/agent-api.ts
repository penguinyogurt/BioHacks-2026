/**
 * Live client for the agent backend (backend/agent/api.py, :8001). One press of Run chains
 * three backend runs, each streamed over SSE and mapped onto the same `PipelineEvent`s the
 * scripted demo emits, so the pages don't know which one they're watching:
 *
 *   1–2  POST /api/research   orchestrator plans → one sub-agent per brief, in parallel
 *        run_started · patient_loaded · plan          → stage 'analysis'
 *        plan (the fan-out)                           → 'lanes', analysis done, profiles running
 *        subagent_* · tool_call · tool_result         → stage 'profiles', lane = brief index
 *        verify                                       → profiles done; stage 3 starts NOW, while
 *        report (the orchestrator's ranking)            the orchestrator is still ranking (~35 s)
 *   3    POST /api/drkg       the agents' verified target genes → DRKG TransE queries → DrugBank matches
 *        drkg_started · drkg_profile · report         → stage 'embedding', 'scene'
 *   4    POST /api/assess     after both 2's ranking and 3: web research per matched drug → Opus ranks them
 *        drug_research_* · web_search · pubmed_search · citation_revision · report → stage 'research', 'reportPdf'
 */
import type { AgentStep, DrugProfile, PipelineEvent, StageId } from './pipeline'
import type { CaseFile } from './case-pdf'

export const AGENT_URL = (import.meta.env.VITE_AGENT_URL as string | undefined) || 'http://127.0.0.1:8001'
/** Which record in backend/data/patient/ the agent reads. The case PDF is only parsed in the browser. */
export const AGENT_PATIENT = (import.meta.env.VITE_AGENT_PATIENT as string | undefined) || 'alex'
/**
 * Recorded runs to replay instead of paying for new ones: "<research>[,<drkg>[,<assess>]]"
 * (ids from backend/agent/runs/). A missing DRKG id is recomputed live, which is free; a missing
 * assessment id stops the replay after stage 3 rather than start a paid run.
 */
const REPLAY = ((import.meta.env.VITE_AGENT_REPLAY_RUN as string | undefined) ?? '').split(',').map((s) => s.trim()).filter(Boolean)

type AgentEvent = { t_ms: number; type: string; criterion?: string; data: Record<string, any> }

const EVENT_TYPES = [
  'run_started', 'patient_loaded', 'plan', 'subagent_started', 'tool_call', 'tool_result', 'budget_exhausted', 'subagent_finished', 'verify',
  'drkg_started', 'drkg_log', 'drkg_profile',
  'assess_loaded', 'drug_research_started', 'web_search', 'drug_research_finished', 'drug_research_failed', 'web_research', 'pubmed_search', 'citation_revision',
  'report', 'run_finished', 'error',
]

/** The file name a response's Content-Disposition gives (RFC 6266: filename* wins), or null. */
export function filenameOf(res: Response): string | null {
  const cd = res.headers.get('Content-Disposition') ?? ''
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
  if (star) {
    try {
      return decodeURIComponent(star[1])
    } catch {
      /* fall through to the plain form */
    }
  }
  return /filename="([^"]+)"/i.exec(cd)?.[1] ?? null
}

/** "<name> (<id>).pdf": the same rule the backend uses for live reports (api.pdf_filename). */
export const reportFilename = (name: string, id: string) =>
  `${name && name.toLowerCase() !== id.toLowerCase() ? `${name} (${id})` : id || 'report'}.pdf`

/** True when the agent API is up and has a Claude key. Never throws. */
export async function agentAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${AGENT_URL}/api/health`, { signal: AbortSignal.timeout(1500) })
    return r.ok && (REPLAY.length ? true : (await r.json()).anthropic_key === true)
  } catch {
    return false
  }
}

const json = (v: unknown) => JSON.stringify(v, null, 2)

const VERDICT: Record<string, string> = {
  strong_candidate: 'Strong candidate',
  worth_discussing: 'Worth discussing',
  use_with_caution: 'Use with caution',
  not_recommended: 'Not recommended',
}

/** The three backend runs behind one pipeline run. Saved as they're created, so a reload can resume. */
/** `patient`: the backend record built from the uploaded case PDF (data/patient/<id>.json). */
export type LiveIds = { patient?: string; research?: string; drkg?: string; assess?: string }

const COUNT_LABEL: Record<string, string> = {
  medications: 'medications', allergies: 'allergies', labs: 'lab results', symptoms: 'symptoms', trials: 'trials', genetics: 'genetic results',
}

/**
 * The backend record id for a case file: the patient's name plus a fingerprint of the PDF
 * ("alex-chen-3f9a1c"), so the same file maps to the same record and isn't read twice.
 */
async function patientIdFor(bytes: ArrayBuffer, name: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const hash = [...digest.slice(0, 3)].map((b) => b.toString(16).padStart(2, '0')).join('')
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
  return slug && slug !== 'uploaded-patient' ? `${slug}-${hash}` : `case-${hash}`
}

/**
 * Run the whole pipeline live (or replay it). `onEnd` fires once, with an error message if
 * any stage failed. Returns a cancel function.
 *
 * `resume`: ids of runs that already exist (e.g. after a page reload). They aren't started
 * again; their events are fetched from the backend, which sends every past event on connect,
 * so the whole run rebuilds in a moment and then continues live. `onIds` reports each id as
 * soon as it exists.
 *
 * `caseFile`: the uploaded case PDF. It's sent to POST /api/patients first, where Claude reads it
 * into the patient record every stage uses. Without one (or when replaying), the default
 * record VITE_AGENT_PATIENT is used.
 */
export function runLiveAgent(
  question: string,
  emit: (e: PipelineEvent) => void,
  onEnd: (error?: string) => void,
  resume: LiveIds = {},
  onIds: (ids: LiveIds) => void = () => {},
  caseFile: CaseFile | null = null,
) {
  const ids: LiveIds = { ...resume }
  const got = (k: keyof LiveIds, id: string) => {
    ids[k] = id
    onIds({ ...ids })
    return id
  }
  const sources = new Set<EventSource>()
  let closed = false
  let ended = false
  const lanes = new Map<string, { lane: number; label: string; constraints: string[]; targets: string[] }>()
  type DrkgProfile = { lane: number; name: string; criterion: string; targets: string[] }
  let targetsReady: (p: DrkgProfile[]) => void = () => {}
  const targets = new Promise<DrkgProfile[]>((r) => (targetsReady = r))
  const drugLane = new Map<string, number>()

  const end = (error?: string) => {
    if (ended) return
    ended = true
    sources.forEach((s) => s.close())
    onEnd(error)
  }
  const step = (stage: StageId, type: AgentStep['type'], label: string, content: string, lane?: number) =>
    emit({ type: 'step', stage, lane, step: { type, label, content } })

  /** Stream one backend run. Resolves with its `report` payload; rejects on its `error` event or a dead connection. */
  function stream(runId: string, handle: (e: AgentEvent) => void): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      if (closed) return reject(new Error('cancelled'))
      // The server replays every past event on each (re)connect; skip the ones already handled.
      let seen = 0
      let index = 0
      let retries = 0
      let report: Record<string, any> = {}
      const source = new EventSource(`${AGENT_URL}/api/research/${runId}/events${REPLAY.includes(runId) ? '?replay_speed=1' : ''}`)
      sources.add(source)
      source.onopen = () => {
        index = 0
      }
      // EventSource retries forever on its own; give up when it's closed for good
      // (e.g. a 404 for an unknown run) or after 3 reconnects with nothing new.
      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED || ++retries > 3) {
          source.close()
          reject(new Error('Lost the connection to the agent.'))
        }
      }
      for (const type of EVENT_TYPES) {
        source.addEventListener(type, (m) => {
          // The backend's "error" event shares a name with EventSource's own connection
          // error, which has no data; that one is handled by onerror above.
          if (!(m instanceof MessageEvent) || typeof m.data !== 'string') return
          if (index++ < seen) return
          seen = index
          retries = 0
          const e: AgentEvent = JSON.parse(m.data)
          if (e.type === 'error') {
            source.close()
            return reject(new Error(e.data?.message ?? 'The agent run failed.'))
          }
          if (e.type === 'report') report = e.data
          handle(e)
          if (e.type === 'run_finished') {
            source.close()
            resolve(report)
          }
        })
      }
    })
  }

  async function post(path: string, body: unknown): Promise<string> {
    const r = await fetch(`${AGENT_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) throw new Error(`${path} ${r.status}: ${(await r.json().catch(() => ({}))).detail ?? r.statusText}`)
    return (await r.json()).run_id as string
  }

  // ---------------------------------------------------------- 1–2 research --
  function research(e: AgentEvent) {
    const d = e.data ?? {}
    const lane = e.criterion ? lanes.get(e.criterion) : undefined
    switch (e.type) {
      case 'run_started':
        emit({ type: 'stage', stage: 'analysis', status: 'running' })
        step('analysis', 'output', 'Run started', `Orchestrator: ${d.models?.orchestrator}\nSub-agents: ${d.models?.subagent}\n\nQuestion: ${d.question}`)
        break
      case 'patient_loaded':
        step('analysis', 'tool_call', 'load_patient', json({ patient_id: d.patient_id }))
        step('analysis', 'tool_result', 'Patient record — result', `The orchestrator has the full record "${d.patient_id}"${d.synthetic ? ' (marked synthetic)' : ''}.`)
        step('analysis', 'thinking', 'Planning the research', 'Reading the full record and choosing which disease mechanisms and symptoms to research for this patient. Sub-agents will only see a sanitised brief.')
        break
      case 'plan': {
        const briefs: { criterion: string; label: string; objective: string }[] = d.briefs ?? []
        briefs.forEach((b, i) => lanes.set(b.criterion, { lane: i, label: b.label, constraints: [], targets: [] }))
        if (d.rationale) step('analysis', 'output', 'Research plan', d.rationale)
        // The orchestrator handing each brief to a sub-agent: that's the fan-out.
        briefs.forEach((b, i) => step('analysis', 'tool_call', `spawn_subagent · ${b.criterion} ${b.label}`, json({ criterion: b.criterion, objective: b.objective }), i))
        step('analysis', 'output', 'Privacy wall', `${briefs.length} briefs sent. ${d.redactions ?? 0} patient identifier${d.redactions === 1 ? '' : 's'} redacted before leaving the orchestrator.`)
        emit({ type: 'lanes', lanes: briefs.map((b, i) => ({ lane: i, name: b.label, criterion: b.criterion, objective: b.objective })) })
        emit({ type: 'stage', stage: 'analysis', status: 'done' })
        emit({ type: 'stage', stage: 'profiles', status: 'running' })
        break
      }
      case 'subagent_started':
        if (!lane) break
        lane.constraints = [...(d.constraints ?? []), ...(d.avoid ?? []).map((x: string) => `Avoid: ${x}`)]
        step('profiles', 'thinking', 'Brief received', `${d.objective}${lane.constraints.length ? `\n\n${lane.constraints.join('\n')}` : ''}`, lane.lane)
        break
      case 'tool_call':
        if (lane) step('profiles', 'tool_call', d.tool, json(d.args), lane.lane)
        break
      case 'tool_result':
        if (lane) {
          const size = `${Number(d.chars).toLocaleString()} characters returned${d.error ? ' (tool error)' : ''}`
          // `preview`: the first 1,500 characters of what the tool returned (runs recorded before it have only the size).
          const body = d.preview ? `${size}${d.chars > d.preview.length ? `, first ${d.preview.length.toLocaleString()} shown` : ''}:\n\n${d.preview}` : `${size}.`
          step('profiles', 'tool_result', `${d.tool} — ${d.error ? 'error' : 'result'}`, body, lane.lane)
        }
        break
      case 'budget_exhausted':
        if (lane) step('profiles', 'thinking', 'Tool budget used', `Answering from the ${d.tool_results} results gathered so far.`, lane.lane)
        break
      case 'subagent_finished': {
        if (!lane) break
        const goals: string[] = d.goals ?? []
        const targets: string[][] = d.targets ?? []
        lane.targets = [...new Set(targets.flat())]
        const profile: DrugProfile = {
          lane: lane.lane,
          name: lane.label,
          hypothesis: goals[0] ?? (d.dead_ends?.[0] ? `No profile: ${d.dead_ends[0]}` : 'No profile returned.'),
          targets: lane.targets,
          modality: '',
          constraints: lane.constraints,
          strategies: goals.map((goal, i) => ({ goal, targets: targets[i] ?? [] })),
        }
        step('profiles', 'output', `${goals.length} profile${goals.length === 1 ? '' : 's'}`, goals.map((g, i) => `${i + 1}. ${g}`).join('\n') || (d.dead_ends ?? []).join('\n'), lane.lane)
        emit({ type: 'profile', profile })
        break
      }
      case 'verify': {
        step('profiles', 'output', 'Evidence verified', `${d.kept} profiles kept · ${d.dropped_profiles} dropped · ${d.dropped_evidence} citations that don't exist removed · ${d.drug_mentions_removed} drug names scrubbed.`)
        // The genes are final here; only the orchestrator's ranking is still to come, and stage 3
        // doesn't need it. (Runs recorded before `targets` was added fall back to the agents' own.)
        const verified: Record<string, string[]> | undefined = d.targets
        targetsReady([...lanes].map(([criterion, l]) => ({ lane: l.lane, name: l.label, criterion, targets: verified ? (verified[criterion] ?? []) : l.targets })).sort((a, b) => a.lane - b.lane))
        emit({ type: 'stage', stage: 'profiles', status: 'done' })
        break
      }
      case 'report':
        // The synthesis feeds the drug assessment, so it opens stage 4's trace.
        step('research', 'output', 'Ranked for this patient', d.summary ?? '')
        break
    }
  }

  // ---------------------------------------------------------------- 3 DRKG --
  function drkg(e: AgentEvent) {
    const d = e.data ?? {}
    switch (e.type) {
      case 'run_started':
        emit({ type: 'stage', stage: 'embedding', status: 'running' })
        step('embedding', 'thinking', 'Building TransE queries', 'For every target gene the agents named: q = e[gene] − r[DRUGBANK::target]. Every DrugBank compound is scored by 400-d L2 distance to q; a profile keeps each compound’s best distance over its genes.')
        break
      case 'drkg_started':
        for (const p of d.profiles ?? []) step('embedding', 'tool_call', `drkg.query · ${p.name}`, json({ genes: p.targets }), p.lane)
        break
      case 'drkg_log':
        step('embedding', 'tool_result', 'drkg_scene.py', d.line)
        break
      case 'drkg_profile': {
        const matches: { rank: number; name: string; distance: number; viaGene: string; directEdge: boolean }[] = d.matches ?? []
        const lines = matches.map((m) => `${m.rank}. ${m.name.length > 48 ? `${m.name.slice(0, 47)}…` : m.name}  ·  L2 ${m.distance.toFixed(2)}  ·  ${m.directEdge ? '↔' : '≈'} ${m.viaGene}`)
        if (d.unresolved?.length) lines.push(`Not in DRKG: ${d.unresolved.join(', ')}`)
        step('embedding', 'output', `${d.name} — ${matches.length} matches`, lines.join('\n'), d.lane)
        break
      }
      case 'report': {
        const drugs: { name: string; lane: number; profile: string; via_gene: string; drkg_rank: number }[] = d.candidates ?? d.drugs ?? [] // recordings made before the rename used "drugs"
        drugs.forEach((x) => drugLane.set(x.name, x.lane))
        step('embedding', 'output', `${drugs.length} drugs for the research agent`, drugs.map((x) => `${x.name} — ${x.profile}, rank ${x.drkg_rank} via ${x.via_gene}`).join('\n'))
        emit({ type: 'scene', src: `${AGENT_URL}${d.scene_url}` })
        emit({ type: 'stage', stage: 'embedding', status: 'done' })
        break
      }
    }
  }

  // ------------------------------------------------------------- 4 assess --
  function assess(e: AgentEvent) {
    const d = e.data ?? {}
    const lane = e.criterion ? drugLane.get(e.criterion) : undefined
    switch (e.type) {
      case 'run_started':
        emit({ type: 'stage', stage: 'research', status: 'running' })
        break
      case 'assess_loaded':
        step('research', 'thinking', `Assessing ${d.drugs?.length ?? 0} drugs`, `${(d.drugs ?? []).join(', ')}\n\nOne web researcher per drug (it sees the drug name only, never the patient), then the orchestrator ranks them against the record and ${d.profiles} target profiles.`)
        break
      case 'drug_research_started':
        step('research', 'tool_call', `research · ${e.criterion}`, json({ drug: e.criterion }), lane)
        break
      case 'web_search':
        step('research', 'tool_call', `web_search · ${e.criterion}`, json({ query: d.query }), lane)
        break
      case 'drug_research_finished':
        step('research', 'tool_result', `${e.criterion} — dossier`, `${d.searches} searches · ${d.sources} sources · ${d.seconds}s`, lane)
        break
      case 'drug_research_failed':
        step('research', 'tool_result', `${e.criterion} — failed`, d.error ?? '', lane)
        break
      case 'web_research':
        step('research', 'tool_call', 'web_research · orchestrator', json({ question: d.question }))
        break
      case 'pubmed_search':
        step('research', 'tool_call', 'pubmed_search · orchestrator', json({ query: d.query }))
        break
      case 'citation_revision':
        step('research', 'thinking', 'Adding citations', `${d.uncited_lines} claim${d.uncited_lines === 1 ? '' : 's'} had no PubMed citation; the orchestrator is revising them.`)
        break
      case 'report': {
        // score is 0–100 from the six criteria (older recordings had a 0–1 fit_score instead)
        const ranked: { rank: number; name: string; verdict: string; score?: number; fit_score?: number; headline?: string }[] = d.drugs ?? []
        const score = (x: (typeof ranked)[number]) => x.score ?? Math.round((x.fit_score ?? 0) * 100)
        step('research', 'output', 'Ranking', ranked.map((x) => `${x.rank}. ${x.name} — ${VERDICT[x.verdict] ?? x.verdict} · ${score(x)}/100${x.headline ? `\n   ${x.headline}` : ''}`).join('\n'))
        if (d.summary) step('research', 'output', 'Summary', d.summary)
        break
      }
    }
  }

  /** Upload the case PDF so Claude builds the patient record from it; reuse it if this file was read before. */
  async function ingest(file: CaseFile): Promise<string> {
    emit({ type: 'stage', stage: 'analysis', status: 'running' })
    const bytes = await (await fetch(file.url)).arrayBuffer()
    const id = await patientIdFor(bytes, file.patient.label)
    step('analysis', 'tool_call', 'ingest_case_pdf', json({ file: file.name, pages: file.pages, patient_id: id }))
    const known: string[] = (await (await fetch(`${AGENT_URL}/api/patients`)).json()).patients ?? []
    if (known.includes(id)) {
      step('analysis', 'tool_result', 'Patient record — result', `This file was read before; reusing its record "${id}".`)
      return id
    }
    step('analysis', 'thinking', 'Reading the case file', `Claude is reading ${file.name} into a structured patient record: diagnosis, genetics, medications, labs, function, symptoms and goals. Usually under a minute.`)
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: 'application/pdf' }), file.name)
    form.append('patient_id', id)
    form.append('synthetic', 'true') // the upload page asks for synthetic or de-identified cases only
    const r = await fetch(`${AGENT_URL}/api/patients`, { method: 'POST', body: form })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`Couldn't read the case file: ${body.detail ?? r.statusText}`)
    const counts = Object.entries((body.counts ?? {}) as Record<string, number>)
      .filter(([k, n]) => COUNT_LABEL[k] && n)
      .map(([k, n]) => `${n} ${COUNT_LABEL[k]}`)
    step('analysis', 'tool_result', 'Patient record — result', `Built the record "${id}" from ${file.name}${counts.length ? `: ${counts.join(', ')}` : ''}.`)
    return id
  }

  async function main() {
    const patientId = REPLAY.length ? AGENT_PATIENT : (resume.patient ?? (caseFile ? got('patient', await ingest(caseFile)) : AGENT_PATIENT))
    emit({ type: 'patient', id: patientId })
    if (closed) return
    const researchId = got('research', REPLAY[0] ?? resume.research ?? (await post('/api/research', { question, patient_id: patientId })))
    const researchDone = stream(researchId, research)
    researchDone.catch(() => {}) // awaited below; this only stops an "unhandled" warning meanwhile
    // Stage 3 starts at `verify`, not at the end of the run.
    const profiles = await Promise.race([targets, researchDone.then(() => Promise.reject(new Error('The research run ended without verifying any profiles.')))])
    if (closed) return
    const drkgId = got('drkg', REPLAY[1] ?? resume.drkg ?? (await post('/api/drkg', { research_run_id: researchId, patient_id: patientId, profiles })))
    const found = await stream(drkgId, drkg)
    // The assessment reads the run's ranked profiles, so it waits for the synthesis too.
    await researchDone
    if (closed) return
    if (REPLAY.length && !REPLAY[2]) {
      // A rehearsal without a recorded assessment: an expected end, not a failure.
      step('embedding', 'output', 'Replay ends here', 'No recorded drug assessment in VITE_AGENT_REPLAY_RUN, so stage 4 is skipped rather than started as a paid run.')
      return end()
    }
    const assessId = got('assess', REPLAY[2] ?? resume.assess ?? (await post('/api/assess', { patient_id: patientId, drugs_path: found.drugs_path, research_run_id: researchId })))
    await stream(assessId, assess)
    if (closed) return
    emit({ type: 'reportPdf', url: `${AGENT_URL}/api/research/${assessId}/report.pdf`, runId: assessId })
    emit({ type: 'report' })
    emit({ type: 'stage', stage: 'research', status: 'done' })
    end()
  }

  main().catch((err) => {
    if (!closed) end(err instanceof Error ? err.message : String(err))
  })

  return () => {
    closed = true
    ended = true
    sources.forEach((s) => s.close())
  }
}

// ------------------------------------------------------------ report chat --

export type ChatTurn = { role: 'user' | 'assistant'; content: string }
export type ChatReference = { n: number; citation: string; url: string; pmid?: string }
export type ChatAnswer = {
  answer: string
  references: ChatReference[]
  searches: { tool: string; query: string }[]
  dropped_citations: number
  query_redactions: number
}

const CHAT_TOOL: Record<string, string> = { pubmed_search: 'PubMed search', web_research: 'Web research' }

export type ChatHandlers = {
  /** A thinking summary, tool call or tool result, as it happens. */
  onStep: (s: AgentStep) => void
  /** The answer as it's written, token by token; citations are still raw [PMID:n] markers. */
  onDelta: (text: string) => void
  /** The text streamed so far wasn't the answer (that turn went on to call a tool): discard it. */
  onReset: () => void
}

/**
 * Ask the orchestrator a follow-up about a finished assessment (POST /api/assess/<id>/chat/stream).
 * Stateless: send the whole conversation. Resolves with the final answer, whose citations are
 * checked and numbered; rejects on an `error` event.
 */
export async function askReport(runId: string, messages: ChatTurn[], { onStep, onDelta, onReset }: ChatHandlers, signal?: AbortSignal): Promise<ChatAnswer> {
  const r = await fetch(`${AGENT_URL}/api/assess/${runId}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  })
  if (!r.ok || !r.body) throw new Error(`${r.status}: ${(await r.json().catch(() => ({}))).detail ?? r.statusText}`)
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    // sse-starlette ends lines with \r\n; a lone \r at a chunk edge may be half of one.
    buf += value
    const tail = buf.endsWith('\r') ? '\r' : ''
    buf = buf.slice(0, buf.length - tail.length).replace(/\r\n?/g, '\n') + tail
    let cut: number
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut)
      buf = buf.slice(cut + 2)
      let event = 'message'
      let data = ''
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trimStart()
      }
      if (!data) continue // keep-alive comment
      const d = JSON.parse(data)
      if (event === 'answer') return d as ChatAnswer
      if (event === 'error') throw new Error(d.message ?? 'The agent failed.')
      if (event === 'delta') {
        onDelta(d.text)
        continue
      }
      if (event === 'draft_reset') {
        onReset()
        continue
      }
      const tool = CHAT_TOOL[d.tool] ?? d.tool
      if (event === 'thinking') onStep({ type: 'thinking', label: 'Thinking', content: d.text })
      else if (event === 'tool_call')
        onStep({ type: 'tool_call', label: `${tool} · ${d.query}`, content: json(d.redactions ? { query: d.query, identifiers_removed: d.redactions } : { query: d.query }) })
      else if (event === 'tool_result') onStep({ type: 'tool_result', label: `${tool} — result`, content: d.content })
    }
  }
  throw new Error('The agent closed the connection without an answer.')
}
