/**
 * Loads and validates the pipeline output exactly once, at module scope.
 *
 * The JSON is imported as a module so Vite inlines it at build time: one
 * static artifact, no fetch, no loading spinner, and HMR reloads the page the
 * moment merge.py rewrites the file.
 */
import raw from "@data/pipeline.json";
import { parsePipeline, type ParseResult } from "./contract";

export const pipelineResult: ParseResult = parsePipeline(raw);

/**
 * Bar width for a funnel stage, on a log scale.
 *
 * Linear widths are honest but unreadable here: 4,805 → 340 → 71 → 12 → 6
 * renders the first cut as the entire chart and the patient filter — the
 * original contribution — as a hairline. Log keeps every stage legible. The
 * axis is labelled as log so the chart isn't lying about it.
 */
export function logBarWidth(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return (Math.log(count + 1) / Math.log(max + 1)) * 100;
}
