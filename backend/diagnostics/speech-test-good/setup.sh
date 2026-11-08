#!/bin/bash
set -eu
cd "$(dirname "$0")"
python3 -m venv .venv
.venv/bin/python -m pip install numpy scipy vosk pocketsphinx
dest=private/speech_demo
mkdir -p "$dest"
if [ ! -d "$dest/vosk-model-small-en-us-0.15" ]; then
  curl -fL --retry 2 https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip -o "$dest/model.zip"
  unzip -oq "$dest/model.zip" -d "$dest"
fi
.venv/bin/python make_samples.py
