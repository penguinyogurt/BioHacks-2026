"""Launch the local facial, speech and tracing tests in one browser session."""
import argparse
import errno
import json
import subprocess
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError

APP = Path(__file__).resolve().parent
ROOT = APP.parent
URL = "http://127.0.0.1:8772"
SERVICES = {
    "facial": ("facial-test", "app.py", 8771, b"poster-expression-challenge-v1"),
    "speech": ("speech-test-good", "transcript_only.py", 8770, b"transcript-only-v1"),
}
CHILDREN = {}
LOCK = threading.Lock()


def healthy(url, expected):
    try:
        with urlopen(url + "/health", timeout=1) as response:
            if response.read(128) != expected:
                raise RuntimeError("A different app is using " + url)
            return True
    except URLError as error:
        if getattr(error.reason, "errno", None) in (errno.ECONNREFUSED,):
            return False
        raise RuntimeError("Could not reach the test at " + url) from error


def start_test(stage):
    if stage == "line":
        return "/trace"
    directory, script, port, signature = SERVICES[stage]
    url = f"http://127.0.0.1:{port}"
    with LOCK:
        if healthy(url, signature):
            return url
        folder = ROOT / directory
        python = folder / ".venv/bin/python"
        if not python.is_file():
            raise RuntimeError(f"Run setup.sh in {directory} first.")
        process = CHILDREN.get(stage)
        if process is None or process.poll() is not None:
            process = subprocess.Popen([str(python), "-B", script, "--no-browser"], cwd=folder)
            CHILDREN[stage] = process
        deadline = time.monotonic()+90
        while time.monotonic()<deadline:
            if process.poll() is not None:
                raise RuntimeError(f"{directory} could not start. Check the launcher terminal.")
            try:
                if healthy(url, signature):
                    return url
            except RuntimeError:
                pass  # Model initialization may have bound the port already.
            time.sleep(.25)
        raise RuntimeError("Test startup is taking longer than expected. Try Begin again.")


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data, kind):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control","no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.headers.get("Host") != URL[7:]:
            return self.send_error(403)
        if self.path == "/health":
            return self.reply(200,b"diagnostic-complete-v1","text/plain")
        routes={"/":(APP/"diagnostic-ui/index.html","text/html"),"/suite.js":(APP/"diagnostic-ui/suite.js","text/javascript"),
                "/trace":(ROOT/"line-test/index.html","text/html")}
        if self.path not in routes:
            return self.send_error(404)
        path, kind=routes[self.path]
        self.reply(200,path.read_bytes(),kind+"; charset=utf-8")

    def do_POST(self):
        stage=self.path.removeprefix("/begin/")
        if self.headers.get("Origin")!=URL or self.headers.get("Host")!=URL[7:]:
            return self.send_error(403)
        if self.path!="/begin/"+stage or stage not in (*SERVICES,"line"):
            return self.send_error(404)
        try:
            self.reply(200,json.dumps({"url":start_test(stage)}).encode(),"application/json")
        except (OSError,RuntimeError) as error:
            self.reply(503,json.dumps({"error":str(error)}).encode(),"application/json")


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-browser",action="store_true")
    args=parser.parse_args()
    try:
        server=ThreadingHTTPServer(("127.0.0.1",8772),Handler)
    except OSError as error:
        if error.errno!=errno.EADDRINUSE or not healthy(URL,b"diagnostic-complete-v1"):
            raise
        if not args.no_browser:
            webbrowser.open(URL)
    else:
        print("Diagnostic Complete:", URL, flush=True)
        if not args.no_browser:
            threading.Timer(.3,lambda:webbrowser.open(URL)).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
            for proc in CHILDREN.values():
                if proc.poll() is None:
                    proc.terminate()
