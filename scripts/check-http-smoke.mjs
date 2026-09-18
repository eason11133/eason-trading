import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const port=19000+Math.floor(Math.random()*2000);
const dir=mkdtempSync(join(tmpdir(),'eason-http-smoke-'));
const dbFile=join(dir,'state.json');
const key='k'.repeat(64);
let logs='';
const child=spawn(process.execPath,['src/server.mjs'],{cwd:join(root,'server'),env:{...process.env,PORT:String(port),TRADING_TEST_SEED:'1',TRADING_DB_FILE:dbFile,TRADING_API_KEY:key,FUGLE_API_KEY:''},stdio:['ignore','pipe','pipe']});
child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
const base=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(){for(let i=0;i<80;i++){try{const r=await fetch(`${base}/health`);if(r.status===401)return;}catch{}await sleep(100);}throw new Error(`Backend did not become reachable.\n${logs.slice(-3000)}`);}
async function json(r){let x={};try{x=await r.json()}catch{}return x;}
try{
 await wait();
 let r=await fetch(`${base}/health`);if(r.status!==401)throw new Error(`Unauthenticated health expected 401, got ${r.status}`);
 r=await fetch(`${base}/health`,{headers:{'x-api-key':key}});if(!r.ok)throw new Error(`Authenticated health failed: ${r.status}`);const health=await json(r);if(health.ok!==true)throw new Error('Authenticated health did not report ok');
 r=await fetch(`${base}/v1/pairing/start`,{method:'POST',headers:{'x-api-key':key,'content-type':'application/json'},body:'{}'});if(r.status!==201)throw new Error(`Pairing start failed: ${r.status}`);const pair=await json(r);if(!/^\d{6}$/.test(String(pair.code||'')))throw new Error('Pairing code was not 6 digits');
 r=await fetch(`${base}/v1/pairing/claim`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pair.code})});if(!r.ok)throw new Error(`Pairing claim failed: ${r.status}`);const claim=await json(r);if(claim.apiKey!==key)throw new Error('Pairing claim did not return configured local API token');
 r=await fetch(`${base}/v1/pairing/claim`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:pair.code})});if(r.status!==400)throw new Error(`Reused pairing code expected 400, got ${r.status}`);
 console.log('HTTP smoke passed: fail-closed health + one-time pairing route.');
} finally {
 child.kill();
 await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(1000)]);
 try{child.kill('SIGKILL')}catch{}
 rmSync(dir,{recursive:true,force:true});
}
