"use strict";
const $=id=>document.getElementById(id), slots={}, labels={baseline:"Standard pace",slower:"Slower reading",edited:"Skipped and replaced words",reference:"macOS whole-passage reference"};
let result, ctx, playing=[], generation=0, sourceMode="self", savedBase, recording=null, pending=0;
const context=()=>ctx||(ctx=new AudioContext());
function halt(){for(const s of playing){try{s.stop()}catch{}}playing=[]}
function invalidate(){generation++;halt();result=null;$("result").hidden=true;$("status").textContent=""}
let profile=null, saving=false;
function controls(){ $("calSave").disabled=!!(saving||recording||pending||!slots.cal?.blob); $("go").disabled=!!(pending||recording||!slots.baseline?.blob||!slots.repeat?.blob); }
function message(e){$("status").textContent=e.message||String(e)}
async function setClip(id,blob,name){
 const slot=slots[id], ticket=++slot.ticket;invalidate();pending++;controls();
 try{
  const buf=await context().decodeAudioData(await blob.arrayBuffer());
  if(buf.duration>60||buf.duration<.2)throw Error("Choose a reading between 0.2 and 60 seconds.");
  if(ticket!==slot.ticket)return;
  if(slot.url)URL.revokeObjectURL(slot.url);
  slot.blob=blob;slot.name=name;slot.buf=buf;slot.url=URL.createObjectURL(blob);
  slot.audio.src=slot.url;slot.info.textContent=name;
  if(id==="cal")$("calMsg").textContent="Replay this take, then save or record again.";
  else if(profile?.ready) displayScore(id,blob,ticket);
 }finally{pending--;controls()}
}
async function sample(id,name){const r=await fetch("/samples/"+name+".wav");if(!r.ok)throw Error("Sample unavailable.");await setClip(id,await r.blob(),"Synthetic sample · "+labels[name])}
function encode(buf){
 const a=buf.getChannelData(0), out=new ArrayBuffer(44+2*a.length),v=new DataView(out);
 const str=(i,s)=>{for(let j=0;j<s.length;j++)v.setUint8(i+j,s.charCodeAt(j))};
 str(0,"RIFF");v.setUint32(4,36+2*a.length,true);str(8,"WAVE");str(12,"fmt ");v.setUint32(16,16,true);
 v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);
 v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,"data");v.setUint32(40,2*a.length,true);
 for(let i=0;i<a.length;i++)v.setInt16(44+2*i,Math.round(Math.max(-1,Math.min(1,a[i]))*32767),true);
 return new Blob([out],{type:"audio/wav"});
}
async function wav(blob){
 const buf=await context().decodeAudioData(await blob.arrayBuffer());
 if(buf.duration>60)throw Error("Maximum reading length is 60 seconds.");
 const off=new OfflineAudioContext(1,Math.ceil(buf.duration*16000),16000),src=off.createBufferSource();
 src.buffer=buf;src.connect(off.destination);src.start();return encode(await off.startRendering())
}
async function record(id,btn){
 if(recording){if(recording.id===id && recording.rec.state==="recording")recording.rec.stop();return}
 const stream=await navigator.mediaDevices.getUserMedia({audio:true});
 const rec=new MediaRecorder(stream),chunks=[];recording={rec,id};invalidate();controls();$("mode").disabled=true;
 btn.textContent="Stop recording";$(id==="cal"?"calMsg":"status").textContent="Recording "+id+"…";
 rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
 const timer=setTimeout(()=>{if(rec.state==="recording")rec.stop()},58000);
 rec.onstop=async()=>{clearTimeout(timer);stream.getTracks().forEach(t=>t.stop());
  try{await setClip(id,await wav(new Blob(chunks,{type:rec.mimeType})),"Microphone · "+id)}
  catch(e){$(id==="cal"?"calMsg":"status").textContent=e.message}finally{recording=null;btn.textContent="Record";$("mode").disabled=false;controls()}};
 rec.start()
}
function card(id,title){
 const el=$(id);el.innerHTML='<h2></h2><div class="inputs"><button class="rec">Record</button><label>Upload WAV <input type="file" accept=".wav,audio/wav"></label><label>Try sample audio <select><option value="">Choose a synthetic sample</option></select></label></div><p class="source"></p><audio controls></audio>';
 el.querySelector("h2").textContent=title;const sel=el.querySelector("select");
 for(const k of ["baseline","slower","edited"])sel.add(new Option(labels[k],k));
 slots[id]={ticket:0,audio:el.querySelector("audio"),info:el.querySelector(".source")};
 sel.onchange=async()=>{if(sel.value)try{await sample(id,sel.value)}catch(e){message(e)}sel.value=""};
 const inp=el.querySelector("input");inp.onchange=async()=>{if(inp.files.length)try{const file=inp.files[0];await setClip(id,await wav(file),"Upload · "+file.name)}catch(e){message(e)}inp.value=""};
 const btn=el.querySelector(".rec");btn.onclick=()=>record(id,btn).catch(e=>$(id==="cal"?"calMsg":"status").textContent=e.message)
}
card("baseline","Baseline");card("repeat","Repeat");card("cal","Calibration take");
$("cal").querySelectorAll("label").forEach(el=>el.remove());
for(const id of ["baseline","repeat"]){
 const area=text($(id),"p","");area.id=id+"Score";area.setAttribute("aria-live","polite");
}
$("mode").onchange=async()=>{
 const mode=$("mode").value;
 try{
  if(mode==="tts"){savedBase={blob:slots.baseline.blob,name:slots.baseline.name};await sample("baseline","reference")}
  else if(savedBase?.blob)await setClip("baseline",savedBase.blob,savedBase.name);
  sourceMode=mode;$("baseline").querySelector(".inputs").hidden=mode==="tts";
 }catch(e){$("mode").value=sourceMode;message(e)}
};
async function b64(blob){return new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result.split(",")[1]);r.onerror=no;r.readAsDataURL(blob)})}
$("go").onclick=async()=>{
 invalidate();const ticket=generation;pending++;controls();$("status").textContent="Transcribing and comparing locally…";
 try{
  const r=await fetch("/compare",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({baseline:await b64(slots.baseline.blob),repeat:await b64(slots.repeat.blob)})});
  const data=await r.json();if(!r.ok)throw Error(data.error||"Comparison failed.");
  if(ticket!==generation)return;result=data;render();$("status").textContent="Comparison ready.";
 }catch(e){message(e)}finally{pending--;controls()}
};
const stamp=a=>a.map(v=>v.toFixed(2)).join("–")+" s";
function text(el,tag,value){const n=document.createElement(tag);n.textContent=value;el.append(n);return n}
function render(){
 $("result").hidden=false;
 const score=result.personal_score;
 $("scoreValue").textContent=score?.value!=null?score.value.toFixed(1)+" / 100":"Unscored";
 $("scoreCoverage").textContent=score?(score.reason?score.reason+" ":"")+score.words+" of "+score.total+" words contributed.":"No active calibration.";
 $("scoreHero").focus();
$("used").textContent="Reference used: "+(sourceMode==="tts"?"macOS TTS":"baseline")+" · "+slots.baseline.name;
 $("words").replaceChildren();$("logs").replaceChildren();
 const display=result.passage.split(" ");
 result.scores.forEach((s,i)=>{
  const btn=text($("words"),"button",display[i]);btn.className=[s.distance===null?"unc":"",["baseline","repeat"].some(k=>result[k].rows[i].status!=="match")?"err":""].join(" ");
  btn.onclick=()=>select(i,true);btn.setAttribute("aria-label",display[i]+" · word "+(i+1))});
 for(const k of ["baseline","repeat"]){
  text($("logs"),"h3",k==="baseline"?"Reference":"Repeat");text($("logs"),"p",result[k].transcript||"(No words recognized)");
  for(const e of result[k].events)text($("logs"),"p",e.status+" · "+(e.word||"∅")+" → "+(e.heard||"∅")+" · "+(e.status==="omission"?"estimated anchor ":"")+stamp(e.time));
  if(!result[k].events.length)text($("logs"),"p","All words matched.")
 }
 select(0,false)
}
// Periodogram of a Hann-windowed frame, using an in-place radix-2 FFT.
function fftPower(real, imag) {
 const n=real.length;
 for(let i=1,j=0;i<n;i++){
  let bit=n>>1;
  while(j&bit){j^=bit;bit>>=1}
  j^=bit;
  if(i<j)[real[i],real[j]]=[real[j],real[i]];
 }
 for(let size=2;size<=n;size*=2){
  const angle=-2*Math.PI/size, stepR=Math.cos(angle),stepI=Math.sin(angle);
  for(let start=0;start<n;start+=size){
   let wr=1,wi=0;
   for(let k=start;k<start+size/2;k++){
    const j=k+size/2, tr=wr*real[j]-wi*imag[j],ti=wr*imag[j]+wi*real[j];
    real[j]=real[k]-tr;imag[j]=imag[k]-ti;real[k]+=tr;imag[k]+=ti;
    const next=wr*stepR-wi*stepI;wi=wr*stepI+wi*stepR;wr=next;
   }
  }
 }
}

