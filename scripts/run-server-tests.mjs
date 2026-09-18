import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const server=path.join(root,'server');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'eason-server-tests-'));
const files=fs.readdirSync(path.join(server,'src')).filter(x=>x.endsWith('.test.mjs')).sort();
let total=0;
function tapCount(text){const m=[...text.matchAll(/^# tests (\d+)$/gm)];return m.reduce((n,x)=>n+Number(x[1]),0)}
try{
  for(const file of files){
    const db=path.join(temp,'state.json');
    fs.rmSync(db,{force:true});fs.rmSync(`${db}.bak`,{force:true});
    const env={...process.env,TRADING_TEST_SEED:'1',FUGLE_API_KEY:'',TRADING_DB_FILE:db};
    const r=spawnSync(process.execPath,['--test','--test-concurrency=1',path.join(server,'src',file)],{cwd:server,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024});
    if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);
    if(r.error)throw r.error;
    if(r.status!==0)throw new Error(`${file} failed with exit code ${r.status}`);
    total+=tapCount(r.stdout||'');
  }
  console.log(`Server test runner passed ${total}/${total} using isolated temporary state.`);
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
