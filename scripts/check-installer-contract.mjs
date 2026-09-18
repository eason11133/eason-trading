import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const install=fs.readFileSync(path.join(root,'release',`Install-eason-trading-v${version}.ps1.template`),'utf8');
const rollback=fs.readFileSync(path.join(root,'release',`Rollback-eason-trading-v${version}.ps1`),'utf8');
const errors=[];
for(const x of ['eason-trading-current.txt','Resolve-PreviousRoot','backup-manifest.json','verify-install-source.mjs','verify-install-runtime.mjs','--ledger-only','--typecheck-only','.eason-install.json','__ZIP_SHA256__','22.13.0'])if(!install.includes(x))errors.push(`installer missing ${x}`);
if(version==='0.3.18'){
 for(const x of ['npm install','npm --workspace server test','npm --prefix cloudflare test','node --test .\\shared\\smart-trigger.test.mjs','setup-cloud-monitor.mjs','/v1/cloud-monitor/sync','?applyCommands=false','start-backend.ps1','Invoke-CloudSyncDetailed','audit-production.ps1','EASON_AUDIT_MODE','Get-LedgerFingerprint','build-android-apk.ps1','Test-EasAuthentication','Starting v0.3.18 in AUDIT MODE before pointer cutover','Restarting audited v0.3.18 after Cloud deployment','Pre-cutover production audit PASS'])if(!install.includes(x))errors.push(`v0.3.18 installer missing ${x}`);
 if(install.includes('verify-sdk57-proof.mjs'))errors.push('v0.3.18 is an in-SDK update and must not depend on stale v0.3.16 preflight proof artifacts');
 const auditCall=install.indexOf('Invoke-ProductionAudit $NewRoot');
 const pointerWrite=install.indexOf('Set-Content $CurrentPointer $NewRoot');
 const normalStart=install.indexOf('Start-NewInstallAndVerify $NewRoot $false');
 if(auditCall<0||pointerWrite<0||pointerWrite<auditCall)errors.push('v0.3.18 installer must complete live production audit before active pointer cutover');
 if(normalStart<0||pointerWrite<normalStart)errors.push('v0.3.18 installer must prove a non-audit backend startup before active pointer cutover');
 const easAuth=install.indexOf('Test-EasAuthentication');
 const firstRuntimeStop=install.indexOf('try {\n  Stop-EasonProcesses');
 if(easAuth<0||firstRuntimeStop<0||firstRuntimeStop<easAuth)errors.push('v0.3.18 installer must verify EAS authentication before stopping the active baseline');
 const buildCall=install.indexOf('build-android-apk.ps1');
 if(buildCall<0||buildCall<pointerWrite)errors.push('v0.3.18 installer must submit the final APK build only after successful promotion');
}
if(install.includes('verify-release.ps1'))errors.push('user Installer must not run the developer release verifier/unit-test suite');
if(/mklink\s+\/J/i.test(install))errors.push('installer must not junction node_modules to an older install');
if(/\bfor\s*\(\s*\$[A-Za-z_]\w*\s+in\s+/i.test(install))errors.push('installer contains invalid PowerShell C-style for-in syntax; use foreach($x in ...)');
if(!install.includes('StateSource=$null;$EnvSource=$null'))errors.push('installer no longer resolves state/env from one active root');
for(const x of ['installed-root.txt','backup-manifest.json','eason-trading-current.txt','Cloud Monitor targets disarmed','rollback-current-state.json','Latest active ledger snapshotted','StateToRestore','merge-rollback-state.mjs','rollback-merged-state.json'])if(!rollback.includes(x))errors.push(`rollback missing ${x}`);

if(version==='0.3.16'){
 if(!install.includes('--registry=https://registry.npmjs.org/')||!install.includes('--prefer-online')||!install.includes('eason-trading-sdk57-npm-cache'))errors.push('SDK57 installer must use the official npm registry with an isolated fresh cache');
 for(const x of ['verified-package-lock.json','verified-package.json','verification-manifest.json','verify-sdk57-proof.mjs','npm ci'])if(!install.includes(x))errors.push(`SDK57 installer must consume verified preflight proof: ${x}`);
 if(install.includes('run-expo.mjs install --fix --npm'))errors.push('Production SDK57 installer must not mutate the already verified dependency graph with expo install --fix');
 if(/\bnpm install\b/.test(install))errors.push('Production SDK57 installer must reproduce the verified dependency graph with npm ci, not npm install');
 if(install.includes('--prefer-offline'))errors.push('SDK57 installer must not use prefer-offline because newly published Expo packages can be hidden by stale npm metadata');
}

if(version==='0.3.16'){
 for(const x of ['$StageDir','$StageRoot','SDK57 locked graph reproduced and reverified while active v0.3.15 remained online.','Restart-PreviousInstall','Fresh durable backup created after stopping the old backend','Active install changed during SDK57 preflight'])if(!install.includes(x))errors.push(`SDK57 two-phase installer missing ${x}`);
 const mobileVerify=install.indexOf('verify-install-runtime.mjs --typecheck-only');
 const firstStop=install.indexOf('Stop-EasonProcesses;$stopped=$true');
 if(mobileVerify<0||firstStop<0||firstStop<mobileVerify)errors.push('SDK57 installer must complete the full mobile preflight before stopping the active v0.3.15 processes');
 if(install.includes("replaceAll('0.3.15','0.3.16')")||install.includes('replaceAll("0.3.15","0.3.16")'))errors.push('SDK57 installer must not blindly replace every 0.3.15 occurrence in the preserved GPT Action Worker');
 const stageLeave=install.indexOf('Set-Location $Downloads');
 const stageMove=install.indexOf('Move-Item -Path $StageDir -Destination $NewDir');
 const ledgerSmoke=install.indexOf('verify-install-runtime.mjs --ledger-only');
 if(stageLeave<0||stageMove<0||ledgerSmoke<0||stageLeave<ledgerSmoke||stageLeave>stageMove)errors.push('SDK57 installer must leave the staging working directory after ledger smoke and before moving $StageDir on Windows');
 for(const x of ['preserve-upgrade-assets.mjs','cloud-worker $OldCloudWorker $StageCloudWorker 0.3.15 0.3.16','eas-project-id $OldApp $StageApp'])if(!install.includes(x))errors.push(`SDK57 installer missing safe upgrade-asset helper usage: ${x}`);
 if(/\bnode(?:\.exe)?\s+-e\b/i.test(install))errors.push('SDK57 installer must not embed inline node -e scripts inside PowerShell; use argument-safe .mjs helpers');
 for(const x of ['Find-VerifiedSourceZip','Start-NewInstallAndVerify','startup smoke passed while active pointer still referenced v0.3.15','Backend/Fugle/quotes/Web before changing the active pointer'])if(!install.includes(x))errors.push(`SDK57 cutover safety missing ${x}`);
 const pointerWrite=install.indexOf('Set-Content $CurrentPointer $NewRoot');
 const liveSmoke=install.indexOf('Start-NewInstallAndVerify $NewRoot');
 if(pointerWrite<0||liveSmoke<0||pointerWrite<liveSmoke)errors.push('SDK57 installer must live-smoke the new build before moving the active pointer');
 if(install.includes("Sort-Object LastWriteTime -Descending|Select-Object -First 1\nif(-not $Zip)"))errors.push('SDK57 installer must select its source ZIP by expected SHA, not newest filename');
}
if(errors.length){console.error('Installer contract failed:');errors.forEach(x=>console.error(' - '+x));process.exit(1)}
console.log('Installer/Rollback static contract passed: user install path is isolated from developer release tests.');
