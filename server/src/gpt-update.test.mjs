import test from 'node:test';
import assert from 'node:assert/strict';
import { db, reset, previewGptUpdate, applyGptUpdate, listReviewTriggers, createReviewTrigger, addWatch } from './store.mjs';

function text(payload){return `分析文字\n--- EASON_TRADING_UPDATE_V1 ---\n${JSON.stringify(payload)}\n--- END_EASON_TRADING_UPDATE ---`;}

test('GPT clipboard update previews and applies radar/playbook/trigger without touching ledger',()=>{
 reset();const beforePositions=JSON.stringify(db.positions),beforeCash=db.portfolio.cash,beforeTrades=db.trades.length;
 const payload={version:1,summary:'明日候選',setups:[{symbol:'4938',name:'和碩',action:'UPSERT',priority:92,rating:'A-',stage:'WAIT_PULLBACK',statusReason:'92-93 止跌再站回94',selectionValidity:'PARTIAL',entryOpportunity:'WAITING',playbook:{goodZone:[92,93],breakout:94,invalid:91.5,target1:98,nextStep:'重新站94再複判'},reviewTriggers:[{label:'和碩重新站94',conditions:{all:[{field:'price',op:'>=',value:94},{field:'rvol',op:'>=',value:1.2}]}}]}]};
 const preview=previewGptUpdate(text(payload));assert.equal(preview.total,1);assert.equal(preview.triggerCount,1);
 const result=applyGptUpdate(text(payload));assert.equal(result.ok,true);assert.equal(db.watchlist.find(x=>x.symbol==='4938')?.priority,92);assert.equal(db.playbooks['4938']?.breakout,94);assert.equal(db.setups['4938']?.stage,'WAIT_PULLBACK');assert.equal(listReviewTriggers({status:'ARMED',symbol:'4938'}).length,1);assert.equal(JSON.stringify(db.positions),beforePositions);assert.equal(db.portfolio.cash,beforeCash);assert.equal(db.trades.length,beforeTrades);
});

test('GPT update cannot modify positions cash trades or portfolio',()=>{
 reset();for(const bad of [{version:1,cash:999,setups:[{symbol:'4938'}]},{version:1,positions:[],setups:[{symbol:'4938'}]},{version:1,setups:[{symbol:'4938',trades:[]}]}])assert.throws(()=>previewGptUpdate(text(bad)),/禁止修改/);
});

test('GPT archive cannot make an open position disappear',()=>{
 reset();const qty=db.positions.find(x=>x.symbol==='2303')?.quantity;const payload={version:1,setups:[{symbol:'2303',action:'ARCHIVE',statusReason:'降級'}]};const x=applyGptUpdate(text(payload));assert.equal(x.results[0].action,'SKIPPED_HELD');assert.equal(db.positions.find(x=>x.symbol==='2303')?.quantity,qty);assert.notEqual(db.watchlist.find(x=>x.symbol==='2303')?.state,'DROP');
});

test('same GPT clipboard update is idempotent and cannot duplicate triggers',()=>{
 reset();
 const payload={version:1,summary:'same update',setups:[{symbol:'4938',name:'和碩',action:'UPSERT',priority:90,rating:'A-',stage:'WAIT_PULLBACK',statusReason:'等第二段',reviewTriggers:[{label:'站回94',conditions:{all:[{field:'price',op:'>=',value:94}]}}]}]};
 const raw=text(payload);
 const first=applyGptUpdate(raw);assert.equal(first.duplicate,false);
 const count=listReviewTriggers({status:'ARMED',symbol:'4938'}).length;
 const preview=previewGptUpdate(raw);assert.equal(preview.duplicate,true);
 const second=applyGptUpdate(raw);assert.equal(second.duplicate,true);
 assert.equal(listReviewTriggers({status:'ARMED',symbol:'4938'}).length,count);
});

test('App-to-GPT handoff text can never be mistaken for a GPT-to-App update',()=>{
 reset();
 const fake=`[EASON TRADING APP HANDOFF]\n--- EASON_TRADING_UPDATE_V1 ---\n${JSON.stringify({version:1,setups:[{symbol:'6147'}]})}\n--- END_EASON_TRADING_UPDATE ---`;
 assert.throws(()=>previewGptUpdate(fake),/App → GPT/);
});

test('duplicate detection is based on normalized update, not surrounding GPT prose',()=>{
 reset();
 const payload={version:1,summary:'same',setups:[{symbol:'4938',action:'UPSERT',priority:80}]};
 const a=`第一個說法\n--- EASON_TRADING_UPDATE_V1 ---\n${JSON.stringify(payload)}\n--- END_EASON_TRADING_UPDATE ---`;
 const b=`完全不同的分析文字\n--- EASON_TRADING_UPDATE_V1 ---\n${JSON.stringify(payload)}\n--- END_EASON_TRADING_UPDATE ---`;
 applyGptUpdate(a);assert.equal(previewGptUpdate(b).duplicate,true);
});

test('omitting reviewTriggers preserves existing armed triggers, while explicit empty list clears them',()=>{
 reset();
 const t=createReviewTrigger({symbol:'4938',label:'old',conditions:{all:[{field:'price',op:'>=',value:94}]}},'chatgpt');
 const keep={version:1,setups:[{symbol:'4938',action:'UPSERT',priority:81}]};
 applyGptUpdate(text(keep));assert.equal(listReviewTriggers({status:'ARMED',symbol:'4938'}).some(x=>x.id===t.id),true);
 const clear={version:1,setups:[{symbol:'4938',action:'UPSERT',priority:82,reviewTriggers:[]}]};
 applyGptUpdate(text(clear));assert.equal(listReviewTriggers({status:'ARMED',symbol:'4938'}).length,0);
});

