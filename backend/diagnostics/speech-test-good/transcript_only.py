"""Offline passage word errors. Launch directly, or pass a WAV for JSON output."""
import argparse
import re
from passages import PASSAGES
import json
import threading
import webbrowser
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

import numpy as np
from engine import PASSAGE, ROOT, WORDS, edits, recognize, waveform

URL = "http://127.0.0.1:8770"
HEALTH = b"transcript-only-v1"
LOCK = threading.Lock()


def score_words(heard, words=WORDS):
    spoken = [token["word"] for token in heard]
    ops, ambiguous = edits(words, spoken)
    counts = Counter(op for _, _, op in ops)
    tokens = []
    last = 0.
    for i, j, op in ops:
        start = last if j is None else heard[j]["start"]
        end = start if j is None else heard[j]["end"]
        last = end
        tokens.append(dict(kind=op, position=None if i is None else i+1,
                               expected=None if i is None else words[i],
                               heard=None if j is None else spoken[j], start=start, end=end,
                               ambiguous=i in ambiguous,confidence=None if j is None else heard[j].get("conf")))
    events = [t for t in tokens if t["kind"]!="match"]
    errors = len(events)
    return dict(transcript=" ".join(spoken), words=len(words), errors=errors, events=events,tokens=tokens,
                substitutions=counts["substitution"], omissions=counts["omission"],
                insertions=counts["insertion"], wer=errors/len(words),
                score=1+99*min(errors/len(words),1) if heard else None)


def analyze(blob, passage=0):
    audio = waveform(blob)
    pcm = np.rint(audio*32767).astype("<i2").tobytes()
    return score_words(recognize(pcm), re.findall("[a-z]+",PASSAGES[passage][1].lower()))


class Handler(BaseHTTPRequestHandler):
    def reply(self, data, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.headers.get("Host") != URL[7:]:
            return self.send_error(403)
        if self.path == "/health":
            return self.reply(HEALTH,"text/plain")
        if self.path == "/":
            page = Path(__file__).with_name("transcript_only.html").read_text()
            return self.reply(page.replace("__PASSAGES__",json.dumps([p[:2] for p in PASSAGES])).encode(),"text/html; charset=utf-8")
        if re.fullmatch(r"/(?:p[12]-)?reference\.json",self.path):
            return self.reply((ROOT/"samples"/self.path[1:]).read_bytes(),"application/json")
        if re.fullmatch(r"/(?:p[12]-)?(?:baseline|edited|slower|reference)\.wav",self.path):
            return self.reply((ROOT/"samples"/self.path[1:]).read_bytes(),"audio/wav")
        self.send_error(404)

    def do_POST(self):
        if self.path != "/score" or self.headers.get("Host") != URL[7:] or self.headers.get("Origin") != URL:
            return self.send_error(403)
        try:
            n = int(self.headers.get("Content-Length",0))
            if not 0<n<=4_000_000:
                raise ValueError("Invalid recording size")
            with LOCK:
                passage=int(self.headers.get("X-Passage","0"))
                if not 0<=passage<len(PASSAGES): raise ValueError("Invalid passage")
                result = analyze(self.rfile.read(n),passage)
            self.reply(json.dumps(result).encode(),"application/json")
        except (ValueError, OSError, EOFError):
            self.send_error(400,"Use a valid recording between 0.2 and 60 seconds.")


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wav",type=Path,nargs="?")
    parser.add_argument("--no-browser",action="store_true")
    args=parser.parse_args()
    if args.wav:
        print(json.dumps(analyze(args.wav.read_bytes()),indent=2))
    else:
        try:
            server=ThreadingHTTPServer(("127.0.0.1",8770),Handler)
        except OSError:
            if urlopen(URL+"/health",timeout=2).read()!=HEALTH:
                raise
            if not args.no_browser:
                webbrowser.open(URL)
        else:
            print(URL,flush=True)
            if not args.no_browser:
                threading.Timer(.4,lambda:webbrowser.open(URL)).start()
            server.serve_forever()
