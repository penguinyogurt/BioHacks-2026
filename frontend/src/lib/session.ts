/**
 * What survives a page reload (or Chrome discarding a background tab): the current live
 * run's backend ids, and the uploaded case file. Browser-only: nothing here leaves the
 * machine. Every access can fail (private window, blocked storage), and then the app simply
 * starts empty, as it did before.
 */
import type { CaseFile } from './case-pdf'
import type { LiveIds } from './agent-api'
import type { Weights } from './pipeline'

export type SavedRun = { ids: LiveIds; goal: string; when: string; weights: Weights }

const RUN = 'addo.liveRun.v1'
const CASE = 'addo.caseFile.v1'
const CACHE = 'addo-case'
const PDF = '/__addo/case.pdf'

export function saveRun(run: SavedRun) {
  try {
    localStorage.setItem(RUN, JSON.stringify(run))
  } catch {
    /* storage unavailable: no resume after reload */
  }
}

export function loadRun(): SavedRun | null {
  try {
    const raw = localStorage.getItem(RUN)
    return raw ? (JSON.parse(raw) as SavedRun) : null
  } catch {
    return null
  }
}

export function clearRun() {
  try {
    localStorage.removeItem(RUN)
  } catch {
    /* nothing to clear */
  }
}

/** The parsed text goes to localStorage; the PDF itself to the Cache API, since it can be MBs. */
export async function saveCase(file: CaseFile | null) {
  try {
    const cache = await caches.open(CACHE)
    if (!file) {
      localStorage.removeItem(CASE)
      await cache.delete(PDF)
      return
    }
    const { url: _url, ...meta } = file
    await cache.put(PDF, new Response(await (await fetch(file.url)).blob(), { headers: { 'Content-Type': 'application/pdf' } }))
    localStorage.setItem(CASE, JSON.stringify(meta))
  } catch {
    /* storage unavailable or full: the case won't survive a reload */
  }
}

export async function loadCase(): Promise<CaseFile | null> {
  try {
    const raw = localStorage.getItem(CASE)
    if (!raw) return null
    const res = await (await caches.open(CACHE)).match(PDF)
    if (!res) return null
    return { ...(JSON.parse(raw) as Omit<CaseFile, 'url'>), url: URL.createObjectURL(await res.blob()) }
  } catch {
    return null
  }
}
