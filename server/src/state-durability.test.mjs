import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('state persistence writes a last-known-good backup and recovers from a corrupt primary file', async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eason-state-durable-'));
 const state=path.join(dir,'state.json');
 const prevDb=process.env.TRADING_DB_FILE,prevSeed=process.env.TRADING_TEST_SEED;
 process.env.TRADING_DB_FILE=state;process.env.TRADING_TEST_SEED='0';
 try{
  const mod=await import(`./store.mjs?durability=${Date.now()}`);
  mod.db.metadata.testValue='first';mod.persist();
  mod.db.metadata.testValue='second';mod.persist();
  assert.equal(fs.existsSync(`${state}.bak`),true);
  const backup=JSON.parse(fs.readFileSync(`${state}.bak`,'utf8'));
  assert.equal(backup.metadata.testValue,'first');
  fs.writeFileSync(state,'{"broken"', 'utf8');
  const recovered=await import(`./store.mjs?recovery=${Date.now()}`);
  assert.equal(recovered.db.metadata.testValue,'first');
  assert.ok(recovered.db.metadata.recoveredFromBackupAt);
 } finally {
  if(prevDb==null)delete process.env.TRADING_DB_FILE;else process.env.TRADING_DB_FILE=prevDb;
  if(prevSeed==null)delete process.env.TRADING_TEST_SEED;else process.env.TRADING_TEST_SEED=prevSeed;
  fs.rmSync(dir,{recursive:true,force:true});
 }
});


test('high-volume operational history is bounded without pruning trades or reviews', async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eason-state-retention-'));
 const state=path.join(dir,'state.json');
 const prevDb=process.env.TRADING_DB_FILE,prevSeed=process.env.TRADING_TEST_SEED;
 process.env.TRADING_DB_FILE=state;process.env.TRADING_TEST_SEED='0';
 try{
  const mod=await import(`./store.mjs?retention=${Date.now()}`);
  mod.db.alerts=Array.from({length:1100},(_,i)=>({id:`a${i}`,createdAt:new Date().toISOString()}));
  mod.db.audit=Array.from({length:2700},(_,i)=>({id:`u${i}`,timestamp:new Date().toISOString()}));
  mod.db.setupEvents=Array.from({length:1600},(_,i)=>({id:`s${i}`,timestamp:new Date().toISOString()}));
  mod.db.handoffs=Array.from({length:300},(_,i)=>({id:`h${i}`,status:'ACKNOWLEDGED'}));
  mod.db.closePackages=Array.from({length:200},(_,i)=>({id:`c${i}`,date:'2026-01-01'}));
  mod.db.triggerEvents=Array.from({length:550},(_,i)=>({id:`e${i}`,snapshotId:`snap${i}`}));
  mod.db.triggerSnapshots=Array.from({length:550},(_,i)=>({id:`snap${i}`}));
  mod.db.trades=Array.from({length:1200},(_,i)=>({id:`t${i}`}));
  mod.db.reviews=Array.from({length:1200},(_,i)=>({id:`r${i}`}));
  mod.persist();
  assert.equal(mod.db.alerts.length,1000);
  assert.equal(mod.db.audit.length,2500);
  assert.equal(mod.db.setupEvents.length,1500);
  assert.equal(mod.db.handoffs.length,250);
  assert.equal(mod.db.closePackages.length,180);
  assert.equal(mod.db.triggerEvents.length,500);
  assert.equal(mod.db.triggerSnapshots.length,500);
  assert.equal(mod.db.trades.length,1200);
  assert.equal(mod.db.reviews.length,1200);
 } finally {
  if(prevDb==null)delete process.env.TRADING_DB_FILE;else process.env.TRADING_DB_FILE=prevDb;
  if(prevSeed==null)delete process.env.TRADING_TEST_SEED;else process.env.TRADING_TEST_SEED=prevSeed;
  fs.rmSync(dir,{recursive:true,force:true});
 }
});


test('high-frequency market ticks are batched instead of rewriting state on every tick', async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eason-market-batch-'));
 const state=path.join(dir,'state.json');
 const prevDb=process.env.TRADING_DB_FILE,prevSeed=process.env.TRADING_TEST_SEED;
 process.env.TRADING_DB_FILE=state;process.env.TRADING_TEST_SEED='0';
 try{
  const mod=await import(`./store.mjs?marketBatch=${Date.now()}`);
  mod.persist();
  mod.updateMarket({symbol:'1714',name:'和桐',price:16.5,source:'fugle-ws'});
  const beforeFlush=JSON.parse(fs.readFileSync(state,'utf8'));
  assert.equal(beforeFlush.market?.['1714'],undefined);
  assert.equal(mod.db.market['1714'].price,16.5);
  mod.flushPendingPersist();
  const afterFlush=JSON.parse(fs.readFileSync(state,'utf8'));
  assert.equal(afterFlush.market['1714'].price,16.5);
 } finally {
  if(prevDb==null)delete process.env.TRADING_DB_FILE;else process.env.TRADING_DB_FILE=prevDb;
  if(prevSeed==null)delete process.env.TRADING_TEST_SEED;else process.env.TRADING_TEST_SEED=prevSeed;
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
