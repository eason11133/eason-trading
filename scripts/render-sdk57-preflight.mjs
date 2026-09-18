import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [zipArg,outArg,labelArg]=process.argv.slice(2);
if(!zipArg||!outArg||!labelArg){
  console.error('Usage: node scripts/render-sdk57-preflight.mjs <source.zip> <output.ps1> <source-label>');
  process.exit(2);
}
const zip=path.resolve(zipArg);const out=path.resolve(outArg);
if(!fs.existsSync(zip))throw new Error(`Source ZIP not found: ${zip}`);
const hash=crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
const base=path.basename(zip);
if(!/^eason-trading-v1-source-v0\.3\.16(?:(?:-SDK57-WIP\d+)|(?:-FIX\d+))?\.zip$/.test(base))throw new Error(`Unexpected SDK57 source ZIP name: ${base}`);
const template=fs.readFileSync(path.join(root,'release','Test-eason-trading-v0.3.16-SDK57.ps1.template'),'utf8');
const rendered=template
  .replaceAll('__ZIP_SHA256__',hash)
  .replaceAll('__SOURCE_ZIP_GLOB__',base)
  .replaceAll('__SOURCE_LABEL__',labelArg.replaceAll("'","''"));
for(const marker of ['__ZIP_SHA256__','__SOURCE_ZIP_GLOB__','__SOURCE_LABEL__'])if(rendered.includes(marker))throw new Error(`Unresolved template marker: ${marker}`);
fs.writeFileSync(out,rendered);
console.log(`Rendered SDK57 isolated preflight for ${labelArg}`);
console.log(`ZIP SHA256: ${hash}`);
console.log(`Output: ${out}`);
