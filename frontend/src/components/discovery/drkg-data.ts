import { useEffect, useState } from 'react'

/**
 * Loads the precomputed DRKG scene written by `frontend/scripts/drkg_scene.py`
 * into `public/drkg/`. Nothing here computes embeddings: positions are a PCA-3
 * projection of the 400-d TransE vectors, distances are the true 400-d L2.
 */

export type Vec3 = [number, number, number]

export type DrkgGene = {
  symbol: string
  id: string
  row: number
  pos: Vec3
  /** Projection of e[gene] − r[target]. PCA is linear, so the arrow pos → query is exact. */
  query: Vec3
  targetEdges: number
  alsEdge: string | null
}

export type DrkgMatch = {
  rank: number
  id: string
  row: number
  name: string
  pos: Vec3
  /** True 400-d L2 from the profile's query. */
  distance: number
  viaGene: string
  directEdge: boolean
}

export type DrkgProfile = {
  lane: number
  name: string
  genes: DrkgGene[]
  unresolved: string[]
  matches: DrkgMatch[]
  edges: { from: number; to: number; rel: string }[]
}

export type DrkgScene = {
  meta: {
    model: string
    entities: number
    projection: string
    /** null for the clustered (non-linear) layout */
    explainedVariance: number[] | null
    relation: string
    formula: string
    universe: number
    topK: number
    /** Graph degree summary; present once `degree.bin` is written. */
    degree?: { min: number; median: number; p99: number; max: number }
  }
  types: { name: string; count: number }[]
  /** Optional: written once the layout is clustered; `clusters.bin` indexes into it. */
  clusters?: { id: number; label: string; size: number; dominantType: string; color?: string }[]
  als: { id: string; row: number; pos: Vec3; label: string }
  profiles: DrkgProfile[]
  handWritten: { drug: string; lane: number; source: string; id: string | null; rank: number | null; distance: number | null }[]
}

export type DrkgData = { scene: DrkgScene; positions: Float32Array; types: Uint8Array; clusters: Uint8Array | null; degree: Uint32Array | null }

/** A run is a folder: `scene.json` plus the binaries written beside it. Point `src` at a live backend's run. */
export const DEFAULT_SRC = '/drkg/scene.json'

const dirOf = (src: string) => src.slice(0, src.lastIndexOf('/') + 1)

async function get(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res
}

const runs = new Map<string, Promise<DrkgData>>()
const nameCache = new Map<string, Promise<Record<string, string>>>()

export function loadDrkg(src = DEFAULT_SRC) {
  let run = runs.get(src)
  if (run) return run
  const base = dirOf(src)
  run = Promise.all([
    get(src).then((r) => r.json() as Promise<DrkgScene>),
    get(base + 'points.bin').then((r) => r.arrayBuffer()),
    get(base + 'types.bin').then((r) => r.arrayBuffer()),
    get(base + 'clusters.bin').then((r) => r.arrayBuffer(), () => null),
    get(base + 'degree.bin').then((r) => r.arrayBuffer(), () => null),
  ]).then(([scene, p, t, c, d]) => ({
    scene,
    positions: new Float32Array(p),
    types: new Uint8Array(t),
    // Vite's dev server answers a missing file with index.html, so check the length too.
    clusters: c && c.byteLength === t.byteLength && scene.clusters ? new Uint8Array(c) : null,
    degree: d && d.byteLength === t.byteLength * 4 && scene.meta.degree ? new Uint32Array(d) : null,
  }))
  runs.set(src, run)
  run.catch(() => runs.delete(src)) // let a later mount retry
  return run
}

/** Hover labels for every entity; ~1 MB, so only fetched on first hover. */
export function loadNames(src = DEFAULT_SRC) {
  let names = nameCache.get(src)
  if (!names) {
    names = get(dirOf(src) + 'names.json').then((r) => r.json())
    nameCache.set(src, names)
    names.catch(() => nameCache.delete(src))
  }
  return names
}

export function useDrkg(src = DEFAULT_SRC) {
  const [state, setState] = useState<{ data: DrkgData | null; error: string | null }>({ data: null, error: null })
  useEffect(() => {
    let live = true
    loadDrkg(src).then(
      (data) => live && setState({ data, error: null }),
      (e: Error) => live && setState({ data: null, error: e.message }),
    )
    return () => {
      live = false
    }
  }, [src])
  return state
}
