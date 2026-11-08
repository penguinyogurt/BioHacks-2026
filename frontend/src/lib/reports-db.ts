/**
 * Finished live reports, kept in Supabase so they outlive the backend's local runs/ folder
 * and follow the signed-in user to any machine. Schema: frontend/supabase/migrations/.
 *
 *   table  public.reports  one row per assessment run: ids, title, ranking, full report, chat
 *   bucket reports (private) <user_id>/<assess_run_id>.pdf
 *
 * Row-level security limits every row and PDF to its owner. Without Supabase configured or a
 * signed-in user, every function here is a no-op, so the app works exactly as before.
 */
import { supabase } from './supabase'
import { AGENT_URL, type LiveIds } from './agent-api'

export type SavedReport = {
  id: string
  assess_run_id: string
  research_run_id: string | null
  drkg_run_id: string | null
  patient_id: string | null
  title: string
  summary: string | null
  drugs: { rank: number; name: string; verdict: string; score?: number; headline?: string }[]
  pdf_path: string | null
  created_at: string
  /** report.patient: name and headline, for the card's paper title and the download name. */
  patient: { name?: string; headline?: string } | null
}

async function userId(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

/**
 * Save a finished run: the report JSON and PDF are fetched from the agent backend once and
 * stored. Idempotent (upsert on the assessment run id), so a resumed run saves harmlessly again.
 * 'off' when it can't be saved (Supabase not configured, or signed out).
 */
export async function saveReport(ids: LiveIds): Promise<{ status: 'saved' | 'off' } | { status: 'error'; message: string }> {
  const uid = await userId()
  if (!supabase || !uid || !ids.assess) return { status: 'off' }
  const fail = (message: string) => ({ status: 'error' as const, message })
  try {
    const res = await fetch(`${AGENT_URL}/api/research/${ids.assess}`)
    const { report } = await res.json()
    if (!report?.drugs) return fail('the backend has no finished report for this run')
    const pdf = await fetch(`${AGENT_URL}/api/research/${ids.assess}/report.pdf`)
    const pdfPath = `${uid}/${ids.assess}.pdf`
    if (pdf.ok) {
      const up = await supabase.storage.from('reports').upload(pdfPath, await pdf.blob(), { contentType: 'application/pdf', upsert: true })
      if (up.error) return fail(`PDF not saved: ${up.error.message}`)
    }
    const name = report.patient?.name || report.patient_id || 'patient'
    const { error } = await supabase.from('reports').upsert(
      {
        user_id: uid,
        assess_run_id: ids.assess,
        research_run_id: ids.research ?? null,
        drkg_run_id: ids.drkg ?? null,
        patient_id: report.patient_id ?? null,
        title: `Drug repurposing report · ${name}`,
        summary: report.summary ?? null,
        drugs: (report.drugs as any[]).map((d) => ({ rank: d.rank, name: d.name, verdict: d.verdict, score: d.score, headline: d.headline })),
        report,
        pdf_path: pdf.ok ? pdfPath : null,
      },
      { onConflict: 'user_id,assess_run_id', ignoreDuplicates: false },
    )
    return error ? fail(`Report not saved: ${error.message}`) : { status: 'saved' }
  } catch (e) {
    return fail(`Report not saved: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** The signed-in user's saved reports, newest first ([] when signed out). */
export async function listReports(): Promise<SavedReport[]> {
  if (!supabase || !(await userId())) return []
  const { data } = await supabase
    .from('reports')
    .select('id, assess_run_id, research_run_id, drkg_run_id, patient_id, title, summary, drugs, pdf_path, created_at, patient:report->patient')
    .order('created_at', { ascending: false })
  return (data as SavedReport[] | null) ?? []
}

/** A short-lived link to a saved PDF (the bucket is private). With `download`, it saves under that name. */
export async function pdfLink(path: string, download?: string): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.storage.from('reports').createSignedUrl(path, 60 * 10, download ? { download } : undefined)
  return data?.signedUrl ?? null
}

/** The report chat for one assessment run, as saved after its last answer. */
export async function loadChat<T>(assessRunId: string): Promise<T[] | null> {
  if (!supabase || !(await userId())) return null
  const { data } = await supabase.from('reports').select('chat').eq('assess_run_id', assessRunId).maybeSingle()
  return (data?.chat as T[] | undefined) ?? null
}

/** Replace the saved chat. A no-op until the run's report row exists (saveReport). */
export async function saveChat(assessRunId: string, turns: unknown[]) {
  if (!supabase || !(await userId())) return
  await supabase.from('reports').update({ chat: turns }).eq('assess_run_id', assessRunId)
}
