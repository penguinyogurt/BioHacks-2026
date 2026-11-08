# FaceCheck — facial-movement-amplitude prototype

Standalone feasibility test for a computer-vision validation layer on top of
the slurred-speech check (see `ALS Motor Tracker — Measurement & Backend
Spec.md`). Not wired into that pipeline yet — this just answers "does
tracking facial expression amplitude over time actually work with a laptop
webcam and MediaPipe," before it's built into the real check-in flow.

## What it does

1. **Record baseline.** First a ~1.8s **neutral/relaxed face** capture (used
   to normalize everything else — see below), then five expressions (happy,
   sad, angry, surprised, disgust) on cue, each performed **twice** with a
   short relax in between. MediaPipe's `FaceLandmarker` runs on your webcam
   feed; for each hold, the 90th-percentile value per blendshape becomes
   that rep's vector, and the two reps are combined by per-blendshape
   median — one bad rep (blink, camera hiccup) doesn't dominate.
2. **Run check-in.** Same protocol. Compared against baseline.
3. **Compare.** Per expression:
   - Both the baseline and the check-in vectors are first **normalized
     against that session's own neutral-face capture** (`net = max(0, raw −
     neutral)`). This is the biggest single accuracy fix: without it, a
     darker room or sitting further from the camera on check-in day reads
     as "weaker expression," because the whole blendshape vector shifts
     together. Subtracting each session's own resting face removes that
     common-mode offset.
   - The amplitude index and the "lead muscle" shown are computed only over
     a **curated, expression-specific blendshape set** (e.g. angry →
     `browDown` + `mouthPress` + `noseSneer`, not whatever happened to read
     highest). Previously the code picked "top by baseline value" across
     all 52 blendshapes, which is why unrelated expressions could all show
     the same incidental muscle (a real bug, caught from a demo
     screenshot).
   - **Severity is history-aware, not baseline-vs-one-checkin.** Once there
     are at least 2 prior check-ins, severity for a given expression is a
     robust z-score — `(today − median) / (1.4826 × MAD)` of that person's
     own prior amplitude-index values — the same formula the backend
     spec's keystroke-drift detector uses. Below that it falls back to a
     flat percentage band and the UI says so explicitly ("rule-of-thumb
     read — record N more check-ins for a statistical read"). This is the
     direct fix for "right now it's just baseline vs. recent": one sample
     either side of a comparison is noise; a handful of check-ins lets the
     app judge today against the person's own spread instead of a global
     threshold.
   - **Asymmetry** — for blendshapes MediaPipe reports as left/right pairs
     (e.g. `mouthSmileLeft`/`mouthSmileRight`), the same `AI = (L−R)/(L+R)`
     formula as the keystroke asymmetry index in the backend spec. Flagged
     when the absolute asymmetry grows by more than 0.08 vs. baseline.
4. **Live landmark mesh overlay**, for demo purposes — the full 478-point
   face mesh plus a bolder contour outline is drawn on the camera feed in
   real time (`FaceLandmarker.FACE_LANDMARKS_TESSELATION` /
   `_CONTOURS` via `DrawingUtils`), mirrored to match the preview. A small
   "tracking / no face detected" indicator in the corner reflects whether a
   face was found in the last ~0.5s.

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

## Still not done (next accuracy levers, roughly in priority order)

- **Multiple baseline sessions**, not one — the backend spec's own
  `baselines` table uses 10 sessions' median+MAD, not a single recording.
  Right now "baseline" is one capture; it should be the robust center of a
  short run-in.
- **Onset velocity, not just peak amplitude.** The Parkinson's
  hypomimia/bradykinesia literature (OpenFace AU-derivative work) found
  *slowness reaching* the expression discriminates better than how far it
  gets. We only capture a hold-and-peak; capturing frames during the
  transition into the expression would add a velocity feature.
- **Head-pose quality gate.** No check that the face is roughly frontal
  during capture; a turned head will distort blendshape readings and
  nothing currently rejects/redoes for it.
- **Confounder self-report** (sleep, "feeling unwell?") before each
  check-in, excluded from trend stats — same pattern as the rest of the
  backend spec.
- The curated per-expression blendshape sets are a reasonable AU-informed
  guess, not derived from any ALS or FACS dataset specific to this task —
  label them as such if presenting.

## Known limitations (prototype, not a clinical tool)

- Lighting, camera angle, glasses and facial hair all affect blendshape
  scores; neutral-normalization helps with session-level offsets but
  doesn't fully remove this.
- This has not been validated against any ALS-labelled data — it is a
  plumbing test (can we reliably get a stable, comparable facial-amplitude
  number out of a webcam), not a validated biomarker.
