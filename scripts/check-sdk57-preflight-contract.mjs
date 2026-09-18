import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const p=path.join(root,'release','Test-eason-trading-v0.3.16-SDK57.ps1.template');
const s=fs.readFileSync(p,'utf8');
const required=[
  '__ZIP_SHA256__','__SOURCE_ZIP_GLOB__','__SOURCE_LABEL__',
  'eason-trading-current.txt',
  '--registry=https://registry.npmjs.org/','--prefer-online','--fetch-retries=3',
  'Invoke-Sdk57NpmInstall','npm install --registry=https://registry.npmjs.org/','SDK57 npm install failed after one clean-cache retry.',
  'run-expo.mjs install --fix --npm','verify-install-runtime.mjs --typecheck-only',
  'workspace-root','package-lock.json','verified-package-lock.json','verification-manifest.json','proofVersion=1','npm=(npm -v)','localBuildCacheProvider','read-sdk57-lock-versions.mjs',
  'Active install was not modified.'
];
for(const token of required)if(!s.includes(token))throw new Error(`SDK57 preflight template missing ${token}`);
for(const forbidden of ['WIP4*.zip','WIP5*.zip','--prefer-offline','server\\data\\state.json','.env.local','setup-cloud-monitor','$args=@(','& npm @args'])if(s.includes(forbidden))throw new Error(`SDK57 isolated preflight contains forbidden hard-code/mutation path: ${forbidden}`);
if(/\bnode(?:\.exe)?\s+-e\b/i.test(s))throw new Error('SDK57 preflight must not embed inline node -e scripts inside PowerShell; use argument-safe .mjs helpers');
const render=fs.readFileSync(path.join(root,'scripts','render-sdk57-preflight.mjs'),'utf8');
for(const token of ['__ZIP_SHA256__','__SOURCE_ZIP_GLOB__','__SOURCE_LABEL__','sha256','Unexpected SDK57 source ZIP name'])if(!render.includes(token))throw new Error(`SDK57 preflight renderer missing ${token}`);
console.log('SDK57 isolated preflight contract passed: exact-WIP renderer + clean-cache retry + verified lock capture; no active pointer, ledger, Cloud or secret mutation path.');
