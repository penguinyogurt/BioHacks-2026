import { startRecording, stopRecording } from "./render";
import {
  EXPRESSIONS,
  HOLD_MS,
  NEUTRAL_CUE,
  NEUTRAL_HOLD_MS,
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

export type Phase = "instruction" | "hold";
export type Prompt = (phase: Phase, label: string, cue: string, rep: number, repsTotal: number) => void;
/** Shows a button with this label and resolves when the person clicks it — the person paces the whole protocol. */
export type WaitForAdvance = (buttonLabel: string) => Promise<void>;

export async function runProtocol(onPrompt: Prompt, waitForAdvance: WaitForAdvance): Promise<Record<CaptureId, BlendshapeVector>> {
  const result = {} as Record<CaptureId, BlendshapeVector>;

  onPrompt("instruction", "Neutral", NEUTRAL_CUE, 1, 1);
  await waitForAdvance("Capture neutral face");
  onPrompt("hold", "Neutral", NEUTRAL_CUE, 1, 1);
  result.neutral = await hold(NEUTRAL_HOLD_MS);

  for (const { id, label, cue } of EXPRESSIONS) {
    const reps: BlendshapeVector[] = [];
    for (let rep = 0; rep < REPS_PER_EXPRESSION; rep++) {
      onPrompt("instruction", label, cue, rep + 1, REPS_PER_EXPRESSION);
      await waitForAdvance(rep === 0 ? `Capture ${label}` : `Capture ${label} again`);
      onPrompt("hold", label, cue, rep + 1, REPS_PER_EXPRESSION);
      reps.push(await hold(HOLD_MS));
    }
    result[id] = medianVector(reps);
  }

  return result;
}
