"""Take-home test scoring, for the deployed web app (/take-home/ on the frontend).

Mounted by agent/api.py at /api/diagnostics, so there is one backend to deploy:

  GET  /api/diagnostics/health                  which engines this server can run
  POST /api/diagnostics/facial/photo            webcam PNG → POSTER++ expression probabilities
  POST /api/diagnostics/speech/score            WAV + X-Passage → word errors (Vosk)
  GET  /api/diagnostics/speech/<reference file> a passage's reference audio/JSON, if generated

It runs the same code as the standalone local servers (facial-test/app.py,
speech-test-good/transcript_only.py), loaded from their folders on first use, so scores are
identical. Each engine needs its own setup first (facial-test/setup.sh, speech-test-good/setup.sh:
packages into this venv and model files into the folders); without it, that engine's endpoints
answer 503 and everything else keeps working.
"""
import hashlib
import importlib.util
import io
import json
import re
import sys
import threading
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

HERE = Path(__file__).resolve().parent
FACIAL = HERE / "facial-test"
SPEECH = HERE / "speech-test-good"
MAX_PHOTO = 8_000_000  # same limits as the standalone servers
MAX_AUDIO = 4_000_000

router = APIRouter()
_facial_lock, _speech_lock = threading.Lock(), threading.Lock()


def _load(name: str, folder: Path, file: str):
    """Import a module from a test folder (they're scripts, not packages; names can't clash)."""
    if str(folder) not in sys.path:
        sys.path.insert(0, str(folder))  # for their own sibling imports (engine, passages, models)
    spec = importlib.util.spec_from_file_location(name, folder / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@lru_cache(maxsize=1)
def _facial():
    module = _load("diagnostics_facial_inference", FACIAL, "inference.py")
    return module, module.Predictor(None)


@lru_cache(maxsize=1)
def _speech():
    module = _load("diagnostics_speech_server", SPEECH, "transcript_only.py")
    module.model()  # Vosk opens its acoustic model lazily. Check it before advertising readiness.
    return module


def _engine(loader, what: str, setup: str):
    try:
        return loader()
    except Exception as e:  # packages missing, model files missing (Vosk raises a bare Exception)
        raise HTTPException(503, f"The {what} engine isn't installed on this server ({type(e).__name__}). Run {setup}.") from e


@router.get("/health")
async def health():
    def ok(loader):
        try:
            loader()
            return True
        except Exception:
            return False
    return {"facial": await run_in_threadpool(ok, _facial), "speech": await run_in_threadpool(ok, _speech)}


@router.post("/facial/photo")
async def facial_photo(request: Request):
    data = await request.body()
    if not 0 < len(data) <= MAX_PHOTO:
        raise HTTPException(400, "Invalid photo size")
    module, model = await run_in_threadpool(_engine, _facial, "facial", "backend/diagnostics/facial-test/setup.sh")

    def score():
        with module.Image.open(io.BytesIO(data)) as image:
            if image.format != "PNG" or max(image.size) > 1920:
                raise ValueError("Expected a webcam PNG")
            frame = module.cv2.cvtColor(module.np.asarray(image.convert("RGB")), module.cv2.COLOR_RGB2BGR)
        with _facial_lock:
            result = model.photo(frame)
        result["photo_sha256"] = hashlib.sha256(data).hexdigest()
        return result

    try:
        result = await run_in_threadpool(score)
    except (ValueError, OSError) as e:
        raise HTTPException(400, str(e)) from e
    return Response(json.dumps(result, allow_nan=False), media_type="application/json")


@router.post("/speech/score")
async def speech_score(request: Request):
    data = await request.body()
    if not 0 < len(data) <= MAX_AUDIO:
        raise HTTPException(400, "Use a valid recording between 0.2 and 60 seconds.")
    server = await run_in_threadpool(_engine, _speech, "speech", "backend/diagnostics/speech-test-good/setup.sh")
    try:
        passage = int(request.headers.get("X-Passage", "0"))
        if not 0 <= passage < len(server.PASSAGES):
            raise ValueError("Invalid passage")

        def score():
            with _speech_lock:
                return server.analyze(data, passage)

        return await run_in_threadpool(score)
    except (ValueError, OSError, EOFError) as e:
        raise HTTPException(400, "Use a valid recording between 0.2 and 60 seconds.") from e


@router.get("/speech/{name}")
async def speech_reference(name: str):
    """Reference audio for the review screen. Generated per machine by make_samples.py (macOS `say`)."""
    if not re.fullmatch(r"(?:p[12]-)?(?:reference\.json|(?:baseline|edited|slower|reference)\.wav)", name):
        raise HTTPException(404, "unknown file")
    server = await run_in_threadpool(_engine, _speech, "speech", "backend/diagnostics/speech-test-good/setup.sh")
    path = server.ROOT / "samples" / name
    if not path.is_file():
        raise HTTPException(404, "Reference audio hasn't been generated on this server.")
    return Response(path.read_bytes(), media_type="application/json" if name.endswith(".json") else "audio/wav")
