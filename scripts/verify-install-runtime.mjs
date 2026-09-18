import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveMobileTooling } from './mobile-tooling.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mobile=path.join(root,'mobile');
const nodeVersion=process.versions.node;
const [major,minor]=nodeVersion.split('.').map(Number);
if(major<22||(major===22&&minor<13))throw new Error(`Node.js 22.13+ is required. Found ${nodeVersion}`);
const mode=process.argv.includes('--ledger-only')?'ledger':process.argv.includes('--typecheck-only')?'typecheck':'all';

function parseEnv(file){
 const out={};
 if(!fs.existsSync(file))return out;
 for(const raw of fs.readFileSync(file,'utf8').split(/\r?\n/)){
  const line=raw.trim();if(!line||line.startsWith('#'))continue;
  const i=line.indexOf('=');if(i<1)continue;
  out[line.slice(0,i).trim().replace(/^\uFEFF/,'')]=line.slice(i+1).trim();
 }
 return out;
}
function runNode(args,{cwd=root,env=process.env,label=args.join(' '),quiet=false}={}){
 return new Promise((resolve,reject)=>{
  let logs='';
  const child=spawn(process.execPath,args,{cwd,env,stdio:quiet?['ignore','pipe','pipe']:'inherit',windowsHide:true});
  if(quiet){child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x)}
  child.once('error',e=>reject(new Error(`${label} could not start: ${e.code||e.name} ${e.message}`)));
  child.once('exit',(code,signal)=>code===0?resolve(logs):reject(new Error(`${label} failed with exit code ${code}${signal?` (signal ${signal})`:''}${logs?`\n${logs.slice(-4000)}`:''}`)));
 });
}
function readInstalledVersion(pkgPath){return String(JSON.parse(fs.readFileSync(pkgPath,'utf8')).version||'')}
function assertVersion(name,actual,test,expected){if(!test(actual))throw new Error(`${name} installed version ${actual||'missing'} is not compatible with Expo SDK 57; expected ${expected}`)}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const target=String(pkg.version||'');
const envFile=path.join(root,'.env.local');
const localEnv=parseEnv(envFile);
const stateFile=path.join(root,'server','data','state.json');
if(mode!=='typecheck'){
 if(!localEnv.FUGLE_API_KEY)throw new Error('.env.local does not contain FUGLE_API_KEY');
 if(!localEnv.TRADING_API_KEY||localEnv.TRADING_API_KEY.length<32)throw new Error('.env.local does not contain a valid TRADING_API_KEY');
 if(fs.existsSync(stateFile)){
  let state;try{state=JSON.parse(fs.readFileSync(stateFile,'utf8'))}catch(e){throw new Error(`Imported state.json is not valid JSON: ${e.message}`)}
  if(!state||typeof state!=='object'||!Array.isArray(state.positions)||!Array.isArray(state.trades)||!state.metadata)throw new Error('Imported state.json is missing required ledger fields');
 }
}

