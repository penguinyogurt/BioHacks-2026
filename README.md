# BioHacks tests

Launch the complete session on this Mac:

```sh
cd ~/Documents/BioHacks && python3 master-app/diagnostic_complete.py
```

The master app opens at http://127.0.0.1:8772. Select **Begin** on each animated introduction, then complete the facial expression challenge, passage reading, and line tracing in order. Review each test’s results and select **Proceed To Next Test**. The speech test includes three passages with word-level playback. After all five tracing overlays, **Complete Diagnostic** opens the thank-you screen. Camera and microphone access are requested by the individual tests.

On a fresh checkout, run `bash facial-test/setup.sh` and `bash speech-test-good/setup.sh` first. The launcher reuses running local test servers or starts them as needed. Control-C stops the launcher and the servers it started.

| Directory | Contents |
|---|---|
| [speech-test-good](speech-test-good/) | Current transcript-only passage test and Mac launcher |
| [speech-tests-backup](speech-tests-backup/) | Earlier speech tests, calibrated comparison demo, and VOC-ALS experiments |
| [facial-test](facial-test/) | Four-round POSTER++ webcam expression challenge |
| [line-test](line-test/index.html) | Standalone mouse and trackpad tracing challenge |
| [SVD-diagnostic](SVD-diagnostic/) | EMG SVD analysis and speech SVD comparisons |
