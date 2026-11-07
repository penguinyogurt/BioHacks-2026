import { ASYMMETRY_PAIRS, EXPRESSIONS, type BlendshapeVector, type ExpressionId } from "./protocol";
import type { ExpressionCapture } from "./storage";

/** Only blendshapes that actually moved at baseline count toward the amplitude index. */
const ACTIVE_THRESHOLD = 0.15;
const TOP_N = 6;

export type BlendshapeDelta = {
  name: string;
  baseline: number;
  current: number;
  /** Fraction below baseline; positive = weaker than baseline, negative = stronger. */
  relativeDrop: number;
};

/** "mouthSmileLeft" -> "Mouth smile (left)" */
export function humanize(name: string): string {
  const side = name.endsWith("Left") ? " (left)" : name.endsWith("Right") ? " (right)" : "";
  const base = side ? name.slice(0, -side.trim().length - 1) : name;
  const words = base
    .replace(/^_/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1) + side;
}

export type Severity = "normal" | "mild" | "reduced";

export function severityOf(amplitudeIndex: number): Severity {
  if (amplitudeIndex >= 0.2) return "reduced";
  if (amplitudeIndex >= 0.1) return "mild";
  return "normal";
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  normal: "Normal range",
  mild: "Mild drop",
  reduced: "Reduced",
};

export type AsymmetryReading = {
  pair: string;
  baselineAI: number;
  currentAI: number;
  /** How much more asymmetric than baseline (absolute AI difference). Positive = worse. */
  shift: number;
};

export type ExpressionComparison = {
  id: ExpressionId;
  label: string;
  topBlendshapes: BlendshapeDelta[];
  amplitudeIndex: number; // mean relativeDrop over the active set, 0..1+ (can go negative)
  asymmetry: AsymmetryReading[];
};

function asymmetryIndex(vector: BlendshapeVector, base: string): number {
  const l = vector[`${base}Left`] ?? 0;
  const r = vector[`${base}Right`] ?? 0;
  if (l + r === 0) return 0;
  return (l - r) / (l + r);
}

export function compareExpression(
  id: ExpressionId,
  baseline: BlendshapeVector,
  current: BlendshapeVector,
): ExpressionComparison {
  const label = EXPRESSIONS.find((e) => e.id === id)?.label ?? id;

  const names = Object.keys(baseline).sort(
    (a, b) => (baseline[b] ?? 0) - (baseline[a] ?? 0),
  );
  const activeSet = names.filter((n) => (baseline[n] ?? 0) >= ACTIVE_THRESHOLD);

  const deltas: BlendshapeDelta[] = activeSet.map((name) => {
    const b = baseline[name] ?? 0;
    const c = current[name] ?? 0;
    return { name, baseline: b, current: c, relativeDrop: b === 0 ? 0 : (b - c) / b };
  });

  const amplitudeIndex =
    deltas.length === 0
      ? 0
      : deltas.reduce((sum, d) => sum + d.relativeDrop, 0) / deltas.length;

  const topBlendshapes = deltas
    .slice()
    .sort((a, b) => (baseline[b.name] ?? 0) - (baseline[a.name] ?? 0))
    .slice(0, TOP_N);

  const asymmetry: AsymmetryReading[] = ASYMMETRY_PAIRS.map((pair) => {
    const baselineAI = asymmetryIndex(baseline, pair);
    const currentAI = asymmetryIndex(current, pair);
    return { pair, baselineAI, currentAI, shift: Math.abs(currentAI) - Math.abs(baselineAI) };
  }).filter((a) => Math.abs(a.baselineAI) > 0.02 || Math.abs(a.currentAI) > 0.02);

  return { id, label, topBlendshapes, amplitudeIndex, asymmetry };
}

export function compareSession(
  baseline: ExpressionCapture,
  current: ExpressionCapture,
): { expressions: ExpressionComparison[]; overallAmplitudeIndex: number } {
  const expressions = EXPRESSIONS.map((e) =>
    compareExpression(e.id, baseline[e.id], current[e.id]),
  );
  const overallAmplitudeIndex =
    expressions.reduce((sum, e) => sum + e.amplitudeIndex, 0) / expressions.length;
  return { expressions, overallAmplitudeIndex };
}
