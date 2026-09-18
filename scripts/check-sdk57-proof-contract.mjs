import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const proof=fs.readFileSync(path.join(root,'scripts','verify-sdk57-proof.mjs'),'utf8');
for(const x of ['proofVersion','sourceZipSha256','packageLockSha256','packageJsonSha256','workspace-root','SDK 57.x','19.2.3','0.86.3','localBuildCacheProvider'])if(!proof.includes(x))throw new Error(`SDK57 proof verifier missing ${x}`);
if(proof.includes("expo:'57.0.21'")||proof.includes("'@expo/local-build-cache-provider':'57.0.8'"))throw new Error('SDK57 proof verifier must not hard-pin a patch-level Expo/transitive dependency version');
const pre=fs.readFileSync(path.join(root,'release','Test-eason-trading-v0.3.16-SDK57.ps1.template'),'utf8');
for(const x of ['proofVersion=1','npm=(npm -v)','verified-package-lock.json','verification-manifest.json'])if(!pre.includes(x))throw new Error(`SDK57 preflight proof producer missing ${x}`);

const carry=fs.readFileSync(path.join(root,'scripts','rebind-sdk57-proof.mjs'),'utf8');
for(const x of ['allowedChanged','runtime-critical','sourceZipSha256','packageLockSha256','activeInstallModified','FIX6 -> FIX7'])if(!carry.includes(x))throw new Error(`SDK57 proof carry-forward helper missing ${x}`);
if(!carry.includes("'mobile/package.json'")||!carry.includes("'mobile/app.json'")||!carry.includes("'scripts/verify-install-runtime.mjs'"))throw new Error('SDK57 proof carry-forward must explicitly lock runtime-critical mobile/preflight inputs');

console.log('SDK57 proof contract passed: preflight emits a versioned, hash-bound dependency proof and production installer has a verifier/carry-forward guard for release-tool-only fixes.');
