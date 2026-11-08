// Regenerate native ES modules from the pinned branch export using Node 24.
import {stripTypeScriptTypes} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const src=process.argv[2];
if(!src)throw Error('Pass the original facecheck/src directory');
for(const name of ['protocol','landmarker','render','capture','compare','storage','main']){
  const source=readFileSync(join(src,name+'.ts'),'utf8');
  let js=stripTypeScriptTypes(source,{mode:'transform'})
    .replace(/from "(\.\/\w+)"/g,'from "$1.js"')
    .replaceAll('"@mediapipe/tasks-vision"','"./assets/vision_bundle.mjs"')
    .replaceAll('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm','/facecheck/assets/wasm')
    .replaceAll('https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task','/facecheck/assets/face_landmarker.task')
    .replace('import "./style.css";','');
  writeFileSync(fileURLToPath(new URL(name+'.js',import.meta.url)),js.trim()+'\n');
}
