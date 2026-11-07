# FaceCheck — facial-movement-amplitude prototype

Standalone feasibility test for a computer-vision validation layer on top of
the slurred-speech check (see `ALS Motor Tracker — Measurement & Backend
Spec.md`). Not wired into that pipeline yet — this just answers "does
tracking facial expression amplitude over time actually work with a laptop
webcam and MediaPipe," before it's built into the real check-in flow.

## What it does

1. **Record baseline.** You perform five expressions (happy, sad, angry,
   surprised, disgust) on cue. For each, MediaPipe's `FaceLandmarker` runs
   on your webcam feed and the 52 ARKit-style blendshape scores are sampled
   through a ~2.5s hold; the 90th-percentile value per blendshape becomes
   that expression's baseline vector (90th rather than max/median to be
   robust to a stray bad frame without washing out peak amplitude).
2. **Run check-in.** Same five expressions, same timing. Each resulting
   vector is compared against the stored baseline vector for that
   expression.
3. **Compare.** Per expression:
   - **Amplitude index** — mean relative drop, `(baseline − current) /
     baseline`, over the blendshapes that were actually active at baseline
     (≥0.15). A rising amplitude index over repeated check-ins is the signal
     this prototype exists to test: reduced range of facial-muscle motion.
   - **Asymmetry** — for blendshapes MediaPipe reports as left/right pairs
     (e.g. `mouthSmileLeft`/`mouthSmileRight`), the same `AI = (L−R)/(L+R)`
     formula as the keystroke asymmetry index in the backend spec. Flagged
     when the absolute asymmetry grows by more than 0.08 vs. baseline.

Everything lives in `localStorage` — one baseline, a growing list of
check-ins. No backend, no upload.

## Run it

```bash
cd facecheck
npm install
npm run dev
```

Open the printed localhost URL, allow camera access. The face model and
WASM runtime load from Google's CDN on first use (~a few MB), then are
browser-cached.

## Why these particular expressions / this particular model

See the research notes from the conversation that produced this branch —
short version: bulbar ALS orofacial-kinematics literature (Bandini, Green,
Yunusova, Taati et al.) already validates video-based lip/jaw/cheek movement
analysis against ALSFRS-R bulbar scores and against clinician severity
ratings (Toronto NeuroFace dataset), including a 2026 paper doing exactly
this from plain RGB webcam video via face-mesh landmarks. MediaPipe's
blendshapes give the same kind of per-muscle-group amplitude number without
a depth camera or a Python backend hop.

## Known limitations (prototype, not a clinical tool)

- No run-in period, no baseline stability check, no per-device/lighting
  normalization — the backend spec's `baselines` table (median + MAD over
  10 sessions) isn't implemented here. One baseline session is noisy;
  don't read a single check-in's amplitude index as a verdict.
- The "active blendshape" set and the 0.15 / 0.08 thresholds are arbitrary
  starting values, not derived from any ALS dataset. Label them as such if
  this goes in front of a judge.
- Lighting, camera angle, glasses and facial hair all affect blendshape
  scores and aren't controlled for.
- This has not been validated against any ALS-labelled data — it is a
  plumbing test (can we reliably get a stable, comparable facial-amplitude
  number out of a webcam), not a validated biomarker.
