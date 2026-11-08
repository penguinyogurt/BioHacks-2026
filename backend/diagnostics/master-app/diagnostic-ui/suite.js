"use strict";
const $=id=>document.getElementById(id);
const steps=[
 {key:"facial",name:"Facial expressions",description:"Follow four expression prompts. Hold each expression until the camera takes your photo."},
 {key:"speech",name:"Passage reading",description:"Read three short passages aloud. See which words were recognized, missed, or replaced."},
 {key:"line",name:"Line tracing",description:"Trace five shapes from the green dot to the blue dot using just your mouse or trackpad."}
];
const paths=[
 "M60 110 Q95 35 130 110 T200 110 T270 110 T340 110",
 "M65 144 L118 71 170 145 222 72 275 145 332 72",
 "M252 55 C127 43 137 99 197 110 C273 125 270 174 144 170",
 "M62 157 H122 Q131 157 131 148 V131 Q131 122 140 122 H198 Q207 122 207 113 V96 Q207 87 216 87 H276 Q285 87 285 78 V68 Q285 60 294 60 H337",
 Array.from({length:151},(_,i)=>{const t=i/150,a=4.2*Math.PI*t,r=8+65*t;return (i?"L":"M")+(200+r*Math.cos(a))+" "+(111+r*Math.sin(a))}).join(" ")
];
let index=0, frame,origin,raf;
const smooth=t=>{t=Math.min(1,Math.max(0,t));return t*t*(3-2*t)};
function animate(){
 const start=performance.now(), reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
 $("faceArt").style.display=index===2?"none":"";
 $("lineArt").style.display=index===2?"":"none";
 let previous=-1,length;
 function paint(now){
  const ms=reduced?3400:Math.max(0,now-start);
  const t=ms%4000,cycle=Math.floor(ms/4000);
  const k=smooth((t-(index===1?2690:2340))/260);
  $("check").setAttribute("opacity",k);
  if(index===2){
   const shape=cycle%5;
   if(shape!==previous){
    previous=shape;for(const id of ["track","draw"])$(id).setAttribute("d",paths[shape]);
    length=$("track").getTotalLength();$("draw").setAttribute("stroke-dasharray",length+" "+length)
   }
   const pos=smooth((t-220)/2000),p=$("track").getPointAtLength(length*pos);
   $("draw").setAttribute("stroke-dashoffset",length*(1-pos));
   $("cursor").setAttribute("transform","translate("+p.x+" "+p.y+")")
  }else{
   const emotion=cycle%4,speech=index===1;
   const cue=speech?"Read the passage":["Smile","Look sad","Wrinkle your nose","Relax your face"][emotion];
   $("cue").textContent=cue;$("bubble").setAttribute("opacity",smooth((t-230)/240));
   const blend=smooth((t-1050)/700);
   let lift=speech?21*smooth((t-2950)/400):[25,-24,-7,0][emotion]*blend;
   const talking=speech&&t>850&&t<2600;
   const open=talking?4+11*(.5+.5*Math.sin((t-850)/97)):0;
   $("mouth").setAttribute("d",talking?`M183 140 Q200 ${140-open/2} 217 140 Q200 ${140+open} 183 140Z`:`M177 139 Q200 ${139+lift} 223 ${139+(!speech&&emotion===2?-8*blend:0)}`);
   $("mouth").style.fill=talking?"#68503a":"none";
   const tilt=speech?0:[0,-8,8,0][emotion]*blend;
   $("eyebrows").setAttribute("d",`M165 96l17 ${tilt} M218 ${96+tilt}l17 ${-tilt}`)
  }
  if(!reduced)raf=requestAnimationFrame(paint)
 }
 paint(start)
}
function opening(){
 frame?.remove();frame=null;
 $("shell").hidden=true;$("final").hidden=true;$("opening").hidden=false;
 $("step").textContent="Test "+(index+1)+" of 3";$("title").textContent=steps[index].name;
 $("description").textContent=steps[index].description;$("error").textContent="";
 $("begin").disabled=false;$("begin").textContent="Begin";animate()
}
$("begin").onclick=async()=>{
 const step=steps[index];$("begin").disabled=true;$("begin").textContent="Opening…";
 try{
  const response=await fetch("/begin/"+step.key,{method:"POST"});
  const data=await response.json();if(!response.ok)throw Error(data.error);
  cancelAnimationFrame(raf);$("opening").hidden=true;$("shell").hidden=false;
  $("shell").classList.remove("review");$("active").textContent=step.name;$("next").hidden=true;$("outcome").textContent="";
  frame=document.createElement("iframe");frame.title=step.name;
  frame.allow=step.key==="facial"?"camera":step.key==="speech"?"microphone":"";
  const url=new URL(data.url,location.href);origin=url.origin;
  frame.src=url.href;$("mount").replaceChildren(frame);
 }catch(error){$("error").textContent=error.message;$("begin").disabled=false;$("begin").textContent="Begin"}
};
window.addEventListener("message",e=>{
 if(!frame||e.source!==frame.contentWindow||e.origin!==origin||e.data?.suite!==steps[index].key)return;
 const done=e.data.complete===true;
 $("shell").classList.toggle("review",done);
 $("outcome").textContent=done?e.data.summary:"";
 $("next").textContent=index===2?"Complete Diagnostic":"Proceed To Next Test";
 $("next").hidden=!done;
});
$("next").onclick=()=>{
 if(!frame||$("next").hidden)return;
 $("next").hidden=true;
 frame.remove();frame=null;
 if(++index<steps.length){opening();$("begin").focus();return}
 $("shell").hidden=true;document.querySelector("header").hidden=true;
 $("final").hidden=false;$("thanks").focus();
};
opening();
