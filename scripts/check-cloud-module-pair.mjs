import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const setupPath=path.join(here,'setup-cloud-monitor.mjs');
const corePath=path.join(here,'cloudflare-setup-core.mjs');
const setup=fs.readFileSync(setupPath,'utf8');
const m=setup.match(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/cloudflare-setup-core\.mjs['"]/s);
assert.ok(m,'setup-cloud-monitor.mjs must import its Cloudflare runtime helpers from cloudflare-setup-core.mjs');
const imported=m[1].split(',').map(x=>x.trim()).filter(Boolean).map(x=>x.split(/\s+as\s+/)[0].trim());
const core=await import(pathToFileURL(corePath).href+`?paircheck=${Date.now()}`);
for(const name of imported)assert.ok(name in core,`cloudflare-setup-core.mjs does not export ${name}, required by setup-cloud-monitor.mjs`);
assert.ok(imported.includes('CURRENT_WORKERS_PAGES_URL'),'Cloud setup must use the current Workers & Pages fallback URL export');
const readinessIndex=setup.indexOf("process.argv.includes('--readiness-only')");
const cliIndex=setup.indexOf('const {cli,version}=resolveWranglerCli();');
assert.ok(readinessIndex>=0&&cliIndex>=0&&readinessIndex<cliIndex,'readiness-only mode must be resolved before Wrangler CLI resolution');
console.log(`Cloud runtime module pair passed (${imported.length} setup imports resolved by core; readiness-only pre-Wrangler gate preserved).`);
