import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const nodeVersion=process.versions.node;
const [major,minor]=nodeVersion.split('.').map(Number);
if(major<22||(major===22&&minor<13))throw new Error(`Node.js 22.13+ is required. Found ${nodeVersion}`);

const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const target=String(pkg.version||'');
if(!/^0\.3\.\d+$/.test(target))throw new Error(`Unexpected package version: ${target||'missing'}`);
for(const rel of ['server/package.json','mobile/package.json','mcp/package.json','cloudflare/package.json']){
 const x=JSON.parse(fs.readFileSync(path.join(root,rel),'utf8'));
 if(x.version!==target)throw new Error(`Version mismatch: ${rel}=${x.version}, expected ${target}`);
}
const mobilePkg=JSON.parse(fs.readFileSync(path.join(root,'mobile','package.json'),'utf8'));
const sdk57={expo:'~57.0.22',react:'19.2.3','react-native':'0.86.3','react-dom':'19.2.3','react-native-web':'~0.21.0','react-native-safe-area-context':'~5.7.0','expo-notifications':'~57.0.18','expo-constants':'~57.0.17','expo-clipboard':'~57.0.1','expo-secure-store':'~57.0.3','expo-build-properties':'~57.0.17','react-native-svg':'15.15.4'};
for(const [name,expected] of Object.entries(sdk57))if(mobilePkg?.dependencies?.[name]!==expected)throw new Error(`SDK57 source dependency mismatch: ${name}=${mobilePkg?.dependencies?.[name]||'missing'}, expected ${expected}`);
if(mobilePkg?.devDependencies?.['expo-doctor']!=='1.20.4')throw new Error('SDK57 source must pin expo-doctor 1.20.4');
if(mobilePkg?.devDependencies?.typescript!=='~6.0.3')throw new Error(`SDK57 source must pin TypeScript ~6.0.3, found ${mobilePkg?.devDependencies?.typescript||'missing'}`);
const mobileTsconfig=JSON.parse(fs.readFileSync(path.join(root,'mobile','tsconfig.json'),'utf8'));
if(Object.prototype.hasOwnProperty.call(mobileTsconfig?.compilerOptions||{},'baseUrl'))throw new Error('SDK57/TypeScript 6 source must not use deprecated compilerOptions.baseUrl when no path aliases require it');
const app=JSON.parse(fs.readFileSync(path.join(root,'mobile','app.json'),'utf8')).expo||{};
if(app.version!==target||app?.extra?.internalVersion!==target)throw new Error('Expo app version does not match package version');
if(app.newArchEnabled===false)throw new Error('Expo SDK 57 requires the React Native New Architecture; newArchEnabled:false is not allowed');
for(const nativeDir of ['android','ios'])if(fs.existsSync(path.join(root,'mobile',nativeDir)))throw new Error(`SDK57 CNG source unexpectedly contains mobile/${nativeDir}; stale generated native projects must not ship across SDK upgrades`);
for(const rel of ['server/src/server.mjs','scripts/start-backend.ps1','scripts/start-web.ps1','scripts/verify-install-runtime.mjs','scripts/merge-rollback-state.mjs']){
 if(!fs.existsSync(path.join(root,rel)))throw new Error(`Required install file missing: ${rel}`);
}
for(const rel of ['.env.local','server/data/state.json','cloudflare/wrangler.toml']){
 if(fs.existsSync(path.join(root,rel)))throw new Error(`Clean package unexpectedly contains runtime file: ${rel}`);
}
for(const rel of ['node_modules','mobile/node_modules','server/node_modules','mcp/node_modules','cloudflare/node_modules']){
 if(fs.existsSync(path.join(root,rel)))throw new Error(`Clean package unexpectedly contains dependency directory: ${rel}`);
}
const backendLauncher=fs.readFileSync(path.join(root,'scripts','start-backend.ps1'),'utf8');
if(/if \(\$health -and \$health\.ok\) \{ break \}/.test(backendLauncher))throw new Error('start-backend.ps1 must not exit readiness polling on HTTP ok before Fugle verification finishes');
if(!backendLauncher.includes('$health.marketDataVerified -eq $true'))throw new Error('start-backend.ps1 must wait for marketDataVerified before reporting backend ready');
console.log(`Install source check passed for v${target}: checksum-valid package structure, versions aligned, no runtime secrets/state/dependencies.`);
