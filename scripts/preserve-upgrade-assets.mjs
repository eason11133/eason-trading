import fs from 'node:fs';
import path from 'node:path';

function fail(message){console.error(message);process.exit(2)}
function readJson(file,label){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''))}catch(e){fail(`${label} is not valid JSON: ${e.message}`)}}
function ensureParent(file){fs.mkdirSync(path.dirname(file),{recursive:true})}

const [mode,...args]=process.argv.slice(2);
if(mode==='eas-project-id'){
  const [oldApp,stageApp]=args;
  if(!oldApp||!stageApp)fail('Usage: preserve-upgrade-assets.mjs eas-project-id <old-app.json> <stage-app.json>');
  const a=readJson(oldApp,'old app.json');
  const b=readJson(stageApp,'staging app.json');
  const id=a?.expo?.extra?.eas?.projectId;
  if(id){
    b.expo=b.expo||{};
    b.expo.extra=b.expo.extra||{};
    b.expo.extra.eas=b.expo.extra.eas||{};
    b.expo.extra.eas.projectId=id;
    ensureParent(stageApp);
    fs.writeFileSync(stageApp,JSON.stringify(b,null,2)+'\n');
    console.log(`Preserved EAS projectId: ${id}`);
  }else{
    console.log('No existing EAS projectId was present; staging app.json left unchanged.');
  }
  process.exit(0);
}

if(mode==='cloud-worker'){
  const [oldWorker,stageWorker,fromVersion='0.3.15',toVersion='0.3.16']=args;
  if(!oldWorker||!stageWorker)fail('Usage: preserve-upgrade-assets.mjs cloud-worker <old-worker> <stage-worker> [fromVersion] [toVersion]');
  let s=fs.readFileSync(oldWorker,'utf8');
  const escaped=fromVersion.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re=new RegExp(`(\\bversion\\s*:\\s*['"])${escaped}(['"])`,'g');
  let replacements=0;
  s=s.replace(re,(_m,a,b)=>{replacements++;return `${a}${toVersion}${b}`});
  ensureParent(stageWorker);
  fs.writeFileSync(stageWorker,s);
  console.log(`Preserved active GPT Action Worker source; explicit version metadata replacements: ${replacements}.`);
  process.exit(0);
}

fail(`Unknown preserve mode: ${mode||'missing'}`);
