import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createWranglerRunner,semverAtLeast,parseWorkerUrl,parseWorkersDevOnboardingUrl,needsWorkersDevOnboarding,openExternalUrl,CURRENT_WORKERS_PAGES_URL} from './cloudflare-setup-core.mjs';
import {createInterface} from 'node:readline/promises';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.dirname(here);
const cloud=path.join(root,'cloudflare');
const envFile=path.join(root,'.env.local');
const dbName='eason-trading-monitor';
const workerName='eason-trading-monitor';
const checkpointFile=path.join(root,'.eason-cloud-setup-state.json');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function readEnvFile(){
  const out={};
  if(!fs.existsSync(envFile))return out;
  for(const raw of fs.readFileSync(envFile,'utf8').split(/\r?\n/)){
    const line=raw.trim(); if(!line||line.startsWith('#'))continue;
    const i=line.indexOf('='); if(i<0)continue;
    out[line.slice(0,i).trim().replace(/^\uFEFF/,'')]=line.slice(i+1).trim();
  }
  return out;
}
function setEnvValue(name,value){
  const lines=fs.existsSync(envFile)?fs.readFileSync(envFile,'utf8').split(/\r?\n/):[];
  let found=false;
  const re=new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*=`);
  for(let i=0;i<lines.length;i++)if(re.test(lines[i])){lines[i]=`${name}=${value}`;found=true;}
  if(!found)lines.push(`${name}=${value}`);
  fs.writeFileSync(envFile,lines.join('\n').replace(/\n+$/,'')+'\n','utf8');
}

function loadCheckpoint(){
  try{return JSON.parse(fs.readFileSync(checkpointFile,'utf8'));}catch{return {};}
}
function saveCheckpoint(patch){
  const next={...loadCheckpoint(),...patch,updatedAt:new Date().toISOString()};
  fs.writeFileSync(checkpointFile,JSON.stringify(next,null,2)+'\n','utf8');
}
function currentMigrationFingerprint(){
  const dir=path.join(cloud,'migrations');
  const h=crypto.createHash('sha256');
  for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.sql')).sort()){
    h.update(name);h.update('\0');h.update(fs.readFileSync(path.join(dir,name)));h.update('\0');
  }
  return h.digest('hex');
}
async function waitForOnboarding(onboardingUrl){
  console.log('This Cloudflare account has not registered its free workers.dev account subdomain yet.');
  console.log(`Workers & Pages: ${onboardingUrl||CURRENT_WORKERS_PAGES_URL}`);
  if(process.env.EASON_CLOUD_SETUP_ONBOARDING_AUTO_CONTINUE==='1'){
    console.log('Simulation mode: continuing after workers.dev onboarding checkpoint.');
    return;
  }
  const workersPage=onboardingUrl||CURRENT_WORKERS_PAGES_URL;
  const opened=openExternalUrl(workersPage);
  console.log(opened?'Opened the current Cloudflare Workers & Pages page in your browser.':'Open the Workers & Pages URL above in your browser.');
  console.log('On Workers & Pages, find Your subdomain and choose Change/Set up, then register any available workers.dev account subdomain. This is a one-time Cloudflare account setup and does not involve GitHub.');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  try{await rl.question('After Cloudflare says the workers.dev subdomain is ready, return here and press Enter to continue... ');}finally{rl.close();}
}
async function deployBootstrapWithOnboarding(runWrangler){
  let r=runWrangler(['deploy'],{capture:true,allowFailure:true,label:'wrangler deploy bootstrap'});
  if(r.code===0)return r;
  let detail=`${r.stdout}\n${r.stderr}`;
  if(!needsWorkersDevOnboarding(detail))throw new Error(`wrangler deploy bootstrap failed with exit code ${r.code}\n${detail.trim()}`);
  const onboardingUrl=parseWorkersDevOnboardingUrl(detail);
  await waitForOnboarding(onboardingUrl);
  for(let attempt=1;attempt<=6;attempt++){
    if(attempt>1)await sleep(2000);
    r=runWrangler(['deploy'],{capture:true,allowFailure:true,label:'wrangler deploy bootstrap retry'});
    if(r.code===0)return r;
    detail=`${r.stdout}\n${r.stderr}`;
    if(!needsWorkersDevOnboarding(detail))throw new Error(`wrangler deploy bootstrap retry failed with exit code ${r.code}\n${detail.trim()}`);
    console.log(`workers.dev onboarding is not visible to Wrangler yet (retry ${attempt}/6)...`);
  }
  throw new Error(`Cloudflare still reports that workers.dev onboarding is incomplete. Re-open ${onboardingUrl||CURRENT_WORKERS_PAGES_URL} and confirm Your subdomain was registered, then rerun setup. D1/migrations are checkpointed and will not be recreated.`);
}

function randomHex(bytes=32){return crypto.randomBytes(bytes).toString('hex');}
function resolveWranglerCli(){
  const pkgPath=path.join(cloud,'node_modules','wrangler','package.json');
  if(!fs.existsSync(pkgPath))throw new Error(`Local Wrangler package was not installed: ${pkgPath}`);
  const pkg=JSON.parse(fs.readFileSync(pkgPath,'utf8'));
  const rel=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.wrangler;
  if(!rel)throw new Error('Wrangler package.json does not expose a wrangler CLI bin entry.');
  const cli=path.resolve(path.dirname(pkgPath),rel);
  if(!fs.existsSync(cli))throw new Error(`Wrangler CLI file does not exist: ${cli}`);
  console.log(`Resolved local Wrangler CLI: ${cli}`);
  return {cli,version:String(pkg.version||'0.0.0')};
}
function parseJson(text,label){
  const s=String(text||'').trim();
  try{return JSON.parse(s);}catch(e){throw new Error(`${label} did not return valid JSON.\n${s.slice(0,2000)}`);}
}
async function fetchJson(url,options={},label='request',retries=0){
  let last;
  for(let i=0;i<=retries;i++){
    try{
      const res=await fetch(url,options); const text=await res.text();
      if(!res.ok)throw new Error(`${label} returned HTTP ${res.status}: ${text.slice(0,1000)}`);
      return text?parseJson(text,label):null;
    }catch(e){last=e;if(i<retries)await sleep(1000);}
  }
  throw last;
}
function configText(databaseId,publicBase='',withCron=false){
  return `name = "${workerName}"\nmain = "src/worker.mjs"\ncompatibility_date = "2026-09-08"\nworkers_dev = true\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "${dbName}"\ndatabase_id = "${databaseId}"\n\n[vars]\nPUBLIC_BASE_URL = "${publicBase}"\n${withCron?'\n[triggers]\ncrons = ["* * * * *"]\n':''}`;
}


console.log('\n=== Eason Trading Cloud Monitor setup ===');
if(!fs.existsSync(cloud))throw new Error(`cloudflare folder not found: ${cloud}`);
const envMap=readEnvFile();
const fugleKey=String(envMap.FUGLE_API_KEY||'');
if(!fugleKey)throw new Error('FUGLE_API_KEY is missing from .env.local. Cloud monitor will not be deployed without the real market-data key.');
let cloudKey=String(envMap.CLOUD_MONITOR_API_KEY||'');
if(!cloudKey){cloudKey=randomHex(32);setEnvValue('CLOUD_MONITOR_API_KEY',cloudKey);console.log('Generated a separate Cloud Monitor API token.');}
let mcpToken=String(envMap.GPT_DIRECT_MCP_TOKEN||'');
if(!mcpToken){mcpToken=randomHex(32);setEnvValue('GPT_DIRECT_MCP_TOKEN',mcpToken);console.log('Generated a separate GPT Direct MCP bearer token.');}

const readinessOnly=process.argv.includes('--readiness-only');
let workerUrl='';
if(readinessOnly){
  const checkpoint=loadCheckpoint();
  workerUrl=String(envMap.CLOUD_MONITOR_URL||checkpoint.workerUrl||'').replace(/\/$/,'');
  if(!/^https:\/\/[A-Za-z0-9._-]+\.workers\.dev$/i.test(workerUrl))throw new Error('Readiness-only resume requires an existing workers.dev URL in .env.local or the cloud setup checkpoint.');
  console.log(`Resuming post-deploy readiness checks only: ${workerUrl}`);
}else{
const {cli,version}=resolveWranglerCli();
const runWrangler=createWranglerRunner({cli,cwd:cloud});
console.log(`Wrangler version: ${version}`);
console.log('Checking Cloudflare authentication...');
let who=runWrangler(['whoami','--json'],{capture:true,allowFailure:true});
if(who.code!==0){
  console.log('Cloudflare OAuth login is required once.');
  if(semverAtLeast(version,'4.119.0')){
    console.log('Attempting OAuth Device Authorization Grant...');
    runWrangler(['login','--device'],{label:'wrangler login --device'});
  }else{
    console.log(`Wrangler ${version} predates device OAuth; using the standard browser login flow.`);
    runWrangler(['login'],{label:'wrangler login'});
  }
  who=runWrangler(['whoami','--json'],{capture:true,allowFailure:true});
}
if(who.code!==0)throw new Error(`Cloudflare authentication did not complete successfully.\n${who.stderr||who.stdout}`);
const whoJson=parseJson(who.stdout,'wrangler whoami --json');
console.log(`Cloudflare authentication confirmed${whoJson?.email?` for ${whoJson.email}`:''}.`);

console.log('Resolving D1 database...');
let list=runWrangler(['d1','list','--json'],{capture:true,label:'wrangler d1 list --json'});
let dbs=parseJson(list.stdout,'wrangler d1 list --json');
if(!Array.isArray(dbs))throw new Error('wrangler d1 list --json did not return an array.');
let db=dbs.find(x=>x?.name===dbName);
if(!db){
  console.log(`Creating D1 database ${dbName}...`);
  runWrangler(['d1','create',dbName],{label:`wrangler d1 create ${dbName}`});
  list=runWrangler(['d1','list','--json'],{capture:true,label:'wrangler d1 list --json'});
  dbs=parseJson(list.stdout,'wrangler d1 list --json');
  db=Array.isArray(dbs)?dbs.find(x=>x?.name===dbName):null;
}
const databaseId=String(db?.uuid||db?.id||'');
if(!databaseId)throw new Error('D1 database id could not be resolved.');
const tomlPath=path.join(cloud,'wrangler.toml');

console.log('Applying monitor-only D1 schema...');
fs.writeFileSync(tomlPath,configText(databaseId,'',false),'utf8');
const migrationFingerprint=currentMigrationFingerprint();
const checkpoint=loadCheckpoint();
if(checkpoint.databaseId===databaseId&&checkpoint.migrationFingerprint===migrationFingerprint){
  console.log('D1 migrations already completed for this exact schema; resuming after the saved checkpoint.');
}else{
  const migrationRun=runWrangler(['d1','migrations','apply',dbName,'--remote'],{capture:true,label:'wrangler d1 migrations apply'});
  if(migrationRun.stdout)process.stdout.write(migrationRun.stdout+'\n');
  saveCheckpoint({databaseId,migrationFingerprint,migrationsApplied:true});
}

// Create the Worker before secret uploads. Secret put targets an existing Worker and may
// otherwise become interactive. The bootstrap config deliberately has no cron trigger yet.
// A brand-new Cloudflare account may require one-time workers.dev onboarding first; when
// Wrangler reports that condition, open the exact onboarding URL, wait, and retry here.
console.log('Creating/updating bootstrap Worker...');
let deploy=await deployBootstrapWithOnboarding(runWrangler);
process.stdout.write(deploy.stdout?deploy.stdout+'\n':'');
workerUrl=parseWorkerUrl(deploy.stdout+'\n'+deploy.stderr);
if(!workerUrl)throw new Error(`Worker deployed but workers.dev URL could not be read from Wrangler output. Do not guess the URL.\n${deploy.stdout}\n${deploy.stderr}`);
saveCheckpoint({databaseId,migrationFingerprint,bootstrapDeployed:true,workerUrl});

console.log('Uploading Worker secrets...');
for(const [name,value] of [['TRADING_API_KEY',cloudKey],['FUGLE_API_KEY',fugleKey],['MCP_BEARER_TOKEN',mcpToken]]){
  runWrangler(['secret','put',name],{capture:true,input:value+'\n',label:`wrangler secret put ${name}`});
  console.log(`Configured secret: ${name}`);
}

console.log('Deploying final Cloud Monitor + GPT Direct bridge...');
fs.writeFileSync(tomlPath,configText(databaseId,workerUrl,true),'utf8');
deploy=runWrangler(['deploy'],{capture:true,label:'wrangler deploy final'});
process.stdout.write(deploy.stdout?deploy.stdout+'\n':'');
const finalUrl=parseWorkerUrl(deploy.stdout+'\n'+deploy.stderr)||workerUrl;
if(finalUrl!==workerUrl){workerUrl=finalUrl;fs.writeFileSync(tomlPath,configText(databaseId,workerUrl,true),'utf8');}
saveCheckpoint({databaseId,migrationFingerprint,bootstrapDeployed:true,finalDeployed:true,workerUrl});
}

setEnvValue('CLOUD_MONITOR_URL',workerUrl);
setEnvValue('CLOUD_MONITOR_API_KEY',cloudKey);
setEnvValue('GPT_DIRECT_MCP_URL',workerUrl+'/mcp');
setEnvValue('GPT_DIRECT_MCP_TOKEN',mcpToken);
setEnvValue('GPT_DIRECT_ACTION_SCHEMA_URL',workerUrl+'/gpt-action-openapi.json');
setEnvValue('GPT_DIRECT_ACTION_INSTRUCTIONS_URL',workerUrl+'/gpt-action-instructions.txt');
setEnvValue('GPT_DIRECT_PRIVACY_URL',workerUrl+'/privacy');

async function waitForCloudReadiness(workerUrl,cloudKey,{attempts=40,intervalMs=1500}={}){
  let lastHealth=null,lastError=null;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      lastHealth=await fetchJson(workerUrl+'/health',{headers:{'x-api-key':cloudKey}},'Cloud health',0);
      const ready=lastHealth?.ok===true&&lastHealth?.monitorOnly===true&&lastHealth?.publicBaseConfigured===true&&lastHealth?.directGptBridge===true&&lastHealth?.mcpBearerConfigured===true;
      if(ready){
        if(attempt>1)console.log(`Cloud readiness confirmed after ${attempt} checks.`);
        return lastHealth;
      }
      lastError=null;
      console.log(`Cloud deployment is reachable but not fully propagated yet (check ${attempt}/${attempts}): publicBase=${!!lastHealth?.publicBaseConfigured}, directGpt=${!!lastHealth?.directGptBridge}, mcpBearer=${!!lastHealth?.mcpBearerConfigured}`);
    }catch(e){
      lastError=e;
      console.log(`Cloud deployment is not ready yet (check ${attempt}/${attempts}): ${String(e?.message||e).split('\n')[0]}`);
    }
    if(attempt<attempts)await sleep(intervalMs);
  }
  const detail=lastHealth?`Last health JSON: ${JSON.stringify(lastHealth)}`:`Last health error: ${String(lastError?.message||lastError||'unknown')}`;
  throw new Error(`Cloud health readiness timed out after ${attempts} checks. ${detail}`);
}

const health=await waitForCloudReadiness(workerUrl,cloudKey);
const mcpBody=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}});
const mcp=await fetchJson(workerUrl+'/mcp',{method:'POST',headers:{Authorization:`Bearer ${mcpToken}`,'MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/list','content-type':'application/json'},body:mcpBody},'GPT Direct MCP',3);
const toolNames=Array.isArray(mcp?.result?.tools)?mcp.result.tools.map(x=>x?.name):[];
if(!toolNames.includes('update_trading_strategy')||toolNames.includes('record_trade')||toolNames.includes('initialize_ledger'))throw new Error('GPT Direct MCP tool surface is not the expected strategy-only set.');
const actionReady=await fetchJson(workerUrl+'/v1/gpt-action/readiness',{headers:{Authorization:`Bearer ${mcpToken}`}},'GPT Action readiness',3);
const actionSchema=await fetchJson(workerUrl+'/gpt-action-openapi.json',{},'GPT Action OpenAPI',3);
if(actionReady?.ok!==true||actionSchema?.openapi!=='3.1.0'||!actionSchema?.paths?.['/v1/gpt-action/strategy'])throw new Error('GPT Action readiness/OpenAPI verification failed.');
saveCheckpoint({workerUrl,readinessVerified:true,readinessVerifiedAt:new Date().toISOString()});

console.log(`Cloud Monitor + GPT Direct bridge deployed: ${workerUrl}`);
console.log('GPT-facing write surface is strategy-only; cash/trades/holding quantities are not writable.');
if(Number(health.enabledDevices||0)<=0)console.log('Cloud is online, but no push-capable phone is registered yet. Pair/open the EAS app once while the PC is online, then run scripts\\test-cloud-push.ps1.');
else console.log(`Cloud push devices: ${health.enabledDevices}`);
if(Number(health.pendingPush||0)>0)console.log(`Pending unsent review pushes: ${health.pendingPush}`);

try{
  const latest=readEnvFile();
  const headers={}; if(latest.TRADING_API_KEY)headers['x-api-key']=latest.TRADING_API_KEY;
  const sync=await fetchJson('http://127.0.0.1:8787/v1/cloud-monitor/sync',{method:'POST',headers},'Local cloud sync',0);
  if(sync?.sync?.skipped===true||sync?.sync?.configured===false)console.log('Cloud settings were saved, but the already-running Backend has not reloaded .env.local. Restart Eason Trading once; startup sync will then arm Cloud Monitor.');
  else {console.log('Current armed triggers synced to Cloud Monitor.'); if(sync?.devices?.count!==undefined)console.log(`Registered phone records synced: ${sync.devices.count}`);}
}catch(e){
  console.log(`Local Backend cloud sync did not complete: ${String(e?.message||e).split('\n')[0]}`);
  console.log('The updater will restart the Backend after deployment so it reloads any Cloud settings/secrets written to .env.local, then it will retry the full sync.');
}
