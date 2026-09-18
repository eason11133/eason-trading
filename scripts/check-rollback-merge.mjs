import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eason-rollback-merge-'));
const base=path.join(dir,'base.json'), current=path.join(dir,'current.json'), out=path.join(dir,'merged.json');
try {
  const oldBase={
    metadata:{ledgerMode:'manual',cashKnown:true},
    settings:{stockChatUrl:'https://chatgpt.com/c/example'},
    portfolio:{cash:50000,realizedPnl:0},
    positions:[{symbol:'2337',quantity:100,averageCost:121}],
    watchlist:[{symbol:'2337',state:'POSITION'}],
    market:{2337:{price:999}},playbooks:{},trades:[],alerts:[],reviews:[],devices:[],disclosureSeen:true,
    volumeBaselines:{},reviewTriggers:[],triggerEvents:[],triggerSnapshots:[],setups:{},setupEvents:[],hypotheses:[],closePackages:[],handoffs:[],audit:[]
  };
  const latest=structuredClone(oldBase);
  latest.metadata={...latest.metadata,ledgerMode:'live',newMetadataField:'allowed-inside-existing-metadata'};
  latest.portfolio={cash:51620,realizedPnl:574,totalTradingCosts:30};
  latest.positions=[{symbol:'2337',quantity:50,averageCost:121,feeBasisKnown:false},{symbol:'2303',quantity:100,averageCost:50,feeBasisKnown:true}];
  latest.trades=[{id:'t1',symbol:'2337',side:'SELL',quantity:50,price:133,realizedPnl:574,costAccountingVersion:'v0.3.10'},{id:'t2',symbol:'2303',side:'BUY',quantity:100,price:50,costAccountingVersion:'v0.3.10'}];
  latest.market={2337:{price:133},2303:{price:50}};
  latest.gptUpdateHistory=[{id:'new-top-level-key-old-version-does-not-know'}];
  fs.writeFileSync(base,JSON.stringify(oldBase));fs.writeFileSync(current,JSON.stringify(latest));
  const r=spawnSync(process.execPath,[path.join(root,'scripts','merge-rollback-state.mjs'),base,current,out],{encoding:'utf8'});
  if(r.status!==0)throw new Error(r.stderr||r.stdout||'merge helper failed');
  const x=JSON.parse(fs.readFileSync(out,'utf8'));
  if(x.positions.length!==2||x.positions.find(p=>p.symbol==='2337')?.quantity!==50)throw new Error('latest positions were not preserved');
  if(x.trades.length!==2||x.portfolio.cash!==51620)throw new Error('latest trades/cash were not preserved');
  if(Object.keys(x.market||{}).length!==0)throw new Error('stale market must be cleared');
  if(Object.prototype.hasOwnProperty.call(x,'gptUpdateHistory'))throw new Error('new top-level schema key leaked into old-version state');
  if(x.metadata.newMetadataField!=='allowed-inside-existing-metadata')throw new Error('metadata carry-forward failed');
  console.log('Rollback state merge compatibility check passed.');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
