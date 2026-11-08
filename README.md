# Motus — early ALS detection, from how you move

**BioHacks 2026.** ALS is usually caught late. The signal that something is
changing shows up in movement — how you speak, how you type, how you write —
months before a clinic visit scores it.

Motus measures those three channels at home, against **your own baseline**,
and shows the drift. Not "you look like an ALS patient" — "this is slower
than you were in August, and it has been for 66 sessions."

---

## Run it

```bash
npm install --prefix frontend && npm run dev --prefix frontend
```

Opens on <http://localhost:5173>. The dashboard at `/home` renders
immediately against deterministic sample data — no Supabase, no backend, no
keys needed. It shows a **"Sample data"** badge while that's the source.

Sign-in needs Supabase keys; copy `frontend/.env.example` to `frontend/.env`
and fill them in.

## What it shows

180 days of at-home sessions across three domains:

```
Speech       (bulbar)       rate · DDK · pause ratio · phonation · HNR
Typing       (fine motor)   speed · inter-key interval · hold · corrections
Handwriting  (fine motor)   stroke velocity · jerk · pressure · spiral
```

Each feature is z-scored against the person's own first 28 days. A domain
goes **Watch** at −1σ and **Flagged** at −2σ, and only when the change
persists — not on one bad day. The sample tells a bulbar-onset story: speech
drifts first, then typing, then handwriting.

Nothing here is a diagnosis, and every screen says so.

## Also in this repo

| | |
|---|---|
| `backend/` | Everything else: research agent, query generation, validation, diagnostics, and the `pipeline.json` contract |
| `backend/contract/` | Schema + validator for `backend/data/pipeline.json` |
| `docs/` | Specs, research, decisions, status |

The drug-repurposing pipeline and FaceCheck have their own branches. See [`AGENTS.md`](AGENTS.md) for the map.

## Standalone diagnostic tests

Launch the complete session on this Mac:

```sh
cd ~/Documents/BioHacks && python3 backend/diagnostics/master-app/diagnostic_complete.py
```

The master app opens at http://127.0.0.1:8772. Select **Begin** on each animated introduction, then complete the facial expression challenge, passage reading, and line tracing in order. Review each test’s results and select **Proceed To Next Test**. The speech test includes three passages with word-level playback. After all five tracing overlays, **Complete Diagnostic** opens the thank-you screen. Camera and microphone access are requested by the individual tests.

The local website serves the same suite at `http://127.0.0.1:5173/take-home/index.html`. For website scoring, start the shared API with `cd backend && .venv/bin/python -m agent.api` after installing the [scoring dependencies and model assets](backend/diagnostics/facial-test/README.md). Speech needs the Vosk model and generated reference files under `backend/diagnostics/speech-test-good/private/speech_demo/`. When upgrading an older Mac checkout, the existing model and samples from `speech-test-good/private/speech_demo/` can be copied or linked there. Line tracing runs in the browser. The standalone launcher starts the facial and speech services itself and uses the backend Python environment if a test-specific environment is absent.

On a fresh checkout, run `bash backend/diagnostics/facial-test/setup.sh` and `bash backend/diagnostics/speech-test-good/setup.sh` first. The launcher reuses running local test servers or starts them as needed. Control-C stops the launcher and the servers it started.

| Directory | Contents |
|---|---|
| [speech-test-good](backend/diagnostics/speech-test-good/) | Current transcript-only passage test and Mac launcher |
| [speech-tests-backup](backend/diagnostics/speech-tests-backup/) | Earlier speech tests, calibrated comparison demo, and VOC-ALS experiments |
| [facial-test](backend/diagnostics/facial-test/) | Four-round POSTER++ webcam expression challenge |
| [line-test](backend/diagnostics/line-test/index.html) | Standalone mouse and trackpad tracing challenge |
| [SVD-diagnostic](backend/diagnostics/SVD-diagnostic/) | EMG SVD analysis and speech SVD comparisons |

## Working here

**Read [`AGENTS.md`](AGENTS.md) first**, then
[`docs/STATUS.md`](docs/STATUS.md). Four people are working in parallel; those
two files are how we avoid building the same thing twice.

```bash
npm test --prefix backend/contract     # before you push anything touching the contract
```
