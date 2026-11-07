# Passage word check

Double-click **Launch Word Error Demo.command**, or run `.venv/bin/python transcript_only.py` here. The browser opens on localhost:8770. For a WAV file, run `.venv/bin/python transcript_only.py reading.wav`.

The local Vosk recognizer transcribes without a prompt. Substitutions, omissions and extra words each count as one error. A reading with no recognized words is unscored.

For a fresh Mac checkout, run `bash setup.sh` here once. It creates the Python environment, downloads the English recognition model and generates synthetic sample audio locally. The installed model and WAVs are Git-ignored.
