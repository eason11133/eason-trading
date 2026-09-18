import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveMobileTooling } from './mobile-tooling.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const requireMobileTypecheck=process.argv.includes('--require-mobile-typecheck');
const installedRuntime=process.argv.includes('--installed-runtime');
const nodeVersion=process.versions.node;
const [major,minor]=nodeVersion.split('.').map(Number);
if(major<22||(major===22&&minor<13))throw new Error(`Node.js 22.13+ is required. Found ${nodeVersion}`);

function run(cmd,args,{cwd=root,env=process.env,label=`${cmd} ${args.join(' ')}`}={}){
  const r=spawnSync(cmd,args,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024});
  if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);
  if(r.error)throw new Error(`${label} could not start: ${r.error.code||r.error.name||'spawn error'} ${r.error.message}`);
  if(r.status!==0)throw new Error(`${label} failed with exit code ${r.status}${r.signal?` (signal ${r.signal})`:''}`);
  return r.stdout||'';
}
function files(dir,suffix){return fs.readdirSync(dir).filter(x=>x.endsWith(suffix)).sort().map(x=>path.join(dir,x));}
function tapCount(text){const m=[...text.matchAll(/^# tests (\d+)$/gm)];return m.reduce((n,x)=>n+Number(x[1]),0);}

console.log(`=== Eason Trading release verification (Node ${nodeVersion}) ===`);
run(process.execPath,[path.join(root,'scripts','check-package-clean.mjs')],{label:'pre-test package cleanliness'});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'eason-release-'));
let serverTests=0,cloudTests=0;
try{
  const baseEnv={...process.env,TRADING_TEST_SEED:'1',FUGLE_API_KEY:'',TRADING_DB_FILE:path.join(temp,'state.json')};
  for(const f of files(path.join(root,'server','src'),'.test.mjs')){
    for(const tail of ['state.json','state.json.bak'])fs.rmSync(path.join(temp,tail),{force:true});
    console.log(`Testing server ${path.basename(f)}...`);
    serverTests+=tapCount(run(process.execPath,['--test','--test-concurrency=1',f],{cwd:path.join(root,'server'),env:baseEnv,label:path.basename(f)}));
  }
  for(const f of files(path.join(root,'cloudflare','src'),'.test.mjs')){
    console.log(`Testing cloud ${path.basename(f)}...`);
    cloudTests+=tapCount(run(process.execPath,['--test','--test-concurrency=1',f],{cwd:path.join(root,'cloudflare'),env:process.env,label:path.basename(f)}));
  }
  run(process.execPath,[path.join(root,'scripts','check-http-smoke.mjs')],{label:'check-http-smoke.mjs'});

  const mobile=path.join(root,'mobile');
  let tooling=null;
  try{tooling=resolveMobileTooling(root)}catch(e){if(requireMobileTypecheck||installedRuntime)throw e;}
  if(tooling){
    console.log(`Resolved Expo from ${tooling.expoPackage}`);
    console.log(`Running mobile typecheck with ${process.execPath} ${tooling.tsc} --noEmit`);
    run(process.execPath,[tooling.tsc,'--noEmit'],{cwd:mobile,label:'mobile typecheck'});
  }else{
    console.warn('Clean source package has no mobile dependency tree yet; Expo/React TypeScript verification is deferred until install-time dependencies are installed.');
  }

  const contractScripts=['check-mobile-tooling-resolution.mjs','check-cloudflare-cli-runner.mjs','check-cloud-module-pair.mjs','check-cloud-setup-full-sim.mjs','check-release-contract.mjs','check-installer-contract.mjs','check-sdk57-mobile-api-regression.mjs','check-release-shell-interop.mjs','check-rollback-merge.mjs','check-production-audit-contract.mjs'];if(String(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version)==='0.3.16')contractScripts.push('check-sdk57-preflight-contract.mjs','check-sdk57-proof-contract.mjs','check-sdk57-patch-regression.mjs');for(const script of contractScripts)run(process.execPath,[path.join(root,'scripts',script)],{label:script});
  if(installedRuntime) console.log('Installed-runtime verification: package-clean check skipped because state/env/dependencies are expected after installation.');
  else run(process.execPath,[path.join(root,'scripts','check-package-clean.mjs')],{label:'check-package-clean.mjs'});
  console.log(`Release verification passed. Backend ${serverTests}/${serverTests}; Cloud ${cloudTests}/${cloudTests}.`);
} finally {fs.rmSync(temp,{recursive:true,force:true});}