async function verifyLedger(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'eason-install-runtime-'));
 const tempState=path.join(temp,'state.json');
 try{
  if(fs.existsSync(stateFile))fs.copyFileSync(stateFile,tempState);
  const port=21000+Math.floor(Math.random()*2000);
  const childEnv={...process.env,...localEnv,PORT:String(port),TRADING_DB_FILE:tempState,FUGLE_API_KEY:'',CLOUD_MONITOR_URL:'',CLOUD_MONITOR_API_KEY:''};
  let logs='';
  const child=spawn(process.execPath,['src/server.mjs'],{cwd:path.join(root,'server'),env:childEnv,stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let reached=false;
  try{
   for(let i=0;i<80;i++){
    try{const r=await fetch(`http://127.0.0.1:${port}/health`,{headers:{'x-api-key':localEnv.TRADING_API_KEY}});if(r.ok){const h=await r.json();if(h.ok===true&&h.version===target){reached=true;break}}}catch{}
    await sleep(100);
   }
   if(!reached)throw new Error(`Backend could not load the imported ledger/schema in install smoke test. ${logs.slice(-2000)}`);
  }finally{
   child.kill();await Promise.race([new Promise(r=>child.once('exit',r)),sleep(1000)]);try{child.kill('SIGKILL')}catch{}
  }
  console.log(`Imported-ledger backend smoke passed for v${target}.`);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
}
async function verifyMobile(){
 const tooling=resolveMobileTooling(root);
 const expoVersion=readInstalledVersion(tooling.expoPackage);
 const expoDir=path.dirname(tooling.expoPackage);
 const ledgerPath=path.join(expoDir,'bundledNativeModules.json');
 if(!fs.existsSync(ledgerPath))throw new Error(`Expo compatibility ledger is missing: ${ledgerPath}`);
 const bundled=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));
 const declared=JSON.parse(fs.readFileSync(path.join(mobile,'package.json'),'utf8')).dependencies||{};
 const ledgerManaged=['react','react-dom','react-native','react-native-web','react-native-safe-area-context','expo-notifications','expo-constants','expo-clipboard','expo-secure-store','expo-build-properties','react-native-svg'];
 for(const name of ledgerManaged){
  const expected=bundled[name];
  if(!expected)throw new Error(`Expo ${expoVersion} compatibility ledger does not contain ${name}`);
  if(!declared[name])throw new Error(`mobile/package.json is missing required SDK57 dependency ${name}`);
  // Do not compare declaration strings to Expo's recommended range text. A declaration like
  // ~57.0.17 can validly resolve to 57.0.18. The installed Expo CLI's `install --check`
  // below is the authoritative compatibility gate, while the verified package-lock SHA
  // freezes the exact dependency graph used for production installation.
  tooling.resolvePackage(name,name);
 }
 const reactVersion=readInstalledVersion(tooling.resolvePackage('react','React'));
 const rnVersion=readInstalledVersion(tooling.resolvePackage('react-native','React Native'));
 assertVersion('Expo',expoVersion,v=>/^57\./.test(v),'57.x');
 assertVersion('React',reactVersion,v=>v==='19.2.3','19.2.3');
 assertVersion('React Native',rnVersion,v=>v==='0.86.3','0.86.3');
 console.log(`Resolved Expo ${expoVersion} from ${tooling.expoPackage}`);
 console.log(`Resolved React ${reactVersion} / React Native ${rnVersion}.`);
 console.log(`Expo ${expoVersion} compatibility ledger contains all ${ledgerManaged.length} required Eason Trading native dependencies; exact compatibility is validated by Expo CLI.`);
 const expoEnv={...process.env,CI:'1',EXPO_NO_TELEMETRY:'1'};
 console.log('Checking Expo SDK 57 dependency compatibility with local Expo CLI...');
 await runNode([tooling.expoCli,'install','--check'],{cwd:mobile,env:expoEnv,label:'expo install --check'});
 console.log('Running Expo Doctor against the installed SDK 57 tree...');
 await runNode([tooling.expoDoctorCli,mobile],{cwd:mobile,env:expoEnv,label:'expo-doctor'});
 console.log('Validating Expo config/plugins...');
 await runNode([tooling.expoCli,'config','--type','public','--json'],{cwd:mobile,env:expoEnv,label:'expo config --type public',quiet:true});
 console.log(`Running real mobile typecheck for v${target} with ${tooling.tsc}...`);
 await runNode([tooling.tsc,'--noEmit'],{cwd:mobile,label:'mobile tsc --noEmit'});
 const exportRoot=fs.mkdtempSync(path.join(os.tmpdir(),'eason-sdk57-export-'));
 try{
  for(const platform of ['android','ios']){
   const out=path.join(exportRoot,platform);
   console.log(`Bundling SDK 57 ${platform} export smoke...`);
   await runNode([tooling.expoCli,'export','--platform',platform,'--output-dir',out,'--clear'],{cwd:mobile,env:expoEnv,label:`expo export --platform ${platform}`,quiet:true});
  }
 }finally{fs.rmSync(exportRoot,{recursive:true,force:true});}
 console.log(`Expo SDK 57 dependency/config/typecheck/Android+iOS bundle verification passed for v${target}.`);
}

if(mode!=='typecheck')await verifyLedger();
if(mode!=='ledger')await verifyMobile();
if(mode==='all')console.log(`Install runtime check passed for v${target}: imported-ledger backend smoke + full Expo SDK 57 mobile verification.`);
