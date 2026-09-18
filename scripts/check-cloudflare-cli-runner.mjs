import assert from 'node:assert/strict';
import {createWranglerRunner,semverAtLeast,parseWorkerUrl,parseWorkersDevOnboardingUrl,needsWorkersDevOnboarding,openExternalUrl,CURRENT_WORKERS_PAGES_URL} from './cloudflare-setup-core.mjs';

const calls=[];
function fakeSpawn(node,args,opts){
  calls.push({node,args:[...args],opts:{cwd:opts.cwd,stdio:opts.stdio,input:opts.input}});
  const cmd=args.slice(1).join(' ');
  if(cmd==='whoami --json' && calls.filter(x=>x.args.slice(1).join(' ')==='login --device').length===0)return {status:1,stdout:'',stderr:'Not logged in'};
  if(cmd==='whoami --json')return {status:0,stdout:'{"email":"eason@example.com"}',stderr:''};
  if(cmd==='login --device')return {status:0,stdout:'Successfully logged in',stderr:''};
  if(cmd==='d1 list --json' && calls.filter(x=>x.args.slice(1,4).join(' ')==='d1 create eason-trading-monitor').length===0)return {status:0,stdout:'[]',stderr:''};
  if(cmd==='d1 create eason-trading-monitor')return {status:0,stdout:'created',stderr:''};
  if(cmd==='d1 list --json')return {status:0,stdout:'[{"name":"eason-trading-monitor","uuid":"db-123"}]',stderr:''};
  if(cmd==='d1 migrations apply eason-trading-monitor --remote')return {status:0,stdout:'applied',stderr:''};
  if(cmd==='deploy')return {status:0,stdout:'Uploaded\nhttps://eason-trading-monitor.example.workers.dev',stderr:''};
  if(cmd.startsWith('secret put '))return {status:0,stdout:'secret ok',stderr:''};
  return {status:2,stdout:'',stderr:`unexpected: ${cmd}`};
}
const run=createWranglerRunner({cli:'/fake/wrangler.js',cwd:'/fake/cloud',spawn:fakeSpawn,node:'/fake/node'});
let who=run(['whoami','--json'],{capture:true,allowFailure:true});
assert.equal(who.code,1);
run(['login','--device']);
who=run(['whoami','--json'],{capture:true});
assert.equal(JSON.parse(who.stdout).email,'eason@example.com');
let db=JSON.parse(run(['d1','list','--json'],{capture:true}).stdout);
assert.equal(db.length,0);
run(['d1','create','eason-trading-monitor']);
db=JSON.parse(run(['d1','list','--json'],{capture:true}).stdout);
assert.equal(db[0].uuid,'db-123');
run(['d1','migrations','apply','eason-trading-monitor','--remote']);
const deployed=run(['deploy'],{capture:true});
assert.equal(parseWorkerUrl(deployed.stdout),'https://eason-trading-monitor.example.workers.dev');
for(const name of ['TRADING_API_KEY','FUGLE_API_KEY','MCP_BEARER_TOKEN'])run(['secret','put',name],{capture:true,input:'secret-value\n'});
assert.ok(calls.every(c=>c.args[0]==='/fake/wrangler.js'),'Wrangler CLI must always be argv[0] after node.exe');
assert.ok(calls.some(c=>c.args.slice(1).join(' ')==='login --device'),'device login argv must be preserved');
for(const c of calls.filter(c=>c.args[1]==='secret'))assert.equal(c.opts.input,'secret-value\n');
assert.equal(semverAtLeast('4.119.0','4.119.0'),true);
assert.equal(semverAtLeast('4.118.9','4.119.0'),false);
const onboardingSample=`You need to register a workers.dev subdomain before publishing to workers.dev
https://dash.cloudflare.com/15466ba1738f363c1a0fde33032a6929/workers/onboarding`;
assert.equal(needsWorkersDevOnboarding(onboardingSample),true);
assert.equal(parseWorkersDevOnboardingUrl(onboardingSample),CURRENT_WORKERS_PAGES_URL);
const openCalls=[];
const fakeOpenSpawn=(cmd,args,opts)=>{openCalls.push({cmd,args,opts});return {unref(){}};};
assert.equal(openExternalUrl(CURRENT_WORKERS_PAGES_URL,{spawn:fakeOpenSpawn,platform:'win32'}),true);
assert.equal(openCalls[0].cmd,'cmd.exe');assert.deepEqual(openCalls[0].args.slice(0,5),['/d','/s','/c','start','']);
assert.equal(openCalls[0].args[5],CURRENT_WORKERS_PAGES_URL);
console.log(`Cloudflare CLI runner contract passed (${calls.length} fake Wrangler invocations).`);
