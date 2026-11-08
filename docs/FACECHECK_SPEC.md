# FaceCheck — engineering spec

Webcam-based tracking of facial-movement amplitude, used as a bulbar-function
signal for ALS. It checks the speech signal and stands next to it.

Status: prototype on `cursor/facial-als-validation` (`facecheck/`). This doc
covers what it's for, what's built, what's still open, what we need to
research, and how four people split the work before the **9:00 am Sunday
2026-11-08** soft deadline.

---

## 1. The idea in one paragraph

Bulbar ALS weakens the muscles of the lips, jaw, tongue and face. Today that
gets tracked through ALSFRS-R items 1–3 (speech, salivation, swallowing),
which a clinician scores at visits months apart. Our speech work
(`codex/speech-quality-experiments`) scores voice from short vowel and
syllable tasks. FaceCheck adds a **second, independent channel**. A laptop
webcam and MediaPipe FaceLandmarker measure how far a person can move their
face on cue, normalized against their own neutral face, and compare it with
their own history. Two channels that agree are worth far more than one. A
channel that runs entirely in the browser, with no upload, is something a
patient could do at home every day.

**What we claim:** that a stable, comparable, per-person facial-amplitude
number can be pulled reliably from consumer hardware, and that its design
follows the published orofacial-kinematics literature.
**What we do not claim:** that it is a validated ALS biomarker. It hasn't been
tested on ALS-labelled data yet, and every screen must say so.

---

## 2. What exists today (prototype)

| Piece | File | State |
|---|---|---|
| Landmarker load (WASM + model from Google CDN) | `src/landmarker.ts` | Done. Versions pinned after a mismatch bug |
| Button-paced protocol: neutral + 5 expressions × 2 reps | `src/protocol.ts`, `src/capture.ts` | Done |
| Per-hold vector = p90 per blendshape; reps combined by median | `src/capture.ts` | Done |
| Neutral-face normalization `net = max(0, raw − neutral)` | `src/compare.ts` | Done |
| Curated per-expression blendshape sets → amplitude index | `src/protocol.ts` | Done (AU-informed guess, not data-derived) |
| History-aware severity: robust z = (x − median) / (1.4826·MAD) once ≥3 sessions; flat bands before that | `src/compare.ts` | Done |
| Left/right asymmetry index `(L−R)/(L+R)` | `src/compare.ts` | Done |
| Live mesh overlay + face-detected indicator | `src/render.ts` | Done |
| Storage: one baseline + list of check-ins in `localStorage` | `src/storage.ts` | Done (`facecheck:v2`) |

Gaps, in priority order (from `facecheck/README.md`):
1. Single-session baseline (it should be the median and MAD of a short run-in)
2. No onset velocity, only peak amplitude
3. No head-pose quality gate
4. No confounder self-report
5. Expression set and blendshape sets aren't tied to anything ALS-specific

---

## 3. Target system

```
webcam ──► FaceLandmarker (VIDEO mode, blendshapes + transform matrix)
              │  per frame: 52 blendshapes, 478 landmarks, head pose, timestamp
              ▼
        quality gate ── rejects: no face, |yaw|/|pitch| > limit, low fps, blink-in-hold
              ▼
        task segmenter (button-paced: instruction → onset → hold → release)
              ▼
        feature extractor ── per task: peak (p90), onset time-to-80%, peak velocity,
              │                 asymmetry, hold stability (CV), landmark distances
              ▼
        session record (JSON, versioned) ──► localStorage  ──► export facecheck_session.json
              ▼
        comparator ── baseline = run-in median/MAD; today's robust z per feature;
              │         confounder-flagged sessions excluded from trend stats
              ▼
        results UI (plain-language cards, trend, "not a diagnosis" framing)
```

### 3.1 Task protocol (v3 proposal)

Keep the five emotional expressions for the demo, since they're easy to
understand. But **add non-emotional oral-motor tasks**, which match the
clinical literature and are less affected by pseudobulbar affect (see R4):

