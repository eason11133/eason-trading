import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const root=path.resolve(process.argv[2]||'.');const scope=String(process.argv[3]||'mobile');
const files=scope==='cloud'?['cloudflare/package.json']:scope==='mobile'?['package.json','mobile/package.json']:['package.json','mobile/package.json','server/package.json','mcp/package.json'];
const dependencyKeys=['dependencies','devDependencies','peerDependencies','optionalDependencies','overrides','resolutions'];
const payload={scope,packages:[]};
for(const rel of files){const p=path.join(root,rel);if(!fs.existsSync(p)){payload.packages.push({path:rel,missing:true});continue;}const x=JSON.parse(fs.readFileSync(p,'utf8'));const keep={path:rel};for(const k of dependencyKeys)if(x[k])keep[k]=Object.fromEntries(Object.entries(x[k]).sort(([a],[b])=>a.localeCompare(b)));payload.packages.push(keep);}
const text=JSON.stringify(payload);process.stdout.write(crypto.createHash('sha256').update(text).digest('hex'));
