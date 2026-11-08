import { loadFaceLandmarker } from "./landmarker.js";
import { faceCurrentlyVisible, setMeshVisible, startRenderLoop } from "./render.js";
import { runProtocol } from "./capture.js";
import { appendSession, clearStore, loadStore, saveBaseline } from "./storage.js";
import { compareSession, humanize, sessionAmplitudeIndex, severityOf, SEVERITY_LABEL } from "./compare.js";
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const promptEl = document.getElementById("prompt");
const promptTextEl = document.getElementById("prompt-text");
const promptAdvanceEl = document.getElementById("prompt-advance");
const btnBaseline = document.getElementById("btn-baseline");
const btnCheckin = document.getElementById("btn-checkin");
const btnReset = document.getElementById("btn-reset");
const faceIndicator = document.getElementById("face-indicator");
const faceIndicatorText = document.getElementById("face-indicator-text");
const chkMesh = document.getElementById("chk-mesh");
function setStatus(text) {
    statusEl.textContent = text;
}
function showPrompt(phase, label, cue, rep, repsTotal) {
    promptEl.classList.remove("hidden");
    const repTag = repsTotal > 1 ? ` (${rep}/${repsTotal})` : "";
    const phaseText = phase === "instruction" ? cue : "Hold it!";
    promptTextEl.textContent = `${label}${repTag} — ${phaseText}`;
}
function hidePrompt() {
    promptEl.classList.add("hidden");
    promptAdvanceEl.classList.add("hidden");
}
const waitForAdvance = (buttonLabel)=>new Promise((resolve)=>{
        promptAdvanceEl.textContent = buttonLabel;
        promptAdvanceEl.classList.remove("hidden");
        promptAdvanceEl.onclick = ()=>{
            promptAdvanceEl.classList.add("hidden");
            resolve();
        };
    });
