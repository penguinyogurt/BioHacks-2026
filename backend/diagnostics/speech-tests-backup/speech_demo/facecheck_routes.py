"""Explicit GET-only assets for the optional FaceCheck section."""
from pathlib import Path

HERE = Path(__file__).resolve().parent
UI = HERE / "facecheck"
ASSETS = HERE.parent / "private" / "facecheck"
ROUTES = {"/facecheck/": (UI/"index.html", "text/html; charset=utf-8")}
for name in ("protocol", "landmarker", "render", "capture", "compare", "storage", "main"):
    ROUTES[f"/facecheck/{name}.js"] = (UI/f"{name}.js", "text/javascript")
ROUTES["/facecheck/style.css"] = (UI/"style.css", "text/css")
for file, kind in [("vision_bundle.mjs", "text/javascript"), ("face_landmarker.task", "application/octet-stream")]:
    ROUTES["/facecheck/assets/"+file] = (ASSETS/file, kind)
for stem in ("vision_wasm_internal", "vision_wasm_nosimd_internal", "vision_wasm_module_internal"):
    for ext, kind in [("js","text/javascript"), ("wasm","application/wasm")]:
        file = f"wasm/{stem}.{ext}"
        ROUTES["/facecheck/assets/"+file] = (ASSETS/file, kind)


def serve(handler):
    if handler.path == "/facecheck/" and not all(path.is_file() for path,_ in ROUTES.values()):
        return handler.reply(503,b"FaceCheck needs its local assets. Run bash facecheck/setup.sh from the speech_demo directory, then reopen FaceCheck.","text/plain")
    entry = ROUTES.get(handler.path)
    if not entry or not entry[0].is_file():
        return handler.send_error(404)
    return handler.reply(200, entry[0].read_bytes(), entry[1])
