import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file=process.argv[2]||path.join(root,'server','data','state.json');
if(!fs.existsSync(file))throw new Error(`Ledger state not found: ${file}`);
const x=JSON.parse(fs.readFileSync(file,'utf8'));
function stable(v){
 if(Array.isArray(v))return v.map(stable);
 if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
 return v;
}
const truth={
 ledgerMode:x?.metadata?.ledgerMode??null,
 cash:x?.portfolio?.cash??null,
 cashKnown:x?.portfolio?.cashKnown??null,
 positions:x?.positions||[],
 trades:x?.trades||[]
};
const hash=crypto.createHash('sha256').update(JSON.stringify(stable(truth))).digest('hex');
if(process.argv.includes('--json'))console.log(JSON.stringify({sha256:hash,positions:truth.positions.length,trades:truth.trades.length,cashKnown:truth.cashKnown,ledgerMode:truth.ledgerMode}));
else console.log(hash);
