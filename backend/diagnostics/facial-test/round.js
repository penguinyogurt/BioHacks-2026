// Deployed (/take-home/) the suite passes ?api= (the backend's diagnostics endpoint) and ?suite= (its own origin);
// run standalone, both default to the local servers, so the local apps work unchanged.
const Q=new URLSearchParams(location.search),SUITE=Q.get("suite")||"http://127.0.0.1:8772";
const localWebPage=location.pathname.startsWith("/take-home/") && ["127.0.0.1","localhost"].includes(location.hostname);
const API=Q.get("api")||(localWebPage?"http://127.0.0.1:8001/api/diagnostics/facial":"");
"use strict";
const $=id=>document.getElementById(id);
const rounds=[
 ["Happy","give the camera a smile","Smile now"],
 ["Sad","lift your inner brows and turn your mouth corners down","Make a sad face now"],
 ["Disgusted","wrinkle your nose and raise your upper lip","Wrinkle your nose now"],
 ["Neutral","relax your brow and mouth","Relax your face now"]
];
let index=0, phase="off", stream=null, epoch=0, timeout, request;
const PASS_THRESHOLD = 80;
const snapshots=new Array(rounds.length);
const outcomes=new Array(rounds.length).fill(null);
// Per round, for the suite's results report: requested expression, its confidence, the top prediction, pass.
const scores=new Array(rounds.length).fill(null);
function state(value){
 $("challenge").classList.toggle("scored",value==="result");
 phase=value;
 if(parent!==window)parent.postMessage({suite:"facial",complete:false},SUITE);
 $("start").hidden=value!=="off"; $("stop").hidden=value==="off";
 $("ready").hidden=value!=="prompt"; $("next").hidden=value!=="result";

 $("live").hidden=!["prompt","countdown","expression"].includes(value);
 $("photo").hidden=!["scoring","result"].includes(value);
 $("placeholder").hidden=!["off","opening"].includes(value);
 $("timer").hidden=!["countdown","expression"].includes(value);
 $("result").hidden=value!=="result";
}
function prompt(){state("prompt");$("prompt").textContent=rounds[index][0]+" — "+rounds[index][1]}
function stop(){
 epoch++;clearTimeout(timeout);request?.abort();request=null;
 stream?.getTracks().forEach(track=>track.stop());stream=null;
 $("live").srcObject=null;$("photo").width=1;$("photo").height=1;
 $("placeholder").textContent="Camera is off";$("prompt").textContent=rounds[index][0]+" — "+rounds[index][1];state("off")
}
$("stop").onclick=stop;
$("start").onclick=async()=>{
 const id=++epoch;state("opening");$("placeholder").textContent="Opening camera…";
 try{
  const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:640,max:1280},height:{ideal:480,max:960},facingMode:"user"}});
  if(id!==epoch){media.getTracks().forEach(t=>t.stop());return}
  stream=media;$("live").srcObject=media;
  media.getVideoTracks()[0].addEventListener("ended",()=>{if(id===epoch||stream===media)stop()});
  await $("live").play();if(id===epoch)prompt()
 }catch(e){if(id===epoch){stop();$("placeholder").textContent="Camera unavailable: "+e.message}}
};
function finish(title,detail){
 state("result");$("verdict").textContent=title;$("detail").textContent=detail;$("next").focus()
}
async function capture(id){
 if(id!==epoch||phase!=="expression")return;
 clearTimeout(timeout);
 const video=$("live"),canvas=$("photo");
 if(video.readyState<2||!video.videoWidth){stop();$("placeholder").textContent="Camera frame unavailable. Start again.";return}
 canvas.width=video.videoWidth;canvas.height=video.videoHeight;
 const ctx=canvas.getContext("2d");ctx.setTransform(-1,0,0,1,canvas.width,0);
 ctx.drawImage(video,0,0); // Single capture. The visible canvas is also the request source.
 state("scoring");$("prompt").textContent=rounds[index][0]+" — scoring photo";
 try{
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
  if(id!==epoch)return;
  request=new AbortController();
  if(!blob)throw Error("Could not capture a photo. Press Ready to try again.");
  let response;
  try{
   response=await fetch(API+"/photo",{method:"POST",body:blob,signal:request.signal});
  }catch{
   throw Error("Cannot reach the facial scoring server. Start the scoring server, then press Ready.");
  }
  if(!response.ok){
   if(response.status===503)throw Error("Facial scoring is unavailable. Check the model setup, then press Ready.");
   throw Error("The facial scoring server returned error "+response.status+". Press Ready to retry.");
  }
  const data=await response.json();if(id!==epoch)return;
  $("prompt").textContent=rounds[index][0]+" — captured photo";
  if(data.faces!==1){prompt();$("prompt").textContent="We need one face in view. Look at the camera, then press Ready.";return}
  const target=rounds[index][0], probs=data.probabilities;
  const top=Object.keys(probs).reduce((a,b)=>probs[a]>=probs[b]?a:b);
  const conf=probs[target]*100;
  let info=target+": "+conf.toFixed(1)+"%";
  if(top!==target)info+=" · Top prediction: "+top+" ("+(probs[top]*100).toFixed(2)+"%)";
  const passed=top===target&&conf>=PASS_THRESHOLD;
 if(snapshots[index])URL.revokeObjectURL(snapshots[index]);
 snapshots[index]=URL.createObjectURL(blob);
 outcomes[index]=passed;
 scores[index]={expression:target,confidence:+conf.toFixed(1),top,passed};
 finish(passed?"PASS":"FAIL",info);
 if(index===rounds.length-1){
  const total=outcomes.filter(Boolean).length+" of "+rounds.length+" expressions correct";
  stop();$("challenge").hidden=true;$("reviewPage").hidden=false;$("totalRight").textContent=total;
  $("photos").replaceChildren(...rounds.map(([label],i)=>{
   const card=document.createElement("figure"),img=document.createElement("img"),caption=document.createElement("figcaption"),badge=document.createElement("small");
   img.src=snapshots[i];img.alt=label+" round, scored photo";
   caption.textContent=label;badge.textContent=outcomes[i]?"PASS":"FAIL";badge.dataset.pass=String(outcomes[i]);
   caption.append(badge);card.append(img,caption);return card
  }));
  $("reviewTitle").focus();
  if(parent!==window)parent.postMessage({suite:"facial",complete:true,summary:total,results:{threshold:PASS_THRESHOLD,rounds:scores}},SUITE);
 }
 }catch(e){if(id===epoch){prompt();$("prompt").textContent=e instanceof SyntaxError?"The scoring server returned an unreadable result. Check the server address.":e.message}}
}
$("ready").onclick=()=>{
 if(phase!=="prompt")return;
 const id=++epoch,start=performance.now();
 function tick(){
  if(id!==epoch)return;
  const elapsed=performance.now()-start;
  if(elapsed>=6000){capture(id);return}
  const first=elapsed<3000;state(first?"countdown":"expression");
  $("prompt").textContent=first?"Get ready":rounds[index][2]+" — hold it until the photo";
  $("timer").textContent=Math.ceil(((first?3000:6000)-elapsed)/1000);
  timeout=setTimeout(tick,(Math.floor(elapsed/1000)+1)*1000-elapsed)
 }
 tick()
};

$("next").onclick=()=>{if(phase==="result"&&index<rounds.length-1){index++;prompt();$("ready").focus()}};
window.addEventListener("pagehide",stop);
document.addEventListener("visibilitychange",()=>{if(document.hidden&&["countdown","expression"].includes(phase)){epoch++;clearTimeout(timeout);prompt()}});
