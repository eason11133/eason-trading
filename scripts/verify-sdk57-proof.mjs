import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

function fail(message){console.error(`SDK57 verification proof rejected: ${message}`);process.exit(2)}
function arg(name){const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])fail(`missing ${name}`);return process.argv[i+1]}
function readJson(file,label){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''))}catch(e){fail(`${label} is not valid JSON: ${e.message}`)}}
function sha256(file){const h=crypto.createHash('sha256');h.update(fs.readFileSync(file));return h.digest('hex')}
function safeExisting(file,label){const x=path.resolve(file);if(!fs.existsSync(x)||!fs.statSync(x).isFile())fail(`${label} does not exist: ${x}`);return x}

const manifestFile=safeExisting(arg('--manifest'),'manifest');
const lockFile=safeExisting(arg('--lock'),'package-lock');
const packageFile=safeExisting(arg('--package'),'normalized mobile package');
const sourceSha=String(arg('--source-sha')).toLowerCase();
if(!/^[a-f0-9]{64}$/.test(sourceSha))fail('source SHA256 is malformed');

const manifest=readJson(manifestFile,'manifest');
const lock=readJson(lockFile,'package-lock');
const pkg=readJson(packageFile,'normalized mobile package');
if(manifest.status!=='PASS')fail(`manifest status is ${manifest.status||'missing'}`);
if(Number(manifest.proofVersion)!==1)fail(`unsupported proofVersion ${manifest.proofVersion??'missing'}`);
if(String(manifest.sourceZipSha256||'').toLowerCase()!==sourceSha)fail('manifest source SHA256 does not match this installer ZIP');
if(manifest.activeInstallModified!==false)fail('preflight manifest does not prove the active install stayed untouched');
if(!['workspace-root','mobile'].includes(manifest.lockScope))fail(`unexpected lockScope ${manifest.lockScope||'missing'}`);

const lockHash=sha256(lockFile), packageHash=sha256(packageFile);
if(lockHash!==String(manifest.packageLockSha256||'').toLowerCase())fail('package-lock SHA256 does not match manifest');
if(packageHash!==String(manifest.packageJsonSha256||'').toLowerCase())fail('normalized mobile package SHA256 does not match manifest');
if(pkg.name!=='eason-trading-mobile'||pkg.version!=='0.3.16')fail(`normalized mobile package identity is ${pkg.name||'missing'}@${pkg.version||'missing'}`);
if(Number(lock.lockfileVersion)<3||!lock.packages)fail('npm package-lock v3+ with packages map is required');

const version=name=>lock.packages?.[`node_modules/${name}`]?.version||null;
const resolved={expo:version('expo'),react:version('react'),reactNative:version('react-native'),localBuildCacheProvider:version('@expo/local-build-cache-provider')};
if(!/^57\./.test(resolved.expo||''))fail(`expo resolved ${resolved.expo||'missing'}, expected SDK 57.x`);
if(resolved.react!=='19.2.3')fail(`react resolved ${resolved.react||'missing'}, expected 19.2.3`);
if(resolved.reactNative!=='0.86.3')fail(`react-native resolved ${resolved.reactNative||'missing'}, expected 0.86.3`);
if(!resolved.localBuildCacheProvider)fail('@expo/local-build-cache-provider is missing from the locked SDK57 graph');
const mv=manifest.verifiedVersions||{};
if(mv.expo!==resolved.expo||mv.react!==resolved.react||mv.reactNative!==resolved.reactNative||mv.localBuildCacheProvider!==resolved.localBuildCacheProvider)fail('manifest verifiedVersions do not match the exact locked SDK57 graph');

const rootPkg=lock.packages['']||{};
const mobilePkg=lock.packages['mobile']||lock.packages['node_modules/eason-trading-mobile']||{};
if(manifest.lockScope==='workspace-root'){
  const workspaces=rootPkg.workspaces||[];
  if(!Array.isArray(workspaces)||!workspaces.includes('mobile'))fail('workspace-root lock does not include the mobile workspace');
  if(mobilePkg.version && mobilePkg.version!=='0.3.16')fail(`workspace mobile version is ${mobilePkg.version}, expected 0.3.16`);
}

console.log(JSON.stringify({ok:true,proofVersion:1,lockScope:manifest.lockScope,sourceZipSha256:sourceSha,packageLockSha256:lockHash,packageJsonSha256:packageHash,verifiedVersions:mv}));
