"""Browser integration check. Requires Playwright, local Chrome, assets/smoke.png and running app."""
import base64
import hashlib
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                               args=["--autoplay-policy=no-user-gesture-required"])
    p=browser.new_page()
    p.goto("http://127.0.0.1:8771")
    p.evaluate("""async url=>{
      window.testImage=new Image(); testImage.src=url; await testImage.decode();
      window.sourceCanvas=document.createElement('canvas'); sourceCanvas.width=sourceCanvas.height=512;
      window.smile=()=>sourceCanvas.getContext('2d').drawImage(testImage,0,0);
      window.blank=()=>sourceCanvas.getContext('2d').fillRect(0,0,512,512);
      smile(); navigator.mediaDevices.getUserMedia=async()=>{
        const s=sourceCanvas.captureStream(20);setTimeout(smile,20);return s};
      window.captures=[]; const orig=CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage=function(...args){
        if(this.canvas.id==='photo') captures.push(performance.now());return orig.apply(this,args)};
    }""","data:image/png;base64,"+base64.b64encode(Path("assets/smoke.png").read_bytes()).decode())
    sent=[]
    p.on("request",lambda r: sent.append(r.url) if r.url.endswith("/photo") else None)
    p.click("#start")
    p.locator("#ready").wait_for()
    p.clock.install()
    p.clock.pause_at(p.evaluate("new Date(Date.now()+1000).toISOString()"))
    def ready():
        p.locator("#ready").dispatch_event("click")
        return p.evaluate("performance.now()")
    def step(ms):
        p.clock.run_for(ms)
    def check_timer(text,n):
        assert p.locator("#prompt").inner_text()==text and p.locator("#timer").inner_text()==str(n)
    ready();step(1000);p.locator("#stop").dispatch_event("click");step(7000)
    assert len(sent)==0 and p.evaluate("document.querySelector('#live').srcObject===null")
    print("PASS: wrong top label fails, retry preserves target, Stop cancels before capture.")
    p.locator("#start").dispatch_event("click");step(100);p.locator("#ready").wait_for()
    ready();step(3100);p.evaluate("blank()");p.wait_for_timeout(300)
    step(2900);p.locator("#ready").wait_for()
    assert "one face" in p.locator("#prompt").inner_text()
    ready()
    pending=[]
    p.route("**/photo",lambda r:pending.append(r))
    with p.expect_request(lambda r:r.url.endswith("/photo")):step(6000)
    p.locator("#stop").dispatch_event("click")
    if pending:pending[0].abort()
    step(1000)
    assert p.locator("#result").is_hidden() and p.locator("#photo").is_hidden()
    print("PASS: early smile followed by blank yields retake; Stop discards pending score.")
    p.unroute("**/photo");sent.clear()
    p.evaluate("captures.length=0")
    p.locator("#start").dispatch_event("click");step(100);p.locator("#ready").wait_for()
    t=ready()
    for n in (3,2,1):
        check_timer("Get ready",n);step(1000)
    for n in (3,2,1):
        check_timer("Smile now — hold it until the photo",n);step(1000 if n>1 else 999)
    assert not sent and p.evaluate("captures.length")==0
    with p.expect_response(lambda r:r.url.endswith("/photo")) as response:
        step(1)
    p.locator("#next").wait_for()
    assert p.locator("#verdict").inner_text()=="PASS"
    display=p.evaluate("document.querySelector('#photo').toDataURL('image/png').split(',')[1]")
    digest=hashlib.sha256(base64.b64decode(display)).hexdigest()
    assert len(sent)==1 and response.value.json()["photo_sha256"]==digest
    assert p.evaluate("captures[0]")==t+6000
    step(9000)
    assert len(sent)==1 and p.locator("#photo").is_visible()
    print("PASS: 3/2/1 twice, live smile, exactly one capture at 6000 ms; displayed PNG equals server-scored PNG.")
    p.locator("#next").dispatch_event("click");assert p.locator("#prompt").inner_text().startswith("Sad")
    ready();step(6000);p.locator("#next").wait_for()
    assert p.locator("#verdict").inner_text()=="FAIL" and "Top prediction: Happy" in p.locator("#detail").inner_text()
    for target in ("Disgusted","Neutral"):
        p.locator("#next").dispatch_event("click")
        assert p.locator("#prompt").inner_text().startswith(target)
        ready();step(6000)
        p.locator("#reviewPage" if target=="Neutral" else "#next").wait_for()
    assert "1 of 4 expressions correct" in p.locator("#totalRight").inner_text()
    assert p.locator("#photos img").count()==4 and p.locator("#challenge").is_hidden()
    assert p.evaluate("document.querySelector('#live').srcObject===null")
    browser.close()
