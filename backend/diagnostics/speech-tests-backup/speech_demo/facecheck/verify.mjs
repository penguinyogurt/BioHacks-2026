// Node 24: node --experimental-vm-modules verify.mjs /path/to/original/facecheck/src
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {stripTypeScriptTypes} from "node:module";

async function run(dir, original) {
  const timers=[], prompts=[], modules=new Map();
  let hold=0;
  const ctx=vm.createContext({
    setTimeout:(cb,ms)=>{timers.push(ms);cb()},
    samples:()=>Array.from({length:20},(_,i)=>({signal:i+(hold++)/100,other:i%3})),
  });
  function load(name) {
    if(modules.has(name))return modules.get(name);
    let code;
    if(name==="render")code='export function startRecording(){};export function stopRecording(){return samples()}';
    else {
      code=readFileSync(join(dir,name+(original?".ts":".js")),"utf8");
      if(original)code=stripTypeScriptTypes(code,{mode:"transform"});
    }
    const mod=new vm.SourceTextModule(code,{context:ctx,identifier:name});
    modules.set(name,mod);return mod;
  }
  async function get(name){
    const mod=load(name);
    if(mod.status==="unlinked")await mod.link(spec=>load(spec.replace(/^\.\//,"").replace(/\.js$/,"")));
    if(mod.status==="linked")await mod.evaluate();
    return mod.namespace;
  }
  const protocol=await get("protocol"),math=await get("compare"),cap=await get("capture");
  const capture=await cap.runProtocol((...args)=>prompts.push(args),async label=>prompts.push(label));
  const ids=protocol.EXPRESSIONS.map(e=>e.id);
  const names=[...new Set(Object.values(protocol.EXPRESSION_PRIMARY_BLENDSHAPES).flat())];
  function session(strength,neutral){
    const sample={neutral:Object.fromEntries(names.map(n=>[n,neutral]))};
    for(const id of ids)sample[id]=Object.fromEntries(names.map((n,i)=>[n,Math.min(1,neutral+(i%9?strength*(1+i%4)/4:0))]));
    return sample;
  }
  const base=session(.72,.08), current=session(.42,.23),past=session(.62,.14);
  const flat=math.compareSession(base,[past],current);
  const robust=math.compareSession(base,[past,session(.32,.05)],current);
  const noSpread=math.compareSession(base,[past,past],current);
  assert.equal(flat.overallBasis,"flat");assert.equal(robust.overallBasis,"robust");assert.equal(noSpread.overallBasis,"flat");
  assert.deepEqual(timers,[1800,...Array(10).fill(2200)]);
  return JSON.stringify({capture,timers,prompts,flat,robust,noSpread,trend:math.sessionAmplitudeIndex(base,current),
    quiet:math.compareSession(session(0,0),[],session(0,0))});
}
assert.equal(await run(process.argv[2],true),await run(fileURLToPath(new URL(".",import.meta.url)),false));
console.log("Source and port matched on capture prompts, hold timing, sampled vectors, all comparison fields, and history branches.");
