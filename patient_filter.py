#!/usr/bin/env python3
"""Shim so `python patient_filter.py` still works. Implementation is in src/."""

from src.patient_filter import *  # noqa: F401,F403
from src.patient_filter import main

if __name__ == "__main__":
    raise SystemExit(main())
