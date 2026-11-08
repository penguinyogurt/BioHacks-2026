"""Prepare pinned upstream code without its two redundant training initializer loads."""
from pathlib import Path
import shutil
import numpy as np
import torch

assets=Path(__file__).resolve().parent/"assets"
shutil.copytree(assets/"POSTER_V2/models",assets/"runtime/models",dirs_exist_ok=True)
path=assets/"runtime/models/PosterV2_7cls.py"
lines=path.read_text().splitlines(keepends=True)
assert "face_landback_checkpoint = torch.load" in lines[249] and "self.ir_back = load_pretrained_weights" in lines[261]
path.write_text("".join(line for i,line in enumerate(lines,1) if i not in (250,251,252,260,262)))
# Legacy training-log objects have no role in inference; allow only inert holders.
class RecorderMeter: pass
class RecorderMeter1: pass
allowed=[RecorderMeter,RecorderMeter1,(np.core.multiarray._reconstruct,"numpy.core.multiarray._reconstruct"),
         np.ndarray,np.dtype,*[type(np.dtype(k)) for k in ("float32","float64","int64","int32")]]
with torch.serialization.safe_globals(allowed):
    ck=torch.load(assets/"raf.pt",map_location="cpu",weights_only=True)
weights={name.removeprefix("module."):tensor for name,tensor in ck["state_dict"].items()}
torch.save(weights,assets/"inference.tmp")
(assets/"inference.tmp").replace(assets/"inference.pt")
print("Prepared",len(weights),"state entries; checkpoint validation accuracy",float(ck["best_acc"]))
