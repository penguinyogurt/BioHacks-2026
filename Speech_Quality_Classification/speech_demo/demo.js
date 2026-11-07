"use strict";
const $=id=>document.getElementById(id), slots={}, labels={baseline:"Standard pace",slower:"Slower reading",edited:"Skipped and replaced words",reference:"macOS whole-passage reference"};
let result, ctx, playing=[], generation=0, sourceMode="self", savedBase, recording=null, pending=0;
const context=()=>ctx||(ctx=new AudioContext());
function halt(){for(const s of playing){try{s.stop()}catch{}}playing=[]}
function invalidate(){generation++;halt();result=null;$("result").hidden=true;$("status").textContent=""}
function controls(){ $("go").disabled=!!(pending||recording||!slots.baseline?.blob||!slots.repeat?.blob); }
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
 btn.textContent="Stop recording";$("status").textContent="Recording "+id+"…";
 rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
 const timer=setTimeout(()=>{if(rec.state==="recording")rec.stop()},58000);
 rec.onstop=async()=>{clearTimeout(timer);stream.getTracks().forEach(t=>t.stop());
  try{await setClip(id,await wav(new Blob(chunks,{type:rec.mimeType})),"Microphone · "+id)}
  catch(e){message(e)}finally{recording=null;btn.textContent="Record";$("mode").disabled=false;controls()}};
 rec.start()
}
function card(id,title){
 const el=$(id);el.innerHTML='<h2></h2><div class="inputs"><button class="rec">Record</button><label>Upload WAV <input type="file" accept=".wav,audio/wav"></label><label>Try sample audio <select><option value="">Choose a synthetic sample</option></select></label></div><p class="source"></p><audio controls></audio>';
 el.querySelector("h2").textContent=title;const sel=el.querySelector("select");
 for(const k of ["baseline","slower","edited"])sel.add(new Option(labels[k],k));
 slots[id]={ticket:0,audio:el.querySelector("audio"),info:el.querySelector(".source")};
 sel.onchange=async()=>{if(sel.value)try{await sample(id,sel.value)}catch(e){message(e)}sel.value=""};
 const inp=el.querySelector("input");inp.onchange=async()=>{if(inp.files.length)try{const file=inp.files[0];await setClip(id,await wav(file),"Upload · "+file.name)}catch(e){message(e)}inp.value=""};
 const btn=el.querySelector(".rec");btn.onclick=()=>record(id,btn).catch(message)
}
card("baseline","Baseline");card("repeat","Repeat");
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
 $("result").hidden=false;$("used").textContent="Reference used: "+(sourceMode==="tts"?"macOS TTS":"baseline")+" · "+slots.baseline.name;
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
async function select(i,play){
 halt();const rows=["baseline","repeat"].map(k=>result[k].rows[i]),s=result.scores[i],d=$("detail");d.replaceChildren();
 [...$("words").children].forEach((b,j)=>b.setAttribute("aria-pressed",j===i));
 text(d,"h2","Expected word: "+rows[0].word+" · "+(i+1)+" of "+result.scores.length);
 for(let j=0;j<2;j++){const r=rows[j];text(d,"p",(j?"Repeat":"Reference")+": "+(r.heard||"—")+" · "+r.status+" · "+(r.reason?"Unscored: "+r.reason:"aligned "+stamp(r.span)))}
 text(d,"p","Pronunciation deviation: "+(s.distance===null?"unscored":s.distance.toFixed(2)+" MFCC distance units"));
 text(d,"p","Duration change (repeat − reference): "+(s.change===null?"unscored":(s.change>0?"+":"")+s.change+" ms"));
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
Promise.all([sample("baseline","baseline"),sample("repeat","slower")]).catch(message);