function refreshButtons() {
    const store = loadStore();
    btnCheckin.disabled = !store.baseline;
    btnCheckin.title = store.baseline ? "" : "Record a baseline first";
}
function pct(x) {
    return `${(x * 100).toFixed(0)}%`;
}
function overallBlurb(severity) {
    if (severity === "normal") {
        return "Movement across all five expressions is close to your baseline — within normal session-to-session noise.";
    }
    if (severity === "mild") {
        return "Facial movement is somewhat weaker than your baseline on average. Worth tracking over a few more check-ins before reading much into it.";
    }
    return "Facial movement is noticeably weaker than your baseline across expressions. One session can be noisy (lighting, distance, fatigue) — repeat before treating this as a trend.";
}
function basisBlurb(basis, priorCount, z) {
    if (basis === "robust") {
        return `Statistical read: ${z >= 0 ? "+" : ""}${z.toFixed(1)}σ from your own history (${priorCount} prior check-ins).`;
    }
    const need = Math.max(0, 2 - priorCount);
    return `Rule-of-thumb read (flat % threshold) — record ${need > 0 ? `${need} more check-in${need > 1 ? "s" : ""}` : "one more check-in"} to switch to a statistical read against your own history.`;
}
function renderComparisons(cmp, baseline, store) {
    const priorCount = store.sessions.length - 1;
    const cards = cmp.expressions.map((e)=>{
        const lead = e.topBlendshapes[0];
        const leadBar = `
        <div class="lead-compare">
          <span class="lead-name">${humanize(lead.name)} — <em>${lead.descriptor}</em></span>
          <div class="bshape-bars">
            <div class="bar baseline" style="width:${lead.baseline * 100}%"></div>
            <div class="bar current" style="width:${lead.current * 100}%"></div>
          </div>
        </div>
        <p class="legend"><span class="dot baseline"></span> baseline <span class="dot current"></span> this check-in</p>`;
        const detailRows = e.topBlendshapes.map((b)=>`
        <div class="bshape-row">
          <span class="bshape-name">${humanize(b.name)}<br /><em class="descriptor">${b.descriptor}</em></span>
          <div class="bshape-bars">
            <div class="bar baseline" style="width:${b.baseline * 100}%"></div>
            <div class="bar current" style="width:${b.current * 100}%"></div>
          </div>
          <span class="bshape-drop ${b.relativeDrop > 0.2 ? "warn" : ""}">${pct(b.relativeDrop)}</span>
        </div>`).join("");
        const asymRows = e.asymmetry.filter((a)=>Math.abs(a.shift) > 0.08).map((a)=>`<li class="${a.shift > 0 ? "warn" : ""}">${humanize(a.pair)}: left/right balance moved from ${a.baselineAI.toFixed(2)} to ${a.currentAI.toFixed(2)}</li>`).join("");
        return `
      <article class="expr-card severity-${e.severity}">
        <header>
          <h3>${e.label}</h3>
          <span class="badge badge-${e.severity}">${SEVERITY_LABEL[e.severity]}</span>
        </header>
        ${leadBar}
        <details>
          <summary>Details (${e.topBlendshapes.length} tracked muscles)</summary>
          <div class="bshape-list">${detailRows}</div>
          ${asymRows ? `<p class="legend" style="margin-top:0.5rem">Left/right balance shift</p><ul class="asym-list">${asymRows}</ul>` : ""}
        </details>
      </article>`;
    }).join("");
    resultsEl.innerHTML = `
    <div class="overall-card severity-${cmp.overallSeverity}">
      <div class="overall-top">
        <span class="badge badge-${cmp.overallSeverity} large">${SEVERITY_LABEL[cmp.overallSeverity]}</span>
        <span class="overall-number">${pct(cmp.overallAmplitudeIndex)} <span class="overall-number-label">average amplitude drop</span></span>
      </div>
      <p class="overall-blurb">${overallBlurb(cmp.overallSeverity)}</p>
      <p class="basis-blurb">${basisBlurb(cmp.overallBasis, priorCount, cmp.overallZ)}</p>
    </div>
    <div class="expr-grid">${cards}</div>
    ${renderHistory(baseline, store)}
  `;
}
function renderHistory(baseline, store) {
    if (store.sessions.length === 0) return "";
    const rows = store.sessions.map((s)=>{
        const value = sessionAmplitudeIndex(baseline.expressions, s.expressions);
        const severity = severityOf(value);
        return `<tr>
        <td>${new Date(s.capturedAt).toLocaleString()}</td>
        <td>${pct(value)}</td>
        <td><span class="badge badge-${severity} small">${SEVERITY_LABEL[severity]}</span></td>
      </tr>`;
    }).join("");
    return `
    <section class="history">
      <h3>Check-in history</h3>
      <table>
        <thead><tr><th>Date</th><th>Avg. amplitude drop</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td>${new Date(baseline.capturedAt).toLocaleString()}</td><td>—</td><td class="baseline-tag">baseline</td></tr>
          ${rows}
        </tbody>
      </table>
    </section>`;
}
async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: {
            width: 640,
            height: 480,
            facingMode: "user"
        },
        audio: false
    });
    video.srcObject = stream;
    await video.play();
}
async function runSession(mode) {
    btnBaseline.disabled = true;
    btnCheckin.disabled = true;
    btnReset.disabled = true;
    setStatus(mode === "baseline" ? "Recording baseline…" : "Running check-in…");
    const onPrompt = (phase, label, cue, rep, repsTotal)=>showPrompt(phase, label, cue, rep, repsTotal);
    const expressions = await runProtocol(onPrompt, waitForAdvance);
    hidePrompt();
    const session = {
        capturedAt: new Date().toISOString(),
        expressions
    };
    if (mode === "baseline") {
        saveBaseline(session);
        setStatus("Baseline recorded. Run a check-in any time to compare against it.");
        resultsEl.innerHTML = "";
    } else {
        const store = loadStore();
        const priorCaptures = store.sessions.map((s)=>s.expressions);
        const cmp = compareSession(store.baseline.expressions, priorCaptures, expressions);
        appendSession(session);
        const updatedStore = loadStore();
        renderComparisons(cmp, store.baseline, updatedStore);
        setStatus("Check-in complete.");
    }
    btnBaseline.disabled = false;
    btnReset.disabled = false;
    refreshButtons();
}
btnBaseline.addEventListener("click", ()=>void runSession("baseline"));
btnCheckin.addEventListener("click", ()=>void runSession("checkin"));
btnReset.addEventListener("click", ()=>{
    if (!confirm("Clear the stored baseline and all check-ins?")) return;
    clearStore();
    resultsEl.innerHTML = "";
    refreshButtons();
    setStatus("Stored data cleared.");
});
function describeError(err) {
    if (err instanceof Error) return err.message;
    try {
        return JSON.stringify(err);
    } catch  {
        return String(err);
    }
}
async function init() {
    try {
        await startCamera();
    } catch (err) {
        console.error(err);
        setStatus(`Camera access denied or unavailable: ${describeError(err)}`);
        return;
    }
    setStatus("Loading face model…");
    try {
        await loadFaceLandmarker();
    } catch (err) {
        console.error(err);
        setStatus(`Could not load the face model (needs internet on first load): ${describeError(err)}`);
        return;
    }
    startRenderLoop(video, overlay);
    faceIndicator.classList.remove("hidden");
    setInterval(()=>{
        const visible = faceCurrentlyVisible();
        faceIndicator.classList.toggle("lost", !visible);
        faceIndicatorText.textContent = visible ? "tracking" : "no face detected";
    }, 300);
    chkMesh.addEventListener("change", ()=>setMeshVisible(chkMesh.checked));
    setMeshVisible(chkMesh.checked);
    setStatus("Ready.");
    btnBaseline.disabled = false;
    refreshButtons();
}
void init();
