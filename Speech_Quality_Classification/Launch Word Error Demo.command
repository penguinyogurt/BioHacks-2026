#!/bin/zsh
cd -- "${0:A:h}" || exit 1
exec speech_demo/.venv/bin/python -B speech_demo/transcript_only.py
