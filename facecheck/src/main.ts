import "./style.css";
import { loadFaceLandmarker } from "./landmarker";
import { runProtocol, type Prompt } from "./capture";
import { appendSession, clearStore, loadStore, saveBaseline, type Session } from "./storage";
import { compareSession, type ExpressionComparison } from "./compare";

const video = document.getElementById("video") as HTMLVideoElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const promptEl = document.getElementById("prompt") as HTMLDivElement;
const promptTextEl = document.getElementById("prompt-text") as HTMLSpanElement;
const btnBaseline = document.getElementById("btn-baseline") as HTMLButtonElement;
const btnCheckin = document.getElementById("btn-checkin") as HTMLButtonElement;
const btnReset = document.getElementById("btn-reset") as HTMLButtonElement;

function setStatus(text: string) {
  statusEl.textContent = text;
}

function showPrompt(phase: "instruction" | "countdown" | "hold", label: string, cue: string) {
  promptEl.classList.remove("hidden");
  const phaseText = phase === "instruction" ? cue : phase === "countdown" ? "Get ready…" : "Hold it!";
  promptTextEl.textContent = `${label} — ${phaseText}`;
}

function hidePrompt() {
  promptEl.classList.add("hidden");
}

function refreshButtons() {
  const store = loadStore();
  btnCheckin.disabled = !store.baseline;
  btnCheckin.title = store.baseline ? "" : "Record a baseline first";
}

function renderComparisons(expressions: ExpressionComparison[], overall: number) {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const cards = expressions
    .map((e) => {
      const bars = e.topBlendshapes
        .map(
          (b) => `
        <div class="bshape-row">
          <span class="bshape-name">${b.name}</span>
          <div class="bshape-bars">
            <div class="bar baseline" style="width:${b.baseline * 100}%"></div>
            <div class="bar current" style="width:${b.current * 100}%"></div>
          </div>
          <span class="bshape-drop ${b.relativeDrop > 0.2 ? "warn" : ""}">${pct(b.relativeDrop)}</span>
        </div>`,
        )
        .join("");

      const asym = e.asymmetry
        .filter((a) => Math.abs(a.shift) > 0.08)
        .map(
          (a) => `<li class="${a.shift > 0 ? "warn" : ""}">${a.pair}: AI ${a.baselineAI.toFixed(2)} → ${a.currentAI.toFixed(2)}</li>`,
        )
        .join("");

      return `
      <article class="expr-card">
        <header>
          <h3>${e.label}</h3>
          <span class="amp ${e.amplitudeIndex > 0.2 ? "warn" : ""}">amplitude index ${pct(e.amplitudeIndex)}</span>
        </header>
        <div class="bshape-list">${bars}</div>
        ${asym ? `<ul class="asym-list">${asym}</ul>` : ""}
      </article>`;
    })
    .join("");

  resultsEl.innerHTML = `
    <div class="overall ${overall > 0.2 ? "warn" : ""}">Overall amplitude index: ${pct(overall)}</div>
    <div class="expr-grid">${cards}</div>
    ${renderHistory()}
  `;
}

function renderHistory() {
  const store = loadStore();
  if (!store.baseline) return "";
  const rows = store.sessions
    .map((s) => {
      const { overallAmplitudeIndex } = compareSession(store.baseline!.expressions, s.expressions);
      return `<tr><td>${new Date(s.capturedAt).toLocaleString()}</td><td>${(overallAmplitudeIndex * 100).toFixed(0)}%</td></tr>`;
    })
    .join("");
  return `
    <section class="history">
      <h3>Check-in history</h3>
      <table>
        <thead><tr><th>Date</th><th>Overall amplitude index</th></tr></thead>
        <tbody>
          <tr><td>${new Date(store.baseline.capturedAt).toLocaleString()} (baseline)</td><td>0%</td></tr>
          ${rows}
        </tbody>
      </table>
    </section>`;
}

async function startCamera(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

async function runSession(mode: "baseline" | "checkin") {
  btnBaseline.disabled = true;
  btnCheckin.disabled = true;
  btnReset.disabled = true;
  setStatus(mode === "baseline" ? "Recording baseline…" : "Running check-in…");

  const onPrompt: Prompt = (phase, label, cue) => showPrompt(phase, label, cue);
  const expressions = await runProtocol(video, onPrompt);
  hidePrompt();

  const session: Session = { capturedAt: new Date().toISOString(), expressions };

  if (mode === "baseline") {
    saveBaseline(session);
    setStatus("Baseline recorded. Run a check-in any time to compare against it.");
    resultsEl.innerHTML = "";
  } else {
    appendSession(session);
    const store = loadStore();
    const { expressions: comparisons, overallAmplitudeIndex } = compareSession(
      store.baseline!.expressions,
      expressions,
    );
    renderComparisons(comparisons, overallAmplitudeIndex);
    setStatus("Check-in complete.");
  }

  btnBaseline.disabled = false;
  btnReset.disabled = false;
  refreshButtons();
}

btnBaseline.addEventListener("click", () => void runSession("baseline"));
btnCheckin.addEventListener("click", () => void runSession("checkin"));
btnReset.addEventListener("click", () => {
  if (!confirm("Clear the stored baseline and all check-ins?")) return;
  clearStore();
  resultsEl.innerHTML = "";
  refreshButtons();
  setStatus("Stored data cleared.");
});

async function init() {
  try {
    await startCamera();
  } catch (err) {
    setStatus(`Camera access denied or unavailable: ${(err as Error).message}`);
    return;
  }
  setStatus("Loading face model…");
  try {
    await loadFaceLandmarker();
  } catch (err) {
    setStatus(`Could not load the face model (needs internet on first load): ${(err as Error).message}`);
    return;
  }
  setStatus("Ready.");
  btnBaseline.disabled = false;
  refreshButtons();
}

void init();
