import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const forbiddenExact=new Set(['.env.local','state.json','state.json.bak','wrangler.toml']);
const forbiddenDirs=new Set(['node_modules','.expo','.wrangler','.git']);
const hits=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);const rel=path.relative(root,p).replaceAll('\\','/');if(e.isDirectory()){if(forbiddenDirs.has(e.name)){hits.push(`${rel}/`);continue;}walk(p);}else if(forbiddenExact.has(e.name)){hits.push(rel);}}}
walk(root);
if(hits.length){console.error('Package cleanliness check failed. Runtime/private files found:');for(const h of hits)console.error(` - ${h}`);process.exit(1);}console.log('Package cleanliness check passed: no runtime state, local env, generated wrangler config, or dependency folders.');
