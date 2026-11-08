/**
 * The whole-DRKG neighbour data in `public/drkg/graph/` (contract: index.json,
 * ids.txt, names-extra.json, shard-NNN.bin). Every loader resolves to `null`
 * when its file is missing, so a fresh clone still gets the canvas and the
 * names.json search from `public/drkg/`.
 */

const GRAPH_DIR = '/drkg/graph/'
const MAGIC = 0x314b4744

export type GraphIndex = {
  version: 1
  entities: number
  triples: number
  shardSize: number
  shards: number
  edgeCap: number
  knnK: number
  knnScope: string
  relations: { name: string; source: string; label: string; head: string; tail: string; count: number }[]
  types: { name: string; count: number }[]
  externalUrl: Record<string, string>
}

type Shard = {
  firstRow: number
  knnK: number
  edgeOffsets: Uint32Array
  edges: Uint32Array
  relOffsets: Uint32Array
  relCounts: Uint32Array
  knnRows: Uint32Array
  knnDist: Float32Array
}

/** One entity's slice of its shard; views, not copies. */
export type EntityGraph = { edges: Uint32Array; relCounts: Uint32Array; knnRows: Uint32Array; knnDist: Float32Array }

export const edgeNbr = (e: number) => e & 0x1ffff
export const edgeRel = (e: number) => (e >>> 17) & 0x7f
export const edgeOut = (e: number) => ((e >>> 24) & 1) === 1
export const relIdx = (e: number) => e >>> 24
export const relCount = (e: number) => e & 0xffffff

// Vite's dev server answers a missing file with index.html (200), so every
// loader validates its shape and maps anything wrong to null.
async function fetchOk(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res
}

function once<T>(fn: () => Promise<T>) {
  let p: Promise<T> | null = null
  return () => {
    p ??= fn().catch((e) => {
      p = null // a later call retries
      throw e
    })
    return p
  }
}

export const loadIndex = once(async (): Promise<GraphIndex | null> => {
  try {
    const idx = (await (await fetchOk(GRAPH_DIR + 'index.json')).json()) as GraphIndex
    return idx?.version === 1 && idx.shardSize > 0 ? idx : null
  } catch {
    return null
  }
})

export const loadIds = once(async (): Promise<string[] | null> => {
  try {
    const ids = (await (await fetchOk(GRAPH_DIR + 'ids.txt')).text()).split('\n')
    if (ids.at(-1) === '') ids.pop()
    return ids.length > 1000 && ids[0].includes('::') ? ids : null
  } catch {
    return null
  }
})

export const loadNamesExtra = once(async (): Promise<Record<string, string>> => {
  try {
    return (await (await fetchOk(GRAPH_DIR + 'names-extra.json')).json()) as Record<string, string>
  } catch {
    return {}
  }
})

const shards = new Map<number, Promise<Shard>>()

function loadShard(s: number) {
  let p = shards.get(s)
  if (p) return p
  p = fetchOk(`${GRAPH_DIR}shard-${String(s).padStart(3, '0')}.bin`)
    .then((r) => r.arrayBuffer())
    .then(decodeShard)
  shards.set(s, p)
  p.catch(() => shards.delete(s))
  return p
}

function decodeShard(buf: ArrayBuffer): Shard {
  const h = new Uint32Array(buf, 0, 8)
  if (h[0] !== MAGIC) throw new Error('not a DRKG graph shard')
  const [, firstRow, rowCount, nEdges, nRel, knnK] = h
  let o = 32
  const u32 = (n: number) => {
    const a = new Uint32Array(buf, o, n)
    o += n * 4
    return a
  }
  const edgeOffsets = u32(rowCount + 1)
  const edges = u32(nEdges)
  const relOffsets = u32(rowCount + 1)
  const relCounts = u32(nRel)
  const knnRows = u32(rowCount * knnK)
  const knnDist = new Float32Array(buf, o, rowCount * knnK)
  return { firstRow, knnK, edgeOffsets, edges, relOffsets, relCounts, knnRows, knnDist }
}

export async function loadEntity(row: number, index: GraphIndex): Promise<EntityGraph> {
  const sh = await loadShard(Math.floor(row / index.shardSize))
  const i = row - sh.firstRow
  const k = sh.knnK
  return {
    edges: sh.edges.subarray(sh.edgeOffsets[i], sh.edgeOffsets[i + 1]),
    relCounts: sh.relCounts.subarray(sh.relOffsets[i], sh.relOffsets[i + 1]),
    knnRows: sh.knnRows.subarray(i * k, (i + 1) * k),
    knnDist: sh.knnDist.subarray(i * k, (i + 1) * k),
  }
}

