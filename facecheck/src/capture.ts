import { startRecording, stopRecording } from "./render";
import {
  COUNTDOWN_MS,
  EXPRESSIONS,
  HOLD_MS,
  INSTRUCTION_MS,
  NEUTRAL_CUE,
  NEUTRAL_HOLD_MS,
  RELAX_MS,
  REPS_PER_EXPRESSION,
  type BlendshapeVector,
  type CaptureId,
} from "./protocol";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

/** Peak amplitude per blendshape category over a hold window (90th percentile, robust to a stray bad frame). */
function peakVector(samples: BlendshapeVector[]): BlendshapeVector {
  const names = new Set<string>();
  for (const s of samples) for (const n of Object.keys(s)) names.add(n);
  const peak: BlendshapeVector = {};
  for (const name of names) {
    peak[name] = percentile(
      samples.map((s) => s[name] ?? 0),
      0.9,
    );
  }
  return peak;
}

/** Combine repeated attempts at the same expression into one vector via per-blendshape median. */
function medianVector(reps: BlendshapeVector[]): BlendshapeVector {
  const names = new Set<string>();
  for (const r of reps) for (const n of Object.keys(r)) names.add(n);
  const out: BlendshapeVector = {};
  for (const name of names) {
    out[name] = percentile(
      reps.map((r) => r[name] ?? 0),
      0.5,
    );
  }
  return out;
}

async function hold(ms: number): Promise<BlendshapeVector> {
  startRecording();
  await sleep(ms);
  return peakVector(stopRecording());
}

export type Phase = "instruction" | "countdown" | "hold" | "relax";
export type Prompt = (phase: Phase, label: string, cue: string) => void;

export async function runProtocol(onPrompt: Prompt): Promise<Record<CaptureId, BlendshapeVector>> {
  const result = {} as Record<CaptureId, BlendshapeVector>;

  onPrompt("instruction", "Neutral", NEUTRAL_CUE);
  await sleep(INSTRUCTION_MS);
  onPrompt("hold", "Neutral", NEUTRAL_CUE);
  result.neutral = await hold(NEUTRAL_HOLD_MS);

  for (const { id, label, cue } of EXPRESSIONS) {
    onPrompt("instruction", label, cue);
    await sleep(INSTRUCTION_MS);
    onPrompt("countdown", label, cue);
    await sleep(COUNTDOWN_MS);

    const reps: BlendshapeVector[] = [];
    for (let rep = 0; rep < REPS_PER_EXPRESSION; rep++) {
      onPrompt("hold", label, cue);
      reps.push(await hold(HOLD_MS));
      if (rep < REPS_PER_EXPRESSION - 1) {
        onPrompt("relax", label, cue);
        await sleep(RELAX_MS);
      }
    }
    result[id] = medianVector(reps);
  }

  return result;
}