test('archiving a non-held candidate also cancels its armed review triggers',()=>{
 reset();
 createReviewTrigger({symbol:'9999',label:'old',conditions:{all:[{field:'price',op:'>=',value:10}]}},'chatgpt');
 addWatch({symbol:'9999',name:'測試股'},'chatgpt');
 const payload={version:1,setups:[{symbol:'9999',action:'ARCHIVE',statusReason:'淘汰'}]};
 applyGptUpdate(text(payload));assert.equal(listReviewTriggers({status:'ARMED',symbol:'9999'}).length,0);
});

test('GPT preview exposes field-level diff and last GPT update can be undone without touching ledger',async()=>{
 reset();
 const beforePositions=JSON.stringify(db.positions),beforeCash=db.portfolio.cash,beforeTrades=db.trades.length;
 const payload={version:1,summary:'diff test',setups:[{symbol:'4938',name:'和碩',action:'UPSERT',priority:99,rating:'A',stage:'WAIT_PULLBACK',statusReason:'等回檔',playbook:{breakout:95,invalid:91},reviewTriggers:[{label:'站95',conditions:{all:[{field:'price',op:'>=',value:95}]}}]}]};
 const raw=text(payload);const preview=previewGptUpdate(raw);assert.ok(preview.changeCount>=4);assert.ok(preview.rows[0].changes.some(x=>x.field==='priority'&&x.after===99));
 applyGptUpdate(raw);assert.equal(db.watchlist.find(x=>x.symbol==='4938')?.priority,99);
 const {undoLastGptUpdate}=await import('./store.mjs');const u=undoLastGptUpdate('test');assert.equal(u.ok,true);assert.equal(db.watchlist.find(x=>x.symbol==='4938'),undefined);
 assert.equal(JSON.stringify(db.positions),beforePositions);assert.equal(db.portfolio.cash,beforeCash);assert.equal(db.trades.length,beforeTrades);
});

test('cloud-trigger GPT update completes the reconciled local inbox event',async()=>{
 const {importCloudReviewEvent,listReviewInbox}=await import('./store.mjs');
 reset();
 importCloudReviewEvent({id:'ce_done_1',targetId:'rt_cloud',symbol:'4938',name:'和碩',label:'cloud review',snapshot:{price:94.2,rvol:1.5},context:{playbook:{breakout:94}},reviewStatus:'GPT_SENT',createdAt:'2026-09-08T02:00:00.000Z'});
 const raw=text({version:1,cloudEventId:'ce_done_1',summary:'cloud done',setups:[{symbol:'4938',action:'UPSERT',priority:93}]});
 const out=applyGptUpdate(raw);assert.equal(out.cloudEventId,'ce_done_1');
 assert.equal(listReviewInbox({})[0].reviewStatus,'COMPLETED');
});

test('reviewEventId can refer to either local inbox id or cloud event id and NO_CHANGE still completes it',async()=>{
 const {importCloudReviewEvent,listReviewInbox}=await import('./store.mjs');
 reset();
 importCloudReviewEvent({id:'ce_review_ref',targetId:'rt_ref',symbol:'2303',name:'聯電',snapshot:{price:60},context:{},reviewStatus:'GPT_SENT',createdAt:'2026-09-14T02:00:00.000Z'});
 const local=listReviewInbox({})[0];
 const before=JSON.stringify({positions:db.positions,cash:db.portfolio.cash,trades:db.trades,watch:db.watchlist});
 const out=applyGptUpdate(text({version:1,reviewEventId:local.id,summary:'複判完成，策略不變',setups:[{symbol:'2303',action:'NO_CHANGE'}]}));
 assert.equal(out.reviewEventId,local.id);assert.equal(out.cloudEventId,'ce_review_ref');assert.equal(listReviewInbox({})[0].reviewStatus,'COMPLETED');
 assert.equal(JSON.stringify({positions:db.positions,cash:db.portfolio.cash,trades:db.trades,watch:db.watchlist}),before);
});

import {directCommandToUpdateText} from './cloud-monitor.mjs';

test('direct GPT command changes strategy but cannot change ledger cash holdings or trades',()=>{
 reset();
 const before={cash:db.portfolio.cash,positions:JSON.stringify(db.positions),trades:JSON.stringify(db.trades)};
 const text=directCommandToUpdateText({payload:{summary:'direct bridge test',setups:[{symbol:'2303',priority:77,stage:'WAIT_TRIGGER',statusReason:'等突破',playbook:{breakout:61,nextStep:'站上61再複判'},reviewTriggers:[{label:'61突破',conditions:{all:[{field:'price',op:'>=',value:61}]}}]}]}});
 const result=applyGptUpdate(text,'gpt-direct-test');
 assert.equal(result.ok,true);
 assert.equal(db.watchlist.find(x=>x.symbol==='2303').priority,77);
 assert.equal(db.playbooks['2303'].breakout,61);
 assert.equal(db.portfolio.cash,before.cash);
 assert.equal(JSON.stringify(db.positions),before.positions);
 assert.equal(JSON.stringify(db.trades),before.trades);
});
