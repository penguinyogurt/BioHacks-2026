import base64
import json
import os
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

import calibration as cal
from engine import PASSAGE, ROOT, compare

HERE=Path(__file__).resolve().parent
PORT=8769
URL=f"http://127.0.0.1:{PORT}"
LOCK=threading.Lock()
SAMPLES={"baseline","slower","edited","reference"}


class Handler(BaseHTTPRequestHandler):
    def reply(self,status,data,typ):
        self.send_response(status)
        self.send_header("Content-Type",typ)
        self.send_header("Content-Length",str(len(data)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.headers.get("Host")!=URL[7:]:
            return self.send_error(403)
        if self.path=="/calibration":
            with LOCK:
                state=cal.current_state()
            return self.reply(200,json.dumps(state).encode(),"application/json")
        if self.path=="/health":
            return self.reply(200,b"local-passage-demo-v1","text/plain")
        if self.path=="/":
            return self.reply(200,(HERE/"index.html").read_bytes().replace(b"__PASSAGE__",PASSAGE.encode()),"text/html; charset=utf-8")
        if self.path=="/demo.js":
            return self.reply(200,(HERE/"demo.js").read_bytes(),"application/javascript")
        for name in SAMPLES:
            if self.path==f"/samples/{name}.wav":
                return self.reply(200,(ROOT/"samples"/(name+".wav")).read_bytes(),"audio/wav")
        self.send_error(404)

    def do_POST(self):
        if self.path not in ("/compare","/calibrate","/score","/reset-calibration","/start-recalibration","/cancel-recalibration") or self.headers.get("Host")!=URL[7:] or self.headers.get("Origin")!=URL:
            return self.send_error(403)
        try:
            size=int(self.headers.get("Content-Length","0"))
            if not 0<size<8_000_000:
                raise ValueError("Please use recordings of 60 seconds or less.")
            data=json.loads(self.rfile.read(size))
            with LOCK:
                if self.path=="/compare":
                    base,repeat=(base64.b64decode(data[k],validate=True) for k in ("baseline","repeat"))
                    result=compare(base,repeat)
                    entries=cal.load()
                    if len(entries)==10:
                        result["personal_score"]=cal.score(entries,cal.fingerprint(repeat))
                elif self.path=="/start-recalibration":
                    if len(cal.load())!=10:
                        raise ValueError("Complete your initial calibration first.")
                    if not cal.draft_path().exists():
                        cal.save([],cal.draft_path())
                    result=cal.current_state()
                elif self.path=="/cancel-recalibration":
                    cal.draft_path().unlink(missing_ok=True)
                    result=cal.current_state()
                elif self.path=="/reset-calibration":
                    if len(cal.load())==10:
                        raise ValueError("Use Recalibrate score reference to replace an active profile.")
                    cal.save([])
                    result=cal.current_state()
                else:
                    entries=cal.load()
                    reading=cal.fingerprint(base64.b64decode(data["audio"],validate=True))
                    if self.path=="/calibrate":
                        result=cal.accept_take(reading,data["step"],data.get("replacing",False))
                    elif len(entries)==10:
                        result=cal.score(entries,reading)
                    else:
                        raise ValueError("Finish calibration first.")
            self.reply(200,json.dumps(result,allow_nan=False).encode(),"application/json")
        except Exception as e:
            self.reply(400,json.dumps({"error":str(e)}).encode(),"application/json")


if __name__=="__main__":
    os.umask(0o077)
    try:
        server=ThreadingHTTPServer(("127.0.0.1",PORT),Handler)
    except OSError:
        if urlopen(URL+"/health",timeout=2).read()!=b"local-passage-demo-v1":
            raise
        webbrowser.open(URL)
    else:
        print("Speech demo:",URL,"— keep this window open. Control-C stops the server.",flush=True)
        threading.Timer(.5,lambda:webbrowser.open(URL)).start()
        server.serve_forever()
