/**
 * Loads pipeline.json from the FastAPI connector (port 8731, proxied at /api).
 * The real file is ~11 MB; we do not inline it at build time.
 */
import { parsePipeline, type ParseResult } from "./contract";

export async function loadPipeline(): Promise<ParseResult> {
  const r = await fetch("/api/pipeline");
  if (!r.ok) {
    return { ok: false, problems: [`GET /api/pipeline ${r.status}`] };
  }
  return parsePipeline(await r.json());
}

/**
 * Bar width for a funnel stage, on a log scale.
 *
 * Linear widths are honest but unreadable here: 4,805 → 340 → 71 → 12 → 6
 * renders the first cut as the entire chart and the patient filter — the
 * original contribution — as a hairline. Log keeps every stage legible.
 */
export function logBarWidth(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return (Math.log(count + 1) / Math.log(max + 1)) * 100;
}
