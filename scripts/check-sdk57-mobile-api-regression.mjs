import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mobileRoot=path.join(root,'mobile');
const exts=new Set(['.ts','.tsx','.js','.jsx']);
const files=[];
function walk(dir){
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    if(ent.name==='node_modules'||ent.name==='.expo')continue;
    const full=path.join(dir,ent.name);
    if(ent.isDirectory())walk(full);
    else if(exts.has(path.extname(ent.name)))files.push(full);
  }
}
walk(mobileRoot);
const forbidden='StyleSheet.absoluteFillObject';
const hits=[];
for(const file of files){
  const text=fs.readFileSync(file,'utf8');
  if(text.includes(forbidden))hits.push(path.relative(root,file));
}
if(hits.length){
  throw new Error(`SDK57 / React Native 0.86 incompatible API ${forbidden} found in: ${hits.join(', ')}`);
}
console.log('SDK57 mobile API regression passed: no StyleSheet.absoluteFillObject usage remains; overlays use the RN 0.86-compatible StyleSheet.absoluteFill API.');
