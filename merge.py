#!/usr/bin/env python3
"""Shim so `python merge.py` works from the repo root. Implementation is in src/."""

from src.merge import main

if __name__ == "__main__":
    raise SystemExit(main())