/** Longest matching id prefix wins; `{id}` is what follows it. */
export function externalUrl(id: string, map: Record<string, string>) {
  let best = ''
  for (const p in map) if (id.startsWith(p) && p.length > best.length) best = p
  return best && map[best] ? map[best].replace('{id}', encodeURIComponent(id.slice(best.length))) : null
}

/* ----------------------------------------------------------------- search -- */

export type SearchIndex = { label: string[]; lower: string[]; idLower: string[]; bare: string[]; scores: Float64Array; alias: Map<string, number> }

/** What a judge types that no label contains: acronyms → the entity they mean. */
const ALIASES: Record<string, string> = {
  als: 'disease::mesh:d000690',
  'tdp-43': 'gene::23435',
  tdp43: 'gene::23435',
}

/** `label[row]`: the best human name we have, falling back to the id's local part. */
export function buildSearch(n: number, names: Record<string, string>, extra: Record<string, string>, ids: string[] | null): SearchIndex {
  const label = new Array<string>(n)
  const lower = new Array<string>(n)
  const idLower = new Array<string>(n)
  const bare = new Array<string>(n)
  for (let i = 0; i < n; i++) {
    const id = ids?.[i] ?? ''
    const l = names[i] ?? extra[i] ?? (id ? id.slice(id.indexOf('::') + 2) : '')
    label[i] = l
    lower[i] = l.toLowerCase()
    idLower[i] = id.toLowerCase()
    bare[i] = idLower[i].slice(idLower[i].indexOf('::') + 2)
  }
  const alias = new Map<string, number>()
  for (const [q, id] of Object.entries(ALIASES)) {
    const row = idLower.indexOf(id)
    if (row >= 0) alias.set(q, row)
  }
  return { label, lower, idLower, bare, scores: new Float64Array(n), alias }
}

const isWordChar = (c: number) => (c >= 48 && c <= 57) || (c >= 97 && c <= 122)

/** 4 exact · 3 prefix · 2 word-prefix · 1 substring · 0 none. */
function score(s: string, q: string) {
  if (!s) return 0
  const at = s.indexOf(q)
  if (at < 0) return 0
  if (at === 0) return s.length === q.length ? 4 : 3
  for (let k = at; k >= 0; k = s.indexOf(q, k + 1)) if (!isWordChar(s.charCodeAt(k - 1))) return 2
  return 1
}

/** Linear scan: ~97k `indexOf`, a few ms; ties by degree desc. */
export function search(q: string, idx: SearchIndex, degree: Uint32Array | null, types: Uint8Array, only: Set<number>, limit = 30) {
  const query = q.trim().toLowerCase()
  if (!query) return []
  const hits: number[] = []
  const scores = idx.scores // reused across keystrokes; only hit rows are read
  for (let i = 0; i < idx.label.length; i++) {
    if (only.size && !only.has(types[i])) continue
    const s = Math.max(score(idx.lower[i], query), score(idx.idLower[i], query), score(idx.bare[i], query))
    if (s) {
      hits.push(i)
      scores[i] = s * 1e7 + (degree ? Math.min(degree[i], 9_999_999) : 0)
    }
  }
  hits.sort((a, b) => scores[b] - scores[a])
  const a = idx.alias.get(query)
  if (a !== undefined && (!only.size || only.has(types[a]))) return [a, ...hits.filter((r) => r !== a)].slice(0, limit)
  return hits.slice(0, limit)
}

/* ---------------------------------------------------------------- self-test -- */

if (import.meta.env?.DEV && typeof window !== 'undefined' && !(window as { __graphDataTested?: boolean }).__graphDataTested) {
  ;(window as { __graphDataTested?: boolean }).__graphDataTested = true
  const e = 70000 | (5 << 17) | (1 << 24)
  console.assert(edgeNbr(e) === 70000 && edgeRel(e) === 5 && edgeOut(e), 'edge decode')
  console.assert(relIdx((9 << 24) | 1234) === 9 && relCount((9 << 24) | 1234) === 1234, 'relCount decode')
  console.assert(score('riluzole', 'riluzole') === 4 && score('riluzole tab', 'ril') === 3 && score('acid riluzole', 'ril') === 2 && score('xriluzole', 'ril') === 1, 'score tiers')
  console.assert(externalUrl('Gene::6647', { 'Gene::': 'g/{id}', 'Gene::66': 'x/{id}' }) === 'x/47', 'longest prefix')
}