// Measure the original aligned clip in 32 equal log-frequency bands.
function wordSpectrum(buffer,span){
 if(!span)return null;
 const sr=buffer.sampleRate, frame=Math.round(.025*sr), hop=Math.round(.01*sr);
 const first=Math.max(0,Math.round(span[0]*sr)), end=Math.min(buffer.length,Math.round(span[1]*sr));
 if(end-first<frame)return null;
 const n=2**Math.ceil(Math.log2(frame)), bands=32;
 const binHz=sr/n;
 const ranges=Array.from({length:bands},(_,b)=>{
  const lo=80*100**(b/bands),hi=80*100**((b+1)/bands),weights=[];
  for(let k=Math.max(1,Math.floor(lo/binHz));k<=Math.min(n/2,Math.ceil(hi/binHz));k++){
   const overlap=Math.min(hi,(k+.5)*binHz)-Math.max(lo,(k-.5)*binHz);
   if(overlap>0)weights.push([k,overlap/binHz]);
  }
  return weights;
 });
 const energy=new Float64Array(bands);
 const window=Float64Array.from({length:frame},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(frame-1)));
 const mono=new Float64Array(end-first);
 for(let c=0;c<buffer.numberOfChannels;c++){
  const data=buffer.getChannelData(c);
  for(let i=0;i<mono.length;i++)mono[i]+=data[first+i]/buffer.numberOfChannels;
 }
 const real=new Float64Array(n),imag=new Float64Array(n);
 for(let pos=0;pos+frame<=mono.length;pos+=hop){
  real.fill(0);imag.fill(0);
  for(let i=0;i<frame;i++)real[i]=mono[pos+i]*window[i];
  fftPower(real,imag);
  ranges.forEach((weights,b)=>{
   for(const [k,w] of weights)energy[b]+=w*(real[k]**2+imag[k]**2);
  });
 }
 const peak=Math.max(...energy);if(!peak)return null;
 return Array.from(energy,v=>10*Math.log10(Math.max(1e-6,v/peak)));
}

