import { detectBlendshapes } from "./landmarker";
import { COUNTDOWN_MS, EXPRESSIONS, HOLD_MS, INSTRUCTION_MS, type BlendshapeVector, type ExpressionId } from "./protocol";
import type { ExpressionCapture } from "./storage";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile90(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9));
  return sorted[idx];
}

/** Peak amplitude per blendshape category over the hold window (90th percentile, robust to a couple of bad frames). */
function peakVector(samples: BlendshapeVector[]): BlendshapeVector {
  const names = new Set<string>();
  for (const s of samples) for (const n of Object.keys(s)) names.add(n);
  const peak: BlendshapeVector = {};
  for (const name of names) {
    peak[name] = percentile90(samples.map((s) => s[name] ?? 0));
  }
  return peak;
}

async function holdAndCapture(video: HTMLVideoElement): Promise<BlendshapeVector> {
  const samples: BlendshapeVector[] = [];
  const deadline = performance.now() + HOLD_MS;
  while (performance.now() < deadline) {
    const v = detectBlendshapes(video, performance.now());
    if (v) samples.push(v);
    await sleep(0); // yield to the next animation/microtask without forcing a fixed frame rate
  }
  return peakVector(samples);
}

export type Prompt = (phase: "instruction" | "countdown" | "hold", label: string, cue: string) => void;

export async function runProtocol(video: HTMLVideoElement, onPrompt: Prompt): Promise<ExpressionCapture> {
  const result = {} as ExpressionCapture;
  for (const { id, label, cue } of EXPRESSIONS) {
    onPrompt("instruction", label, cue);
    await sleep(INSTRUCTION_MS);
    onPrompt("countdown", label, cue);
    await sleep(COUNTDOWN_MS);
    onPrompt("hold", label, cue);
    result[id as ExpressionId] = await holdAndCapture(video);
  }
  return result;
}
