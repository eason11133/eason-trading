// Production-safe acceptance: always uses an isolated temporary Ledger file.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eason-pc-off-'));process.env.TRADING_DB_FILE=path.join(dir,'state.json');process.env.TRADING_TEST_SEED='0';
try{
 const store=await import('../server/src/store.mjs');const {applyLedgerMutation}=await import('../server/src/ledger-mutations.mjs');store.reset();
 const before=JSON.stringify({cash:store.db.portfolio.cash,trades:store.db.trades,positions:store.db.positions});
 const cloud={mutationId:'lm_acceptance_1714',deviceId:'dev_acceptance',createdAt:new Date().toISOString(),clientSequence:1,idempotencyKey:'lm_acceptance_1714',schemaVersion:1,mutationType:'POSITION_ADD',payload:{symbol:'1714',quantity:1000,averageCost:16.65,expectedPosition:null},status:'pending'};
 assert.equal(store.db.positions.length,0,'PC-off queue must not mutate local Ledger');
 const first=applyLedgerMutation(cloud);cloud.status='applied';cloud.appliedAt=first.appliedAt;cloud.applyResult=first;
 assert.equal(store.db.positions.find(x=>x.symbol==='1714')?.quantity,1000);assert.equal(store.db.positions.find(x=>x.symbol==='1714')?.averageCost,16.65);
 const afterFirst=JSON.stringify({cash:store.db.portfolio.cash,trades:store.db.trades,positions:store.db.positions});const second=applyLedgerMutation(cloud);assert.equal(second.alreadyApplied,true);assert.equal(JSON.stringify({cash:store.db.portfolio.cash,trades:store.db.trades,positions:store.db.positions}),afterFirst);
 const prior=JSON.parse(before),after=JSON.parse(afterFirst);assert.deepEqual(after.cash,prior.cash);assert.deepEqual(after.trades,prior.trades);assert.equal(after.positions.length,prior.positions.length+1);
 console.log(JSON.stringify({ok:true,status:cloud.status,mutationId:cloud.mutationId,holding:after.positions.find(x=>x.symbol==='1714'),duplicateApplyPrevented:true,unrelatedCashAndTradesUnchanged:true,isolatedLedger:process.env.TRADING_DB_FILE},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true})}