function showSpectrum(parent,rows){
 const spec=["baseline","repeat"].map((k,j)=>wordSpectrum(slots[k].buf,rows[j].span));
 const box=document.createElement("section");box.className="spectrum";parent.append(box);
 text(box,"h3","Word frequency content");
 if(!spec.some(Boolean)){text(box,"p","No reliable word interval to plot.");return}
 const delta=spec.every(Boolean)?spec[0].map((v,i)=>Math.abs(v-spec[1][i])):null;
 text(box,"p",delta?"Mean absolute spectral error: "+(delta.reduce((a,b)=>a+b,0)/delta.length).toFixed(1)+" dB":
    "Spectral error unscored · a reliable spectrum is needed from both readings.");
 const legend=text(box,"div","");legend.className="spectrum-key";
 if(spec[0])text(legend,"span","━ Reference");
 if(spec[1])text(legend,"span","┄ Repeat").style.color="#a34d15";
 const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");
 svg.setAttribute("viewBox","0 0 640 "+(delta?260:175));svg.setAttribute("role","img");
 svg.setAttribute("aria-label","Word spectra in relative decibels by frequency"+(delta?", with absolute difference per band below":""));box.append(svg);
 function mark(tag,attrs,label){
  const el=document.createElementNS(ns,tag);
  for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);
  if(label!==undefined)el.textContent=label;svg.append(el);return el;
 }
 const left=49,right=623,width=right-left;
 const x=i=>left+width*(i+.5)/32, y=v=>15-v*1.85;
 function axis(top,bottom){
  for(const hz of [80,250,1000,4000,8000]){
   const pos=left+width*Math.log(hz/80)/Math.log(100);
   mark("line",{x1:pos,x2:pos,y1:top,y2:bottom,stroke:"#e4e7e2"});
   mark("text",{x:pos,y:bottom+17,"text-anchor":"middle"},hz>=1000?(hz/1000)+"k":hz);
  }
 }
 axis(15,126);
 for(const v of [0,-20,-40,-60]){
  mark("line",{x1:left,x2:right,y1:y(v),y2:y(v),stroke:"#d5dcd7"});
  mark("text",{x:left-6,y:y(v)+4,"text-anchor":"end"},v+" dB");
 }
 spec.forEach((values,i)=>{if(values)mark("polyline",{points:values.map((v,k)=>x(k)+","+y(v)).join(" "),
  fill:"none",stroke:i?"#ad541c":"#176a71","stroke-width":3,"stroke-dasharray":i?"6 4":"none"})});
 if(delta){
  const max=Math.max(10,Math.ceil(Math.max(...delta)/10)*10);
  mark("text",{x:left,y:168},"Absolute difference per band (dB)");
  axis(178,224);
  for(const v of [0,max])mark("text",{x:left-6,y:228-46*v/max,"text-anchor":"end"},String(v));
  delta.forEach((v,i)=>mark("rect",{x:x(i)-width/75,y:224-46*v/max,width:width/38,height:46*v/max,fill:"#6371a3"}));
 }
 mark("text",{x:(left+right)/2,y:delta?258:167,"text-anchor":"middle"},"Frequency (Hz, log scale)");
 text(box,"small","Each word’s strongest band is set to 0 dB. Error compares the shapes of the two spectra across 32 bands from 80 Hz to 8 kHz. Values below −60 dB are clipped.");
}

