"""Component B entry: `bbb_model.py` -> `data/bbb_scores.json`."""

from __future__ import annotations

import json
import sys

from bbb import UnparseableSmilesError, predict_many, predict_smiles

__all__ = ["UnparseableSmilesError", "predict_smiles", "predict_many"]


def _main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 0
    cmd = argv[1]
    if cmd == "train":
        from bbb.train import main as train_main
        train_main()
        return 0
    if cmd == "score":
        from bbb.score import main as score_main
        score_main()
        return 0
    if cmd == "predict":
        print(json.dumps(predict_many(argv[2:]), indent=2))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
