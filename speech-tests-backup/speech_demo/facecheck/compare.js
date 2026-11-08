import { ASYMMETRY_PAIRS, EXPRESSIONS, EXPRESSION_PRIMARY_BLENDSHAPES, MIN_SESSIONS_FOR_ROBUST_STATS } from "./protocol.js";
const STABILITY_THRESHOLD = 0.04;
export function humanize(name) {
    let suffix = "";
    let base = name;
    if (name.endsWith("Left")) {
        suffix = " (left)";
        base = name.slice(0, -4);
    } else if (name.endsWith("Right")) {
        suffix = " (right)";
        base = name.slice(0, -5);
    }
    const words = base.replace(/^_/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1) + suffix;
}
function descriptorFor(relativeDrop) {
    if (relativeDrop >= 0.35) return "much less expressive";
    if (relativeDrop >= 0.15) return "less expressive";
    if (relativeDrop >= -0.15) return "about the same";
    if (relativeDrop >= -0.35) return "more expressive";
    return "much more expressive";
}
export function severityOf(amplitudeIndex) {
    if (amplitudeIndex >= 0.2) return "reduced";
    if (amplitudeIndex >= 0.1) return "mild";
    return "normal";
}
function severityFromZ(z) {
    if (z >= 2) return "reduced";
    if (z >= 1) return "mild";
    return "normal";
}
export const SEVERITY_LABEL = {
    normal: "Normal range",
    mild: "Mild drop",
    reduced: "Reduced"
};
function netVector(raw, neutral) {
    const out = {};
    const names = new Set([
        ...Object.keys(raw),
        ...Object.keys(neutral)
    ]);
    for (const name of names){
        out[name] = Math.max(0, (raw[name] ?? 0) - (neutral[name] ?? 0));
    }
    return out;
}
function asymmetryIndex(vector, base) {
    const l = vector[`${base}Left`] ?? 0;
    const r = vector[`${base}Right`] ?? 0;
    if (l + r === 0) return 0;
    return (l - r) / (l + r);
}
function median(values) {
    if (values.length === 0) return 0;
    const sorted = [
        ...values
    ].sort((a, b)=>a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function mad(values, center) {
    return median(values.map((v)=>Math.abs(v - center)));
}
function relativeDrop(baseline, current) {
    if (baseline < STABILITY_THRESHOLD) return 0;
    const raw = (baseline - current) / baseline;
    return Math.max(-1, Math.min(1.5, raw));
}
function expressionAmplitudeIndex(id, baseline, current) {
    const baselineNet = netVector(baseline[id], baseline.neutral);
    const currentNet = netVector(current[id], current.neutral);
    const drops = EXPRESSION_PRIMARY_BLENDSHAPES[id].map((n)=>relativeDrop(baselineNet[n] ?? 0, currentNet[n] ?? 0));
    return drops.reduce((sum, d)=>sum + d, 0) / drops.length;
}
function compareExpressionDetailed(id, baseline, current, severity, basis, z) {
    const label = EXPRESSIONS.find((e)=>e.id === id)?.label ?? id;
    const baselineNet = netVector(baseline[id], baseline.neutral);
    const currentNet = netVector(current[id], current.neutral);
    const topBlendshapes = EXPRESSION_PRIMARY_BLENDSHAPES[id].map((name)=>{
        const b = baselineNet[name] ?? 0;
        const c = currentNet[name] ?? 0;
        const drop = relativeDrop(b, c);
        return {
            name,
            baseline: b,
            current: c,
            relativeDrop: drop,
            descriptor: descriptorFor(drop)
        };
    }).sort((a, b)=>b.baseline - a.baseline);
    const asymmetry = ASYMMETRY_PAIRS.map((pair)=>{
        const baselineAI = asymmetryIndex(baseline[id], pair);
        const currentAI = asymmetryIndex(current[id], pair);
        return {
            pair,
            baselineAI,
            currentAI,
            shift: Math.abs(currentAI) - Math.abs(baselineAI)
        };
    }).filter((a)=>Math.abs(a.baselineAI) > 0.02 || Math.abs(a.currentAI) > 0.02);
    return {
        id,
        label,
        topBlendshapes,
        amplitudeIndex: expressionAmplitudeIndex(id, baseline, current),
        severity,
        basis,
        z,
        asymmetry
    };
}
export function compareSession(baseline, priorSessions, current) {
    const priorOverall = [];
    const priorPerExpression = {
        happy: [],
        sad: [],
        angry: [],
        surprised: [],
        disgust: []
    };
    for (const s of priorSessions){
        const perExpr = EXPRESSIONS.map((e)=>expressionAmplitudeIndex(e.id, baseline, s));
        perExpr.forEach((v, i)=>priorPerExpression[EXPRESSIONS[i].id].push(v));
        priorOverall.push(perExpr.reduce((sum, v)=>sum + v, 0) / perExpr.length);
    }
    const enoughHistory = priorSessions.length + 1 >= MIN_SESSIONS_FOR_ROBUST_STATS;
    const expressions = EXPRESSIONS.map(({ id })=>{
        const value = expressionAmplitudeIndex(id, baseline, current);
        const history = priorPerExpression[id];
        const m = median(history);
        const spread = mad(history, m) * 1.4826;
        const useRobust = enoughHistory && spread > 0.01;
        const z = useRobust ? (value - m) / spread : undefined;
        const severity = useRobust ? severityFromZ(Math.abs(z)) : severityOf(value);
        return compareExpressionDetailed(id, baseline, current, severity, useRobust ? "robust" : "flat", z);
    });
    const overallAmplitudeIndex = expressions.reduce((sum, e)=>sum + e.amplitudeIndex, 0) / expressions.length;
    const overallMedian = median(priorOverall);
    const overallSpread = mad(priorOverall, overallMedian) * 1.4826;
    const useRobustOverall = enoughHistory && overallSpread > 0.01;
    const overallZ = useRobustOverall ? (overallAmplitudeIndex - overallMedian) / overallSpread : undefined;
    const overallSeverity = useRobustOverall ? severityFromZ(Math.abs(overallZ)) : severityOf(overallAmplitudeIndex);
    return {
        expressions,
        overallAmplitudeIndex,
        overallSeverity,
        overallBasis: useRobustOverall ? "robust" : "flat",
        overallZ
    };
}
export function sessionAmplitudeIndex(baseline, session) {
    const perExpr = EXPRESSIONS.map((e)=>expressionAmplitudeIndex(e.id, baseline, session));
    return perExpr.reduce((sum, v)=>sum + v, 0) / perExpr.length;
}
