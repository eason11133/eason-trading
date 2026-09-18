import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const srcRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eason-cloud-setup-sim-'));
try{
  fs.mkdirSync(path.join(tmp,'scripts'),{recursive:true});
  fs.mkdirSync(path.join(tmp,'cloudflare','node_modules','wrangler','bin'),{recursive:true});
  fs.mkdirSync(path.join(tmp,'cloudflare','migrations'),{recursive:true});
  fs.mkdirSync(path.join(tmp,'cloudflare','src'),{recursive:true});
  for(const name of ['setup-cloud-monitor.mjs','cloudflare-setup-core.mjs'])fs.copyFileSync(path.join(srcRoot,'scripts',name),path.join(tmp,'scripts',name));
  for(const name of ['0001_init.sql','0002_push_delivery.sql','0003_gpt_direct_bridge.sql'])fs.copyFileSync(path.join(srcRoot,'cloudflare','migrations',name),path.join(tmp,'cloudflare','migrations',name));
  fs.copyFileSync(path.join(srcRoot,'cloudflare','src','worker.mjs'),path.join(tmp,'cloudflare','src','worker.mjs'));
  fs.writeFileSync(path.join(tmp,'.env.local'),'FUGLE_API_KEY=fugle-test-secret\nTRADING_API_KEY=local-api-key\n');
  fs.writeFileSync(path.join(tmp,'cloudflare','node_modules','wrangler','package.json'),JSON.stringify({version:'4.119.0',bin:{wrangler:'bin/wrangler.js'}}));
  const fakeCli=`import fs from 'node:fs';import path from 'node:path';\nconst root=path.resolve(process.cwd(),'..'),state=path.join(root,'fake-state.json'),log=path.join(root,'fake-wrangler.log');\nlet s={};try{s=JSON.parse(fs.readFileSync(state,'utf8'))}catch{};const a=process.argv.slice(2);fs.appendFileSync(log,JSON.stringify(a)+'\\n');\nconst save=()=>fs.writeFileSync(state,JSON.stringify(s));\nif(a.join(' ')==='whoami --json'){if(!s.auth){console.error('Not logged in');process.exit(1)}console.log(JSON.stringify({email:'eason@example.com'}));process.exit(0)}\nif(a.join(' ')==='login --device'){s.auth=true;save();console.log('Successfully logged in');process.exit(0)}\nif(a.join(' ')==='d1 list --json'){console.log(JSON.stringify(s.db?[{name:'eason-trading-monitor',uuid:'db-123'}]:[]));process.exit(0)}\nif(a.join(' ')==='d1 create eason-trading-monitor'){s.db=true;save();console.log('Created D1');process.exit(0)}\nif(a.join(' ')==='d1 migrations apply eason-trading-monitor --remote'){console.log('Migrations applied');process.exit(0)}\nif(a.join(' ')==='deploy'){if(!s.workersReady){s.workersReady=true;save();console.error('You need to register a workers.dev subdomain before publishing to workers.dev\\nhttps://dash.cloudflare.com/acct-123/workers/onboarding');process.exit(1)}console.log('Uploaded Worker\\nhttps://eason-trading-monitor.fake.workers.dev');process.exit(0)}\nif(a[0]==='secret'&&a[1]==='put'){let d='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>d+=x);process.stdin.on('end',()=>{fs.appendFileSync(path.join(root,'fake-secret.log'),a[2]+':'+d.trim().length+'\\n');console.log('secret ok')});process.stdin.resume();}else{console.error('unexpected argv '+JSON.stringify(a));process.exit(2)}\n`;
  fs.writeFileSync(path.join(tmp,'cloudflare','node_modules','wrangler','bin','wrangler.js'),fakeCli);
  const mockFetch=`let healthChecks=0;globalThis.fetch=async (url,opts={})=>{const u=String(url);let body,status=200;if(u.endsWith('/health')){healthChecks++;body=healthChecks<=2?{ok:true,monitorOnly:true,publicBaseConfigured:false,directGptBridge:true,mcpBearerConfigured:true,enabledDevices:0,pendingPush:0}:{ok:true,monitorOnly:true,publicBaseConfigured:true,directGptBridge:true,mcpBearerConfigured:true,enabledDevices:0,pendingPush:0};}else if(u.endsWith('/mcp'))body={jsonrpc:'2.0',id:1,result:{tools:[{name:'get_trading_state'},{name:'update_trading_strategy'}]}};else if(u.endsWith('/v1/gpt-action/readiness'))body={ok:true,connected:false,appOnline:false,pendingCommands:0};else if(u.endsWith('/gpt-action-openapi.json'))body={openapi:'3.1.0',paths:{'/v1/gpt-action/strategy':{post:{}}}};else if(u==='http://127.0.0.1:8787/v1/cloud-monitor/sync')body={sync:{configured:true,skipped:false},devices:{count:0}};else{status=404;body={error:'unknown '+u}};return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})};`;
  const mockPath=path.join(tmp,'mock-fetch.mjs');fs.writeFileSync(mockPath,mockFetch);
  // Node's --import flag accepts module specifiers. On Windows, a raw C:\\... absolute
  // path is parsed as the unsupported `c:` URL scheme, so always pass a file:// URL.
  const mockImportUrl=pathToFileURL(mockPath).href;
  const setupScript=path.join(tmp,'scripts','setup-cloud-monitor.mjs');
  const simEnv={...process.env,EASON_CLOUD_SETUP_ONBOARDING_AUTO_CONTINUE:'1'};
  const r=spawnSync(process.execPath,['--import',mockImportUrl,setupScript],{cwd:tmp,env:simEnv,encoding:'utf8',maxBuffer:4*1024*1024});
  if(r.status!==0)throw new Error(`full cloud setup simulation failed\nSTDOUT:\n${r.stdout}\nSTDERR:\n${r.stderr}`);
  const calls=fs.readFileSync(path.join(tmp,'fake-wrangler.log'),'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const joined=calls.map(a=>a.join(' '));
  const expected=['whoami --json','login --device','whoami --json','d1 list --json','d1 create eason-trading-monitor','d1 list --json','d1 migrations apply eason-trading-monitor --remote','deploy','deploy','secret put TRADING_API_KEY','secret put FUGLE_API_KEY','secret put MCP_BEARER_TOKEN','deploy'];
  assert.deepEqual(joined,expected);
  const secretLog=fs.readFileSync(path.join(tmp,'fake-secret.log'),'utf8');
  assert.match(secretLog,/TRADING_API_KEY:64/);assert.match(secretLog,/FUGLE_API_KEY:17/);assert.match(secretLog,/MCP_BEARER_TOKEN:64/);
  const toml=fs.readFileSync(path.join(tmp,'cloudflare','wrangler.toml'),'utf8');
  assert.match(toml,/PUBLIC_BASE_URL = "https:\/\/eason-trading-monitor\.fake\.workers\.dev"/);assert.match(toml,/crons = \["\* \* \* \* \*"\]/);
  const env=fs.readFileSync(path.join(tmp,'.env.local'),'utf8');
  assert.match(env,/CLOUD_MONITOR_URL=https:\/\/eason-trading-monitor\.fake\.workers\.dev/);assert.match(env,/GPT_DIRECT_ACTION_SCHEMA_URL=https:\/\/eason-trading-monitor\.fake\.workers\.dev\/gpt-action-openapi\.json/);
  assert.ok(!r.stdout.includes('fugle-test-secret'),'setup stdout must not leak FUGLE secret');
  const m=env.match(/^GPT_DIRECT_MCP_TOKEN=(.+)$/m);assert.ok(m);assert.ok(!r.stdout.includes(m[1]),'setup stdout must not leak GPT bearer token');
  assert.match(r.stdout,/workers\.dev account subdomain/i);assert.match(r.stdout,/Simulation mode: continuing after workers\.dev onboarding checkpoint/);
  assert.match(r.stdout,/Cloud deployment is reachable but not fully propagated yet/);
  assert.match(r.stdout,/Cloud readiness confirmed after 3 checks/);
  const checkpoint=JSON.parse(fs.readFileSync(path.join(tmp,'.eason-cloud-setup-state.json'),'utf8'));
  assert.equal(checkpoint.databaseId,'db-123');assert.equal(checkpoint.migrationsApplied,true);assert.equal(checkpoint.finalDeployed,true);

  // A second setup run must reuse the same D1 and exact migration checkpoint. This proves
  // a workers.dev interruption can resume without recreating the database or reapplying schema.
  fs.writeFileSync(path.join(tmp,'fake-wrangler.log'),'');
  const r2=spawnSync(process.execPath,['--import',mockImportUrl,setupScript],{cwd:tmp,env:simEnv,encoding:'utf8',maxBuffer:4*1024*1024});
  if(r2.status!==0)throw new Error(`resumed cloud setup simulation failed\nSTDOUT:\n${r2.stdout}\nSTDERR:\n${r2.stderr}`);
  const calls2=fs.readFileSync(path.join(tmp,'fake-wrangler.log'),'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).map(a=>a.join(' '));
  assert.ok(!calls2.includes('d1 create eason-trading-monitor'),'resume must not recreate D1');
  assert.ok(!calls2.includes('d1 migrations apply eason-trading-monitor --remote'),'resume must skip unchanged migrations');
  assert.match(r2.stdout,/D1 migrations already completed for this exact schema/);

  // A readiness-only resume represents the exact state after a successful final deploy whose
  // immediate health check observed the prior bootstrap version. It must not call Wrangler at all.
  fs.writeFileSync(path.join(tmp,'fake-wrangler.log'),'');
  const r3=spawnSync(process.execPath,['--import',mockImportUrl,setupScript,'--readiness-only'],{cwd:tmp,env:simEnv,encoding:'utf8',maxBuffer:4*1024*1024});
  if(r3.status!==0)throw new Error(`readiness-only cloud setup simulation failed\nSTDOUT:\n${r3.stdout}\nSTDERR:\n${r3.stderr}`);
  const calls3=fs.readFileSync(path.join(tmp,'fake-wrangler.log'),'utf8').trim();
  assert.equal(calls3,'','readiness-only resume must not call Wrangler or redeploy Cloud resources');
  assert.match(r3.stdout,/Resuming post-deploy readiness checks only/);
  assert.match(r3.stdout,/Cloud readiness confirmed after 3 checks/);
  const checkpoint3=JSON.parse(fs.readFileSync(path.join(tmp,'.eason-cloud-setup-state.json'),'utf8'));
  assert.equal(checkpoint3.readinessVerified,true);
  console.log(`Cloud setup full simulation passed (${calls.length} first-run Wrangler calls; workers.dev onboarding + checkpointed/full + readiness-only resume verified).`);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