async function select(i,play){
 halt();const rows=["baseline","repeat"].map(k=>result[k].rows[i]),s=result.scores[i],d=$("detail");d.replaceChildren();
 [...$("words").children].forEach((b,j)=>b.setAttribute("aria-pressed",j===i));
 text(d,"h2","Expected word: "+rows[0].word+" · "+(i+1)+" of "+result.scores.length);
 for(let j=0;j<2;j++){const r=rows[j];text(d,"p",(j?"Repeat":"Reference")+": "+(r.heard||"—")+" · "+r.status+" · "+(r.reason?"Unscored: "+r.reason:"aligned "+stamp(r.span)))}
 text(d,"p","Pronunciation deviation: "+(s.distance===null?"unscored":s.distance.toFixed(2)+" MFCC distance units"));
 text(d,"p","Duration change (repeat − reference): "+(s.change===null?"unscored":(s.change>0?"+":"")+s.change+" ms"));
 showSpectrum(d,rows);
 if(play){
  await context().resume();let when=ctx.currentTime+.03;
  for(let j=0;j<2;j++){
   const r=rows[j];if(r.status==="omission")continue;
   const [a,b]=r.span||r.time;if(b<=a)continue;
   const src=ctx.createBufferSource();src.buffer=slots[j?"repeat":"baseline"].buf;src.connect(ctx.destination);
   src.start(when,a,b-a);playing.push(src);when+=b-a+.30
  }
 }
}
async function post(path,data){
 const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
 const body=await r.json();if(!r.ok)throw Error(body.error||"Request failed.");return body;
}
async function displayScore(id,blob,ticket){
 const el=$(id+"Score");el.textContent="Scoring against your personal calibration…";
 try{
  const s=await post("/score",{audio:await b64(blob)});
  if(slots[id].ticket!==ticket||!profile?.ready)return;
  const coverage=s.words+" of "+s.total+" words contributed.";
  el.textContent=s.value===null?"Unscored. "+s.reason+" "+coverage:
   "Personal calibration: "+s.value.toFixed(1)+" / 100 · "+coverage+
   (s.raw<1?" Below your normal anchor.":s.raw>100?" Above your extreme anchor.":"");
 }catch(e){if(slots[id].ticket===ticket)el.textContent=e.message}
}
function clearTake(){
 const s=slots.cal;s.ticket++;s.blob=null;s.buf=null;if(s.url)URL.revokeObjectURL(s.url);
 s.audio.removeAttribute("src");s.audio.load();s.info.textContent="";controls()
}
async function showProfile(state){
 profile=state;const replacing=state.draft_count!=null;const count=replacing?state.draft_count:state.count;
 $("calEntry").hidden=state.ready&&!replacing;$("workspace").hidden=!state.ready;
 $("calReset").hidden=state.count===0;
 $("calReset").textContent=replacing?"Cancel recalibration":state.ready?"Recalibrate score reference":"Restart calibration";
 $("calStep").textContent=state.ready&&!replacing?
  "Calibrated with 5 normal and 5 extreme readings. Each input is scored from 1 (your normal anchor) to 100 (your extreme anchor). This is a personal comparison scale.":
  (replacing?"Recalibrating · current reference stays active. ":"")+(count<5?"Normal reading ":"Extreme impairment example ")+(count%5+1)+" of 5 · "+count+" of 10 saved.";
 if(state.ready){
  for(const id of ["baseline","repeat"]){
   if(!slots[id].blob)await sample(id,id==="baseline"?"baseline":"slower");
   else displayScore(id,slots[id].blob,slots[id].ticket)
  }
 }
}
$("calSave").onclick=async()=>{
 if(saving||!slots.cal.blob)return;
 saving=true;controls();const button=$("cal").querySelector(".rec");button.disabled=true;
 $("calReset").disabled=true;$("calMsg").textContent="Checking word alignment…";
 try{
  const state=await post("/calibrate",{step:profile.draft_count??profile.count,replacing:profile.draft_count!=null,audio:await b64(slots.cal.blob)});
  clearTake();$("calMsg").textContent=state.ready&&state.draft_count==null?"Calibration saved on this Mac.":"Take saved.";await showProfile(state);
 }catch(e){$("calMsg").textContent=e.message}
 finally{saving=false;button.disabled=false;$("calReset").disabled=false;controls()}
};
$("calReset").onclick=async()=>{
 if(recording||saving)return;
 const replacing=profile.draft_count!=null;
 if((replacing||!profile.ready)&&!confirm(replacing?"Discard these new takes and keep your current score reference?":"Restart the incomplete calibration?"))return;
 try{const state=await post(replacing?"/cancel-recalibration":profile.ready?"/start-recalibration":"/reset-calibration",{});clearTake();invalidate();$("calMsg").textContent="";await showProfile(state)}
 catch(e){$("calMsg").textContent=e.message}
};
fetch("/calibration").then(r=>r.json()).then(showProfile).catch(e=>{$("calMsg").textContent="Could not load calibration. Relaunch the demo. "+e.message});
