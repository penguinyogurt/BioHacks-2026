#!/usr/bin/env python3
"""Shim so `python graveyard.py` still works. Implementation is in src/."""

from src.graveyard import *  # noqa: F401,F403
from src.graveyard import main

if __name__ == "__main__":
    raise SystemExit(main())
