# Passage word check

Double-click **Launch Word Error Demo.command**, or run `.venv/bin/python transcript_only.py` here. The browser opens on localhost:8770. For a WAV file, run `.venv/bin/python transcript_only.py reading.wav`.

The local Vosk recognizer transcribes without a prompt. Substitutions, omissions and extra words each count as one error. A reading with no recognized words is unscored.

For a fresh Mac checkout, run `bash setup.sh` here once. It creates the Python environment, downloads the English recognition model and generates synthetic sample audio locally. The installed model and WAVs are Git-ignored.

In the master assessment, score all three English passages, then review any passage before proceeding. Click a word for the whole-passage macOS reference excerpt followed by the recognized recording interval. Green words matched the passage. Red words, marked with a cross, are recognition differences. Audio and review state stay local to the session.

Passages are presented in order. After each of the first two scored readings, Next passage opens the following prompt. After the third, a dedicated results screen lists all three readings and allows word-by-word playback for each. An unscored reading can be retried.