| Task | Cue | Primary signal | Why |
|---|---|---|---|
| Neutral | Relax completely | Normalization reference | Removes lighting/distance offset |
| Spread | Say "eeee" with a wide smile | `mouthSmile*`, `mouthStretch*`, lip-corner distance | Orbicularis oris / zygomaticus |
| Pucker | "oooo", lips pushed forward | `mouthPucker`, `mouthFunnel`, lip width shrink | Lip rounding is an early bulbar sign |
| Open jaw | Open as wide as you can | `jawOpen`, inter-lip distance | Jaw range of motion |
| Cheek puff | Puff cheeks, hold air | `cheekPuff` | Lip seal (ties to drooling/saliva item) |
| Brow raise | Eyebrows up | `browInnerUp`, `browOuterUp*` | **Internal control**: upper face is relatively spared in ALS |
| Lip DDK | "pa-pa-pa" for 5 s | Rate and regularity of lip closures over time | Overlaps the speech `PA` task, so it can be fused (R7) |

The brow-raise control matters. If *every* task drops on the same day,
lighting, effort or fatigue is the likely cause. If lower-face tasks drop and
brow raise holds, that pattern is consistent with bulbar change. (This is a
hypothesis to state carefully, not a claim; see R2.)

### 3.2 Features per task

- **Peak amplitude:** p90 of net blendshape over the hold (exists)
- **Onset velocity:** time from cue-advance to 80% of peak, plus max d/dt.
  Needs per-frame timestamps from `requestVideoFrameCallback`, not an
  assumed fps.
- **Hold stability:** coefficient of variation during the hold (tremor and
  fatigue proxy)
- **Asymmetry:** `(L−R)/(L+R)` per pair (exists)
- **Geometric distances**, e.g. lip-corner width and inter-lip gap,
  normalized by inter-ocular distance. A cross-check on blendshapes, which
  are a learned and opaque model.
- **DDK:** closure count/sec and inter-closure interval CV from a
  `jawOpen`/lip-gap time series (peak picking, same approach as the speech
  envelope code)

### 3.3 Quality gate

Each hold is rejected and re-prompted if any of these hold:
- no face for >10% of hold frames
- |yaw| or |pitch| > ~15° (from `facialTransformationMatrixes`)
- effective fps < 15
- face bounding box < ~20% of frame width (too far away)

Accepted holds store their quality metrics, so the analysis can weight them
or exclude them later.

### 3.4 Baseline and stats

- Baseline = **run-in of N sessions** (N = 3 for the demo, 5–10 in
  principle). Per feature, store the median and the MAD.
- Today's z = (x − median) / (1.4826·MAD). Floor the spread so one perfectly
  repeatable run-in doesn't turn noise into a 10σ alarm.
- Flags: |z| ≥ 2 on a lower-face composite **and** brow control |z| < 1 →
  "lower-face change, consistent with bulbar pattern — repeat to confirm".
  Everything else gets neutral wording.
- Confounder questions before each check-in: slept badly? unwell? new
  medication? glasses or facial-hair change? Answering yes keeps the session
  but leaves it out of the trend stats.

### 3.5 Session JSON (export / integration)

```jsonc
{
  "schema": "facecheck.session.v3",
  "captured_at": "2026-11-07T14:02:00Z",
  "device": { "fps_median": 29.7, "resolution": [1280, 720] },
  "confounders": { "poor_sleep": false, "unwell": false },
  "tasks": {
    "pucker": {
      "quality": { "face_frac": 0.99, "yaw_max_deg": 6.1, "accepted": true },
      "features": { "peak": 0.71, "onset_ms": 420, "vmax": 3.2, "hold_cv": 0.06, "asym": 0.03 }
    }
  },
  "summary": { "lower_face_z": -0.4, "control_z": 0.1, "flag": "none" }
}
```

This file is FaceCheck's own output. It follows the repo's architecture rule
(section 6): **it must not be imported by the drug pipeline**. If we ever
connect them, a "bulbar status" value goes into `patient_profile` through
`merge.py` (e.g. a swallowing concern rules out large oral tablets at stage
4). That is a cut-line stretch goal, and changing the contract needs the
whole team to agree.

