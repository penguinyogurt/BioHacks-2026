/**
 * The data/pipeline.json contract, as a runtime schema.
 *
 * This file is the ONLY place the frontend learns the shape of the pipeline
 * output. Everything downstream consumes the inferred types, so a change here
 * surfaces as type errors at every use site instead of as undefined at the
 * expo table.
 *
 * Parsing is strict on purpose. merge.py emitting a field we don't expect is
 * fine; merge.py omitting one we render is not, and we want to know at load.
 */
import { z } from "zod";

export const STAGES = [
  "universe",
  "kg_relevance",
  "bbb",
  "patient_filter",
  "trial_history",
] as const;

export type Stage = (typeof STAGES)[number];

const stage = z.enum(STAGES);

export const funnelStageSchema = z.object({
  stage,
  label: z.string(),
  count: z.number().int().nonnegative(),
  eliminated: z.number().int().nonnegative(),
  top_reason: z.string().nullable(),
});

export const pathHopSchema = z.object({
  from: z.string(),
  rel: z.string(),
  to: z.string(),
});

export const filterResultSchema = z.object({
  rule: z.string(),
  passed: z.boolean(),
  /** Shown verbatim in the UI. Never paraphrased — it's the clinical receipt. */
  reason: z.string(),
});

const descriptorsSchema = z.object({
  mw: z.number(),
  logp: z.number(),
  tpsa: z.number(),
  hbd: z.number(),
});

/**
 * `prob` is nullable and MUST NOT be rendered when `in_domain` is false — the
 * model has no standing to predict on a molecule that far from its training
 * set. `nearest_tanimoto` is what we show instead.
 */
export const bbbSchema = z.object({
  prob: z.number().min(0).max(1).nullable(),
  in_domain: z.boolean(),
  nearest_tanimoto: z.number().min(0).max(1),
  descriptors: descriptorsSchema,
});

export const candidateSchema = z.object({
  id: z.string(),
  inchikey: z.string(),
  name: z.string(),
  smiles: z.string(),
  kg: z.object({
    score: z.number(),
    rank: z.number().int().positive(),
  }),
  path: z.array(pathHopSchema),
  bbb: bbbSchema,
  /** Ordered. Render in rule order; the first failure is the decisive one. */
  filters: z.array(filterResultSchema),
  verdict: z.enum(["survived", "eliminated"]),
  eliminated_at: stage.nullable(),
});

export const graveyardEntrySchema = z.object({
  name: z.string(),
  year: z.number().int(),
  phase: z.string(),
  bbb_prob: z.number().min(0).max(1),
  bucket: z.enum(["never_arrived", "arrived_failed"]),
  note: z.string(),
  source_url: z.string().url(),
});

export const pipelineSchema = z.object({
  meta: z.object({
    generated_at: z.string(),
    n_input: z.number().int().positive(),
    patient: z.string(),
    /** True while this is hand-written sample data. Drives a visible badge. */
    sample: z.boolean().default(false),
  }),
  funnel: z.array(funnelStageSchema).min(1),
  candidates: z.array(candidateSchema),
  graveyard: z.array(graveyardEntrySchema),
  validation: z.object({
    riluzole_rank: z.number().int().positive().nullable(),
    edaravone_rank: z.number().int().positive().nullable(),
    bbb_roc_auc: z.number().min(0).max(1).nullable(),
    bbb_roc_auc_published_baseline: z.number().min(0).max(1).nullable(),
    negatives_in_top_50: z.number().int().nonnegative().nullable(),
    partition: z.object({
      never_arrived: z.number().int().nonnegative(),
      arrived_failed: z.number().int().nonnegative(),
    }),
  }),
});

export type FunnelStage = z.infer<typeof funnelStageSchema>;
export type PathHop = z.infer<typeof pathHopSchema>;
export type FilterResult = z.infer<typeof filterResultSchema>;
export type Bbb = z.infer<typeof bbbSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type GraveyardEntry = z.infer<typeof graveyardEntrySchema>;
export type Pipeline = z.infer<typeof pipelineSchema>;

export type ParseResult =
  | { ok: true; data: Pipeline }
  | { ok: false; problems: string[] };

/** Parse at the boundary. Returns readable problems rather than throwing. */
export function parsePipeline(raw: unknown): ParseResult {
  const result = pipelineSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };

  const problems = result.error.issues
    .slice(0, 12)
    .map((issue) => `${issue.path.join(".") || "(root)"} — ${issue.message}`);
  return { ok: false, problems };
}

/** The decisive rule: first failure in order, or null if everything passed. */
export function firstFailure(c: Candidate): FilterResult | null {
  return c.filters.find((f) => !f.passed) ?? null;
}

export function passCount(c: Candidate): { passed: number; total: number } {
  return {
    passed: c.filters.reduce((n, f) => n + (f.passed ? 1 : 0), 0),
    total: c.filters.length,
  };
}
