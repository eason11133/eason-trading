import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'eason-sdk57-proof-regression-'));
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
try{
  const pkg=path.join(temp,'package.json');
  const lock=path.join(temp,'package-lock.json');
  const manifest=path.join(temp,'manifest.json');
  fs.writeFileSync(pkg,JSON.stringify({name:'eason-trading-mobile',version:'0.3.16',dependencies:{expo:'~57.0.22','expo-notifications':'~57.0.17'}},null,2));
  const lockJson={lockfileVersion:3,packages:{'':{workspaces:['mobile']},'mobile':{name:'eason-trading-mobile',version:'0.3.16'},'node_modules/expo':{version:'57.0.22'},'node_modules/react':{version:'19.2.3'},'node_modules/react-native':{version:'0.86.3'},'node_modules/@expo/local-build-cache-provider':{version:'57.0.9'}}};
  fs.writeFileSync(lock,JSON.stringify(lockJson,null,2));
  const sourceSha='a'.repeat(64);
  const m={proofVersion:1,status:'PASS',sourceZipSha256:sourceSha,activeInstallModified:false,lockScope:'workspace-root',packageJsonSha256:sha(pkg),packageLockSha256:sha(lock),verifiedVersions:{expo:'57.0.22',react:'19.2.3',reactNative:'0.86.3',localBuildCacheProvider:'57.0.9'}};
  fs.writeFileSync(manifest,JSON.stringify(m,null,2));
  const r=spawnSync(process.execPath,[path.join(root,'scripts','verify-sdk57-proof.mjs'),'--manifest',manifest,'--lock',lock,'--package',pkg,'--source-sha',sourceSha],{encoding:'utf8'});
  if(r.status!==0)throw new Error(`SDK57 proof rejected valid patch-level drift:\n${r.stdout}\n${r.stderr}`);
  if(!r.stdout.includes('"ok":true'))throw new Error('SDK57 patch regression did not produce a successful proof result');
  console.log('SDK57 patch regression passed: proof accepts Expo 57.0.22 and changed Expo transitive patch while preserving the exact lock/hash boundary.');
} finally {fs.rmSync(temp,{recursive:true,force:true});}