---

## 4. Research points

Each item lists the question, why it matters, and the deliverable. Owner
initials go in the brackets. Cite real papers only: if you can't find the
source, write "unverified" rather than guessing an author or year.

### Clinical grounding
- **R1. What does facial/orofacial involvement look like in ALS?** Lower vs
  upper face, the order in which lip, jaw and tongue are affected, and UMN
  (spastic) vs LMN (flaccid) patterns. *Matters for* task choice and the
  brow-control hypothesis. *Deliverable:* ½-page summary with citations.
- **R2. Is the upper face really relatively spared?** The brow-control idea
  rests on this. Find direct evidence or downgrade it to "assumption".
- **R3. Mapping to ALSFRS-R bulbar items 1–3.** Which of our features could
  plausibly track speech, salivation or swallowing? (Cheek puff → lip seal →
  saliva is our guess.) *Deliverable:* a mapping table marking each row
  "literature-backed" or "our hypothesis".
- **R4. Pseudobulbar affect (PBA).** It's common in ALS and causes
  involuntary or exaggerated laughing and crying. It could *inflate*
  emotional-expression amplitude and hide weakness. *Matters for* the case
  for adding non-emotional oral-motor tasks. *Deliverable:* prevalence
  estimate + one-line design implication.
- **R5. Confounders:** fatigue and time of day, medications (e.g.
  riluzole, dextromethorphan/quinidine for PBA), dentures, facial hair,
  glasses, Bell's palsy or stroke history. *Deliverable:* the confounder
  question list.

### Prior work and data
- **R6. Orofacial-kinematics literature:** Bandini, Green, Yunusova, Taati
  et al. Which tasks did they use, which features separated ALS from
  controls, and which correlated with ALSFRS-R bulbar scores? Do any use
  plain RGB video and face-mesh landmarks? *Deliverable:* a table of paper →
  tasks → features → effect → hardware.
- **R7. Toronto NeuroFace dataset:** what's in it (ALS / post-stroke /
  healthy, tasks, labels), how to get access, and the licence. Can we get it
  **before Sunday**? Probably not. If not, cite it as the validation route
  and say so.
- **R8. Parkinson's hypomimia work** (OpenFace AU derivatives): evidence
  that onset velocity discriminates better than peak. Supports Gap 2.
- **R9. MediaPipe blendshape validity:** what the 52 blendshapes are
  (ARKit-style; a learned model, not FACS AUs), any published agreement with
  FACS or OpenFace, and known failure modes (beards, glasses, dark skin
  tones, low light). *Deliverable:* a limitations paragraph we can show
  judges.
- **R10. Other consumer facial-ALS apps or studies:** what's been tried and
  what we do differently (fully on-device, per-person baseline, a speech
  channel alongside).

### Measurement science
- **R11. Test–retest reliability:** ICC and minimal detectable change for
  our features in healthy people. **We can measure this ourselves** in the
  hackathon: 4 teammates × 5 sessions. It's the most credible number we can
  show.
- **R12. Simulated impairment:** instructed 50%-effort and "lips stiff" runs
  on healthy teammates. Does the index drop, and does brow control stay
  flat? This shows sensitivity in principle. It is not ALS validation, so
  label it that way.
- **R13. Environment robustness:** the same person at 3 lighting levels × 2
  distances × glasses on/off. How much does neutral-normalization actually
  remove?
- **R14. Fusion with speech:** synchronized audio + video on `PA/TA/KA` and
  vowel tasks. Do lip-closure rate (face) and syllable rate (audio) agree?
  Simple agreement only; no fused model before Sunday.

### Ethics and framing
- **R15. Privacy:** everything stays on-device and no frames are stored.
  Only blendshape vectors are kept. Confirm that's true in code. It belongs
  in the pitch.
