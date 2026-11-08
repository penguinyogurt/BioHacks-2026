#!/bin/zsh
cd -- "${0:A:h}" || exit 1
for python in .venv/bin/python ../../.venv/bin/python; do
  [[ -x "$python" ]] && exec "$python" -B transcript_only.py
done
echo "Run bash setup.sh in this folder first."
exit 1
