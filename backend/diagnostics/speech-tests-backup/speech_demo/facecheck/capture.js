import { startRecording, stopRecording } from "./render.js";
import { EXPRESSIONS, HOLD_MS, NEUTRAL_CUE, NEUTRAL_HOLD_MS, REPS_PER_EXPRESSION } from "./protocol.js";
function sleep(ms) {
    return new Promise((resolve)=>setTimeout(resolve, ms));
}
function percentile(values, p) {
    if (values.length === 0) return 0;
    const sorted = [
        ...values
    ].sort((a, b)=>a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
    return sorted[idx];
}
function peakVector(samples) {
    const names = new Set();
    for (const s of samples)for (const n of Object.keys(s))names.add(n);
    const peak = {};
    for (const name of names){
        peak[name] = percentile(samples.map((s)=>s[name] ?? 0), 0.9);
    }
    return peak;
}
function medianVector(reps) {
    const names = new Set();
    for (const r of reps)for (const n of Object.keys(r))names.add(n);
    const out = {};
    for (const name of names){
        out[name] = percentile(reps.map((r)=>r[name] ?? 0), 0.5);
    }
    return out;
}
async function hold(ms) {
    startRecording();
    await sleep(ms);
    return peakVector(stopRecording());
}
export async function runProtocol(onPrompt, waitForAdvance) {
    const result = {};
    onPrompt("instruction", "Neutral", NEUTRAL_CUE, 1, 1);
    await waitForAdvance("Capture neutral face");
    onPrompt("hold", "Neutral", NEUTRAL_CUE, 1, 1);
    result.neutral = await hold(NEUTRAL_HOLD_MS);
    for (const { id, label, cue } of EXPRESSIONS){
        const reps = [];
        for(let rep = 0; rep < REPS_PER_EXPRESSION; rep++){
            onPrompt("instruction", label, cue, rep + 1, REPS_PER_EXPRESSION);
            await waitForAdvance(rep === 0 ? `Capture ${label}` : `Capture ${label} again`);
            onPrompt("hold", label, cue, rep + 1, REPS_PER_EXPRESSION);
            reps.push(await hold(HOLD_MS));
        }
        result[id] = medianVector(reps);
    }
    return result;
}
