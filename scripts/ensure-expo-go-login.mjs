import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolveMobileTooling} from './mobile-tooling.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mobile=path.join(root,'mobile');
const {expoCli}=resolveMobileTooling(root);
function run(args,{inherit=false}={}){
 const r=spawnSync(process.execPath,[expoCli,...args],{cwd:mobile,env:{...process.env,EXPO_NO_TELEMETRY:'1'},encoding:inherit?undefined:'utf8',stdio:inherit?'inherit':['ignore','pipe','pipe'],windowsHide:true});
 if(r.error)throw r.error;
 return r;
}
let who=run(['whoami']);
if(who.status===0){
 const name=String(who.stdout||'').trim();
 console.log(`Expo account login confirmed${name?`: ${name}`:''}. Use the same Expo account in Expo Go.`);
 process.exit(0);
}
console.log('Expo Go SDK 57 may require the Expo CLI and phone to use the same Expo account. Starting one-time Expo login...');
const login=run(['login'],{inherit:true});
if(login.status!==0)throw new Error(`Expo login failed with exit code ${login.status}`);
who=run(['whoami']);
if(who.status!==0)throw new Error('Expo login finished but Expo CLI still does not report an authenticated account.');
console.log(`Expo account login confirmed: ${String(who.stdout||'').trim()}. Sign into the same account in Expo Go, then scan the QR code.`);
