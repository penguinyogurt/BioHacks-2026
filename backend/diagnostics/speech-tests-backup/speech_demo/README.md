# Local passage comparison

Double-click **Launch Speech Demo.command** in the parent directory. The launcher opens http://127.0.0.1:8769 in your default browser. Keep its Terminal window open. A second launch opens the existing server. Alternatively:

```sh
cd ~/Documents/BioHacks/speech-tests-backup && ./speech_demo/.venv/bin/python -B speech_demo/app.py
```

Choose **Compare readings** to hear and inspect the preloaded standard/slower synthetic examples. Both input cards support WAV upload, microphone recording and full playback. Select Record again (Stop recording) to finish, and allow browser microphone permission if asked. Recordings are limited to 60 seconds. Choose the edited sample to test a skipped word and a replacement. To compare your own two readings, replace both samples. Switching to the macOS voice uses one whole-passage Samantha recording as the reference; switching back restores your baseline.

Select a passage word to play its reference clip followed by its repeat clip. Expand **Transcripts and timestamped edits** to see ASR insertions as well as substitutions and omissions. An omitted word has a timing anchor, with no spoken clip on that side. A dashed button is unscored. For uncertain boundaries playback uses the approximate recognition interval. Positive duration change means the repeat lasted longer.

## Measurements

The transcript comparison adapts the temporal word-error approach of [Park et al., Interspeech 2025](https://www.isca-archive.org/interspeech_2025/park25c_interspeech.html). Vosk small US English transcribes each recording locally, without the passage, grammar constraints or prompts. Minimum-edit alignment maps the transcript to numbered expected words, retaining insertions and flagging equally optimal occurrence assignments. A deletion is placed at the end of the preceding recognized token (or zero). The recognizer can mishear a clearly spoken word, including a synthetic example.

PocketSphinx independently force-aligns the spoken token sequence to the waveform. The app maps these boundaries back onto expected occurrences via the edit alignment. Missing expected words have no forced interval. Substitutions use the spoken replacement. The scoring gate requires an unambiguous assignment, ASR word confidence of at least 0.55, interval overlap/union of at least 0.45, endpoints within 180 ms across the engines and a forced interval of 50 ms–2 s. These thresholds are demo heuristics. If either side fails, the pair is unscored.

For each eligible word on both sides, pronunciation deviation is the mean Euclidean MFCC distance along the minimum-total-cost DTW path. Frames are 25 ms with a 10 ms hop. The frontend uses 40 log-mel bands and 13 non-energy cepstral coefficients at 16 kHz. DTW uses diagonal, horizontal or vertical steps within a 20% normalized-time band with a one-frame tolerance. Duration difference is measured independently from the aligned boundaries. Microphone, speaker and reference voice differences can all affect this raw distance. The demo has no clinical calibration.

## Local data and checks

Mic captures and uploaded audio stay in browser/server memory. The server keeps at most eight analyzed readings in memory; stop the server to clear them. The model and generated sample WAVs live in the project's ignored private/speech_demo directory. Runtime requires no network access. The acoustic model for forced alignment is supplied by PocketSphinx.

From the parent project, run these with the installed demo environment:

```sh
speech_demo/.venv/bin/python -B speech_demo/check_demo.py
speech_demo/.venv/bin/python -B speech_demo/make_samples.py
```

The first command checks identical-input scores, duration on slower speech, the edited reading, repeated occurrences, insertion alignment and ambiguity. The second regenerates sample WAVs with macOS say.

## Personal calibration

On first launch, record the displayed passage five times in your normal voice and five times using your chosen extreme example. Replay and save each take. Refreshing or relaunching resumes at the next take. Calibration spectra are saved privately under private/speech_demo/calibration-v1.json; microphone audio stays in memory. Recalibrate score reference starts a separate draft. The current profile stays active until ten replacement takes pass validation. Cancel recalibration discards the draft. Once ready, both input cards automatically show a personal score, independent of the word-comparison reference selector.

For each reliably aligned occurrence, average windowed spectral power into 32 logarithmic bands spanning 80–8000 Hz, normalize to the strongest band, and floor at −60 dB. The normal template is the mean per-band profile of the normal examples for that occurrence. The word error is mean absolute dB difference from that template. Sum the errors over usable words. Compute the normal and extreme anchors as sums of the respective groups’ mean word errors on exactly those words. Score = 1 + 99 × (input total − normal anchor) / (extreme anchor − normal anchor), displayed within 1–100, with out-of-range readings labeled. At least 7 of 14 words and three valid calibration examples per group for each contributing word are required. An anchor gap at or below 0.1 dB per contributing word is unscorable. Transcript errors, duration and MFCC-DTW remain separate; missing words reduce coverage. Scores describe similarity to the user's own example styles and are not clinical severity estimates.

## FaceCheck

Open **FaceCheck** from the passage comparison header. The speech page stays mounted behind the panel. **Back to speech comparison** closes the camera view and restores the existing reading inputs. FaceCheck uses the same localhost app, with its own browser-local baseline and check-in history under the original storage key. Speech calibration and recordings are separate.

On a fresh checkout, cache the optional FaceCheck assets once:

```sh
cd ~/Documents/BioHacks/speech-tests-backup/speech_demo
bash facecheck/setup.sh
```

The original [FaceCheck source](https://github.com/penguinyogurt/BioHacks-2026/tree/eb3ea975e02a7d1ddfc86e212baefa4ad9f0d2ef/facecheck) is from branch `cursor/facial-als-validation`. All seven modules are generated from that revision with Node's TypeScript stripper. Only module specifiers, CSS loading and asset locations are adapted. The browser uses MediaPipe tasks-vision 0.10.35 and the original float16 v1 landmarker. Runtime requests stay on localhost.

To reproduce the port or check it against an export of that revision, use Node 24 in the facecheck directory:

```sh
node port.mjs /path/to/original/facecheck/src
node --experimental-vm-modules verify.mjs /path/to/original/facecheck/src
```

The source's two-rep combine selects the indexed 50th percentile. Its asymmetry uses raw left/right values, while amplitude uses each session's neutral-subtracted values. Robust scoring requires at least two prior check-ins and scaled MAD above 0.01; otherwise the original flat thresholds apply.
