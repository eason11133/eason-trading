import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.dirname(here);
function loadTypescript(){
 const candidates=[
  path.join(root,'node_modules','typescript','lib','typescript.js'),
  path.join(root,'mobile','node_modules','typescript','lib','typescript.js'),
  path.join(root,'mcp','node_modules','typescript','lib','typescript.js')
 ];
 for(const c of candidates){if(fs.existsSync(c)){const req=createRequire(pathToFileURL(c));return req(c);}}
 return null;
}
function walk(dir,out=[]){if(!fs.existsSync(dir))return out;for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.expo','.git'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())walk(p,out);else if(/\.(ts|tsx)$/.test(e.name))out.push(p);}return out;}
const ts=loadTypescript();if(!ts){console.error('TypeScript compiler was not found. Install mobile dependencies before release verification.');process.exit(2);}
const files=[...walk(path.join(root,'mobile')),...walk(path.join(root,'mcp'))];
let errors=0;
for(const file of files){const src=fs.readFileSync(file,'utf8');const isTsx=file.endsWith('.tsx');const out=ts.transpileModule(src,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:isTsx?ts.JsxEmit.ReactJSX:ts.JsxEmit.Preserve}});for(const d of out.diagnostics||[]){if(d.category!==ts.DiagnosticCategory.Error)continue;errors++;const msg=ts.flattenDiagnosticMessageText(d.messageText,' ');console.error(`${path.relative(root,file)}: ${msg}`);}}
if(errors){console.error(`TS/TSX syntax check failed: ${errors} error(s).`);process.exit(1);}console.log(`TS/TSX syntax check passed: ${files.length} file(s).`);
