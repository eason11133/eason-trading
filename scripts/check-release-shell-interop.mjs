import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const release=path.join(root,'release');
const files=fs.readdirSync(release).filter(x=>/\.ps1(?:\.template)?$/i.test(x));
const errors=[];
for(const name of files){
  const text=fs.readFileSync(path.join(release,name),'utf8');
  if(/\bnode(?:\.exe)?\s+-e\b/i.test(text))errors.push(`${name} contains inline node -e; PowerShell/Node quoting must use a .mjs helper`);
  if(/\bfor\s*\(\s*\$[A-Za-z_]\w*\s+in\s+/i.test(text))errors.push(`${name} contains invalid PowerShell C-style for-in syntax`);
}

const helper=path.join(root,'scripts','preserve-upgrade-assets.mjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eason-shell-interop-'));
try{
  const oldApp=path.join(tmp,'old-app.json'),newApp=path.join(tmp,'new-app.json');
  fs.writeFileSync(oldApp,JSON.stringify({expo:{extra:{eas:{projectId:'interop-project-id'}}}}));
  fs.writeFileSync(newApp,JSON.stringify({expo:{name:'Eason',extra:{internalVersion:'0.3.16'}}}));
  let r=spawnSync(process.execPath,[helper,'eas-project-id',oldApp,newApp],{encoding:'utf8'});
  if(r.status!==0)errors.push(`EAS projectId helper failed: ${r.stderr||r.stdout}`);
  else if(JSON.parse(fs.readFileSync(newApp,'utf8'))?.expo?.extra?.eas?.projectId!=='interop-project-id')errors.push('EAS projectId helper did not preserve projectId');

  const oldWorker=path.join(tmp,'old-worker.mjs'),newWorker=path.join(tmp,'new-worker.mjs');
  fs.writeFileSync(oldWorker,"export const meta={version:'0.3.15'};\nconst keep='0.3.15';\n");
  r=spawnSync(process.execPath,[helper,'cloud-worker',oldWorker,newWorker,'0.3.15','0.3.16'],{encoding:'utf8'});
  if(r.status!==0)errors.push(`Worker preservation helper failed: ${r.stderr||r.stdout}`);
  else {
    const out=fs.readFileSync(newWorker,'utf8');
    if(!out.includes("version:'0.3.16'"))errors.push('Worker helper did not bump explicit version metadata');
    if(!out.includes("const keep='0.3.15'"))errors.push('Worker helper modified unrelated 0.3.15 content');
  }
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }

const lockHelper=fs.readFileSync(path.join(root,'scripts','read-sdk57-lock-versions.mjs'),'utf8');
if(!lockHelper.includes("node_modules/${name}"))errors.push('SDK57 lock reader helper is missing package-lock packages-map lookup');

if(errors.length){console.error('Release shell interop regression failed:');for(const x of errors)console.error(' - '+x);process.exit(1)}
console.log('Release shell interop regression passed: no inline node -e in release PowerShell; helper argv paths preserve EAS/Worker data safely.');
