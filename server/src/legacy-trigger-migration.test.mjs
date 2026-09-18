import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// run-server-tests.mjs gives every test file its own temporary TRADING_DB_FILE.
test('v0.3.16 review triggers migrate to deterministic smart-trigger policy without blocking cloud sync', async()=>{
 const file=process.env.TRADING_DB_FILE;
 assert.ok(file);
 const base={
  metadata:{ledgerMode:'manual'},portfolio:{cash:0},positions:[],trades:[],watchlist:[{symbol:'2303',name:'聯電',state:'WATCH',priority:80}],playbooks:{'2303':{version:1,breakout:50}},market:{},alerts:[],reviews:[],devices:[],disclosureSeen:[],volumeBaselines:{},
  reviewTriggers:[
   {id:'legacy_ok',symbol:'2303',label:'legacy',status:'ARMED',conditions:{all:[{field:'price',op:'>=',value:50}]},createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z'},
   {id:'legacy_bad',symbol:'2303',label:'bad',status:'ARMED',conditions:{all:[]},createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z'}
  ],triggerEvents:[],triggerSnapshots:[],audit:[],setups:{},setupEvents:[],hypotheses:[],closePackages:[],handoffs:[],gptUpdateHistory:[],settings:{stockChatUrl:''}
 };
 fs.writeFileSync(file,JSON.stringify(base));
 const {db}=await import(`./store.mjs?legacyTriggerMigration=${Date.now()}`);
 const good=db.reviewTriggers.find(x=>x.id==='legacy_ok');
 const bad=db.reviewTriggers.find(x=>x.id==='legacy_bad');
 assert.equal(good.status,'ARMED');
 assert.deepEqual(good.policy,{oneShot:true,minConsecutive:1,cooldownMinutes:0});
 assert.equal(good.purpose,'REVIEW');
 assert.equal(good.runtime.streak,0);
 assert.equal(bad.status,'CANCELLED');
 assert.equal(bad.cancelReason,'legacy_trigger_invalid_after_v0.3.18');
});
