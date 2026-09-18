import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveMobileTooling } from './mobile-tooling.mjs';

function writeJson(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(obj));}
function makePackage(base,name,files,bin){
  const pkg=path.join(base,'node_modules',name);
  writeJson(path.join(pkg,'package.json'),{name,version:'0.0.0-test',...(bin?{bin}: {})});
  for(const relEntry of files){fs.mkdirSync(path.dirname(path.join(pkg,relEntry)),{recursive:true});fs.writeFileSync(path.join(pkg,relEntry),'// test stub\n');}
}
function makeTree(layout){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),`eason-tooling-${layout}-`));
  writeJson(path.join(root,'package.json'),{private:true,workspaces:['mobile']});
  writeJson(path.join(root,'mobile','package.json'),{name:'mobile-test',private:true});
  const base=layout==='root'?root:path.join(root,'mobile');
  makePackage(base,'expo',['bin/cli'],{expo:'bin/cli'});
  makePackage(base,'expo-doctor',['bin/expo-doctor.js'],{'expo-doctor':'bin/expo-doctor.js'});
  makePackage(base,'typescript',['bin/tsc']);
  return root;
}
for(const layout of ['root','mobile']){
  const root=makeTree(layout);
  try{
    const got=resolveMobileTooling(root);
    const expectedSegment=layout==='root'?path.join(root,'node_modules'):path.join(root,'mobile','node_modules');
    for(const [name,value] of Object.entries({expoPackage:got.expoPackage,expoCli:got.expoCli,expoDoctorCli:got.expoDoctorCli,tsc:got.tsc})){
      if(!value.startsWith(expectedSegment))throw new Error(`${layout}: ${name} resolved outside expected dependency tree: ${value}`);
    }
    console.log(`mobile tooling resolution passed for ${layout}-level node_modules (Expo CLI + Expo Doctor + TypeScript)`);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
