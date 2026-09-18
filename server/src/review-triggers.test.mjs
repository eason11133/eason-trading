import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateReviewTrigger } from './review-triggers.mjs';
test('GPT review trigger requires all structured conditions',()=>{
 const t={conditions:{all:[{field:'price',op:'>=',value:131},{field:'rvol',op:'>=',value:1.4}]}};
 assert.equal(evaluateReviewTrigger(t,{price:131.5,rvol:1.5}).matched,true);
 assert.equal(evaluateReviewTrigger(t,{price:131.5,rvol:1.1}).matched,false);
});

import { createReviewTrigger, db, reset } from './store.mjs';
import { processReviewTriggers } from './review-triggers.mjs';
test('fired GPT review trigger freezes a snapshot before notifying',async()=>{
 reset();const t=createReviewTrigger({symbol:'2303',label:'131 + RVOL',conditions:{all:[{field:'price',op:'>=',value:131},{field:'rvol',op:'>=',value:1.4}]}});
 const alerts=await processReviewTriggers({symbol:'2303',name:'聯電',price:131.5,rvol:1.5,vwap:130,high:132,low:128,changePct:2});
 assert.equal(alerts.length,1);assert.equal(alerts[0].level,'GPT_REVIEW');
 assert.equal(db.reviewTriggers.find(x=>x.id===t.id).status,'FIRED');assert.equal(db.triggerEvents.length,1);assert.equal(db.triggerSnapshots.length,1);
 const snap=db.triggerSnapshots[0];
 assert.equal(snap.schemaVersion,'2.0-data-only');
 assert.equal(snap.transferMode,'STRUCTURED_DATA_ONLY');
 assert.equal(snap.generatedImage,false);
 assert.ok(snap.seriesAtTrigger.oneMinute.data.length>0);
 assert.ok(snap.seriesAtTrigger.fiveMinute.data.length>0);
 assert.ok(snap.seriesAtTrigger.daily.data.length>0);
 assert.equal('charts' in snap,false);
});

test('GPT review inbox moves PENDING -> GPT_SENT -> COMPLETED',async()=>{
 const {createHandoff,listReviewInbox,applyGptUpdate}=await import('./store.mjs');
 reset();createReviewTrigger({symbol:'2303',label:'inbox test',conditions:{all:[{field:'price',op:'>=',value:131}]}});
 await processReviewTriggers({symbol:'2303',name:'聯電',price:131.5,rvol:1.5,vwap:130,high:132,low:128,changePct:2});
 let inbox=listReviewInbox({});assert.equal(inbox[0].reviewStatus,'PENDING');const ev=inbox[0];
 const h=createHandoff({type:'TRIGGER_REVIEW',symbol:'2303',eventId:ev.id,snapshotId:ev.snapshotId},'app');
 inbox=listReviewInbox({});assert.equal(inbox[0].reviewStatus,'GPT_SENT');assert.equal(inbox[0].handoffId,h.id);
 const raw=`--- EASON_TRADING_UPDATE_V1 ---\n${JSON.stringify({version:1,handoffId:h.id,triggerEventId:ev.id,setups:[{symbol:'2303',action:'KEEP',priority:98}]})}\n--- END_EASON_TRADING_UPDATE ---`;
 applyGptUpdate(raw);inbox=listReviewInbox({});assert.equal(inbox[0].reviewStatus,'COMPLETED');
});

test('cloud monitor event reconciles into local GPT inbox and never downgrades review status',async()=>{
 const {importCloudReviewEvent,listReviewInbox}=await import('./store.mjs');
 reset();
 const t=createReviewTrigger({symbol:'2303',label:'cloud',conditions:{all:[{field:'price',op:'>=',value:131}]}});
 const base={id:'ce_test_1',targetId:t.id,symbol:'2303',name:'聯電',label:'cloud',reasons:['price >= 131'],snapshot:{price:131.5,rvol:1.6},context:{playbook:{breakout:131}},createdAt:'2026-09-08T02:00:00.000Z',updatedAt:'2026-09-08T02:00:00.000Z'};
 importCloudReviewEvent({...base,reviewStatus:'GPT_SENT'});
 let inbox=listReviewInbox({});
 assert.equal(inbox.length,1);assert.equal(inbox[0].cloudEventId,'ce_test_1');assert.equal(inbox[0].reviewStatus,'GPT_SENT');assert.equal(db.reviewTriggers.find(x=>x.id===t.id)?.status,'FIRED');
 importCloudReviewEvent({...base,reviewStatus:'PENDING',updatedAt:'2026-09-08T02:01:00.000Z'});
 inbox=listReviewInbox({});assert.equal(inbox[0].reviewStatus,'GPT_SENT');
});

test('reusable smart review trigger suppresses repeated ticks and can fire again after leaving the zone',async()=>{
 reset();
 const t=createReviewTrigger({symbol:'2303',label:'reusable',conditions:{all:[{field:'price',op:'>=',value:131}]},policy:{oneShot:false,minConsecutive:1,cooldownMinutes:0}});
 let alerts=await processReviewTriggers({symbol:'2303',name:'聯電',price:131.5,rvol:1.2,vwap:130,high:132,low:129,changePct:1});
 assert.equal(alerts.length,1);
 assert.equal(db.reviewTriggers.find(x=>x.id===t.id).status,'ARMED');
 assert.equal(db.triggerEvents.length,1);
 alerts=await processReviewTriggers({symbol:'2303',name:'聯電',price:132,rvol:1.3,vwap:130,high:132.5,low:129,changePct:1.2});
 assert.equal(alerts.length,0);
 assert.equal(db.triggerEvents.length,1);
 await processReviewTriggers({symbol:'2303',name:'聯電',price:130.5,rvol:1.0,vwap:130,high:132.5,low:129,changePct:.2});
 alerts=await processReviewTriggers({symbol:'2303',name:'聯電',price:131.2,rvol:1.1,vwap:130,high:132.5,low:129,changePct:.8});
 assert.equal(alerts.length,1);
 assert.equal(db.triggerEvents.length,2);
});

test('playbook invalidation blocks a review-zone notification and preserves decision evidence',async()=>{
 const {updatePlaybook}=await import('./store.mjs');
 reset();
 updatePlaybook('2303',{invalid:130,summary:'守 130'},'test');
 const t=createReviewTrigger({symbol:'2303',label:'zone',conditions:{all:[{field:'price',op:'<=',value:132}]}});
 const alerts=await processReviewTriggers({symbol:'2303',name:'聯電',price:129.5,rvol:1.1,vwap:130,high:132,low:129,changePct:-1});
 assert.equal(alerts.length,0);
 assert.equal(db.triggerEvents.length,0);
 const runtime=db.reviewTriggers.find(x=>x.id===t.id).runtime;
 assert.equal(runtime.lastCandidateMatched,true);
});
