#!/usr/bin/env python3
"""Shim so `python bbb_model.py` still works. Implementation is in src/."""

from src.bbb_model import *  # noqa: F401,F403
from src.bbb_model import _main

if __name__ == "__main__":
    import sys

    raise SystemExit(_main(sys.argv))