- **R16. Non-diagnostic language:** wording rules for results ("weaker than
  your baseline", never "progression detected"), and when to say "talk to
  your clinician".

---

## 5. Work split — 4 people

Split by **separate file ownership**, mirroring the repo's decoupling rule.
Interfaces are the session JSON (§3.5) and `ExpressionCapture` /
`Session` types.

### P1 — Capture & signal quality
Owns `capture.ts`, `landmarker.ts`, `render.ts`.
- Per-frame time series with `requestVideoFrameCallback` timestamps
- Head-pose quality gate (§3.3) + re-prompt flow
- Onset/hold segmentation; onset velocity, hold CV
- New oral-motor tasks + lip DDK capture
- Research: **R9, R13**

### P2 — Analytics & stats
Owns `compare.ts`, `storage.ts`, a new `features.ts`, and a node test file
(`compare.test.ts`, same pattern as `backend/contract/contract.test.ts`).
- Run-in baseline (median/MAD across N sessions), spread floor
- Feature-level z-scores, lower-face composite vs brow control, flag logic
- Confounder exclusion from trend stats
- Session JSON export (`facecheck.session.v3`) + storage migration v2→v3
- Research: **R11, R12** (runs the reliability study on the team, computes
  the ICC and MDC)

### P3 — Clinical research & validation story
Owns `docs/FACECHECK_RESEARCH.md` + task cues and wording in `protocol.ts`.
- **R1–R8, R10, R16**, with citations checked
- Final task list and per-task blendshape sets, each labelled
  "literature-backed" or "our guess"
- Confounder question list (R5)
- The 90-second pitch narrative and the one limitations slide
- Toronto NeuroFace access attempt (R7)

### P4 — UI, demo & integration
Owns `main.ts`, `style.css`, `index.html`.
- Results cards for the new features; trend sparkline per feature
- Confounder pre-check screen; quality-gate re-prompt UI
- Demo mode: seeded history (clearly labelled synthetic) so judges see a
  trend without five real sessions
- Speech + face side by side (R14) if P1 delivers synced capture
- Visual consistency with `frontend/` (Motus — see its index.css; colour
  never the only signal; see `CLAUDE.md` skills)
- Research: **R14, R15**

### Sync points

| When (Sat → Sun) | What |
|---|---|
| Sat 15:00 | Kickoff. Lock the task list (P3 → P1) and the session JSON shape (P2 ↔ P4) |
| Sat 19:00 | P1 frame series + pose gate merged; P2 builds features on it |
| Sat 22:00 | Reliability sessions recorded (everyone sits 5×); P3 research draft |
| Sun 02:00 | Feature freeze. P2 ICC/MDC numbers; P4 integrates real results |
| Sun 07:00 | Demo run-through ×3 on the expo laptop, offline check (CDN model cached!) |
| **Sun 09:00** | **Code freeze.** Pitch only from here |

### Cut lines (drop from the bottom first)
1. ~~Speech + face fusion view~~
2. ~~Lip DDK task~~
3. ~~Geometric landmark distances~~
4. ~~Confounder screen~~ (keep the wording disclaimer)
5. **Never cut:** pose gate, run-in baseline, reliability numbers,
   limitations framing

---

## 6. Constraints carried from the repo

- FaceCheck is **standalone**. It does not import from `frontend/` or the Python
  modules, and they don't import from it (AGENTS.md architecture rule).
- `backend/data/pipeline.json` and its contract stay untouched unless the whole team
  agrees (§3.5).
- **Offline at the expo:** the MediaPipe WASM and model load from Google's
  CDN. Before Sunday, vendor them into `facecheck/public/` or prove the
  browser cache holds. A failed CDN request means a dead demo.
- Every non-trivial piece of logic leaves one runnable check behind.

## 7. Open questions

- Do we show emotional expressions at all in the final demo, or only
  oral-motor tasks? (Depends on R4.)
- Is a 3-session run-in honest enough to call "baseline"?
- Does FaceCheck ship as its own page, or as a tab in Motus (`frontend/`)? (It's a
  separate Vite project today. Merging costs P4 time; keeping it separate
  costs nothing.)
