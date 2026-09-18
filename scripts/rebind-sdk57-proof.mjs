import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function fail(message){console.error(`SDK57 proof carry-forward rejected: ${message}`);process.exit(2)}
function arg(name){const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])fail(`missing ${name}`);return process.argv[i+1]}
function readJson(file,label){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''))}catch(e){fail(`${label} is not valid JSON: ${e.message}`)}}
function shaFile(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}
function norm(rel){return rel.replaceAll('\\','/')}

const oldRoot=path.resolve(arg('--old-root'));
const newRoot=path.resolve(arg('--new-root'));
const manifestFile=path.resolve(arg('--manifest'));
const lockFile=path.resolve(arg('--lock'));
const packageFile=path.resolve(arg('--package'));
const oldSha=arg('--old-sha').toLowerCase();
const newSha=arg('--new-sha').toLowerCase();
for(const [label,value] of [['old SHA',oldSha],['new SHA',newSha]])if(!/^[a-f0-9]{64}$/.test(value))fail(`${label} is malformed`);
for(const [label,p] of [['old source root',oldRoot],['new source root',newRoot],['manifest',manifestFile],['package-lock',lockFile],['normalized package',packageFile]])if(!fs.existsSync(p))fail(`${label} is missing: ${p}`);

const allowedChanged=new Set([
  'RELEASE_STATUS.md',
  'release/Install-eason-trading-v0.3.16.ps1.template',
  'release/Test-eason-trading-v0.3.16-SDK57.ps1.template',
  'scripts/check-installer-contract.mjs',
  'scripts/check-release-shell-interop.mjs',
  'scripts/check-sdk57-preflight-contract.mjs',
  'scripts/check-sdk57-proof-contract.mjs',
  'scripts/preserve-upgrade-assets.mjs',
  'scripts/read-sdk57-lock-versions.mjs',
  'scripts/rebind-sdk57-proof.mjs',
  'scripts/render-sdk57-preflight.mjs',
  'scripts/verify-release.mjs'
]);

function tree(root){
  const out=new Map();
  function walk(dir){
    for(const e of fs.readdirSync(dir,{withFileTypes:true})){
      const p=path.join(dir,e.name);const rel=norm(path.relative(root,p));
      if(e.isDirectory())walk(p);else if(e.isFile())out.set(rel,shaFile(p));else fail(`unexpected non-file entry in source tree: ${rel}`);
    }
  }
  walk(root);return out;
}
const oldTree=tree(oldRoot),newTree=tree(newRoot);
const all=new Set([...oldTree.keys(),...newTree.keys()]);
const unexpected=[];const allowed=[];
for(const rel of [...all].sort()){
  const a=oldTree.get(rel)||null,b=newTree.get(rel)||null;
  if(a===b)continue;
  if(allowedChanged.has(rel))allowed.push(rel);else unexpected.push(rel);
}
if(unexpected.length)fail(`runtime/source files changed outside the FIX7 release-tooling allowlist: ${unexpected.join(', ')}`);
for(const mustSame of ['package.json','mobile/package.json','mobile/app.json','mobile/tsconfig.json','mobile/App.tsx','scripts/verify-install-runtime.mjs','scripts/mobile-tooling.mjs','scripts/run-expo.mjs']){
  if(!oldTree.has(mustSame)||oldTree.get(mustSame)!==newTree.get(mustSame))fail(`SDK57 runtime-critical file is not byte-identical to FIX6: ${mustSame}`);
}

const manifest=readJson(manifestFile,'manifest');
if(manifest.status!=='PASS'||Number(manifest.proofVersion)!==1)fail('existing manifest is not a PASS proofVersion=1 artifact');
if(String(manifest.sourceZipSha256||'').toLowerCase()!==oldSha)fail('existing manifest is not bound to the expected FIX6 source SHA');
if(shaFile(lockFile)!==String(manifest.packageLockSha256||'').toLowerCase())fail('existing package-lock hash no longer matches manifest');
if(shaFile(packageFile)!==String(manifest.packageJsonSha256||'').toLowerCase())fail('existing normalized package hash no longer matches manifest');
if(manifest.activeInstallModified!==false)fail('existing preflight did not prove that active install stayed untouched');

const rebound={...manifest,
  sourceLabel:'v0.3.16 production FIX7 proof carry-forward',
  sourceZipSha256:newSha,
  proofCarryForward:{
    fromSourceZipSha256:oldSha,
    carriedAt:new Date().toISOString(),
    reason:'FIX6 -> FIX7 changes are limited to release-tooling allowlist; all runtime/dependency/mobile files are byte-identical.',
    allowedChangedFiles:allowed
  }
};
fs.writeFileSync(manifestFile,JSON.stringify(rebound,null,2)+'\n');
console.log(JSON.stringify({ok:true,from:oldSha,to:newSha,allowedChangedFiles:allowed,runtimeCriticalFilesIdentical:true}));
