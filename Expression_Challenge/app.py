"""Local POSTER++ expression challenges. Run .venv/bin/python app.py [--cpu]."""
import argparse
import errno
import hashlib
import io
import json
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.request import urlopen

from inference import ROOT,Predictor,cv2,np,Image

URL="http://127.0.0.1:8771"
HEALTH=b"poster-expression-challenge-v1"
LOCK=threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def reply(self,status,body,kind):
        self.send_response(status)
        self.send_header("Content-Type",kind)
        self.send_header("Cache-Control","no-store")
        self.send_header("Content-Length",str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError,ConnectionResetError):
            pass

    def do_GET(self):
        if self.headers.get("Host")!=URL[7:]:
            return self.send_error(403)
        if self.path=="/health":
            return self.reply(200,HEALTH,"text/plain")
        if self.path=="/":
            return self.reply(200,(ROOT/"index.html").read_bytes(),"text/html; charset=utf-8")
        if self.path=="/round.js":
            return self.reply(200,(ROOT/"round.js").read_bytes(),"application/javascript")
        self.send_error(404)

    def do_POST(self):
        if self.path!="/photo" or self.headers.get("Host")!=URL[7:] or self.headers.get("Origin")!=URL:
            return self.send_error(403)
        try:
            size=int(self.headers.get("Content-Length",0))
            if not 0<size<=8_000_000:
                raise ValueError("Invalid photo size")
            data=self.rfile.read(size)
            with Image.open(io.BytesIO(data)) as image:
                if image.format!="PNG" or max(image.size)>1920:
                    raise ValueError("Expected a webcam PNG")
                frame=cv2.cvtColor(np.asarray(image.convert("RGB")),cv2.COLOR_RGB2BGR)
            with LOCK:
                result=self.server.model.photo(frame)
            result["photo_sha256"]=hashlib.sha256(data).hexdigest()
            self.reply(200,json.dumps(result,allow_nan=False).encode(),"application/json")
        except (ValueError,OSError) as e:
            self.reply(400,json.dumps({"error":str(e)}).encode(),"application/json")
        except Exception as e:
            print("Inference error:",e,flush=True)
            self.reply(500,b'{"error":"Could not score the photo. Please retry."}',"application/json")

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cpu",action="store_true")
    args=parser.parse_args()
    try:
        server=ThreadingHTTPServer(("127.0.0.1",8771),Handler)
    except OSError as exc:
        if exc.errno!=errno.EADDRINUSE or urlopen(URL+"/health",timeout=2).read()!=HEALTH:
            raise
        webbrowser.open(URL)
    else:
        server.model=Predictor("cpu" if args.cpu else None)
        print(f"POSTER++ ready on {server.model.device}: {URL}",flush=True)
        threading.Timer(.4,lambda:webbrowser.open(URL)).start()
        server.serve_forever()
