import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));const ps=fs.readFileSync(path.join(root,'scripts','audit-production.ps1'),'utf8');const fp=fs.readFileSync(path.join(root,'scripts','ledger-fingerprint.mjs'),'utf8');
const required=['/v1/cloud-monitor/sync?applyCommands=false','/v1/gpt-action/readiness','reviewEventId','/v1/gpt-bridge/roundtrip-test','/v1/gpt-direct/roundtrip-test','/v1/devices/test-push','CUSTOM_GPT','Ledger truth fingerprint'];for(const x of required)if(!ps.includes(x))throw new Error(`production audit missing ${x}`);
for(const x of ['positions','trades','cash','sha256'])if(!fp.includes(x))throw new Error(`ledger fingerprint missing ${x}`);
if(/Write-Host\s+\$bearer|Write-Host\s+\$cloudKey|Write-Host\s+\$localKey/.test(ps))throw new Error('production audit must not print secrets');
if(!ps.includes('appOnline'))throw new Error('production audit must require a fresh online GPT bridge');
if(!ps.includes('auditMode'))throw new Error('production audit must require backend audit mode');
console.log('Production audit contract passed: live checks use command-safe sync, exact PING roundtrip, push ticket and Ledger fingerprint invariants.');
