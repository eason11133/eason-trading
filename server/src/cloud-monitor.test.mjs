import test from 'node:test';
import assert from 'node:assert/strict';
import {reset,createReviewTrigger,db,updatePlaybook,updateSetup,generateClosePackage,importCloudReviewEvent,listReviewInbox} from './store.mjs';
import {buildMonitorTargets,cloudMonitorConfig,cloudMonitorHealth,buildGptBridgeSnapshot,directCommandToUpdateText,reconcileGptCommands,syncReviewEventStatuses} from './cloud-monitor.mjs';

test('cloud sync payload contains trigger/playbook monitor context but no trading ledger or cash',()=>{
 reset();
 db.positions=[{symbol:'2303',quantity:100,averageCost:131.5}];
 db.portfolio.cash=50000;
 db.trades=[{symbol:'2303',side:'BUY',quantity:100,price:131.5}];
 db.volumeBaselines['2303']={avgDailyVolume:28389,updatedAt:new Date().toISOString()};
 updatePlaybook('2303',{summary:'等突破',nextStep:'131 + 量能',goodZone:[128,130],breakout:131,invalid:126.5},'test');
 updateSetup('2303',{stage:'WAIT_TRIGGER',statusReason:'等突破'},'test');
 const t=createReviewTrigger({symbol:'2303',label:'test',conditions:{all:[{field:'price',op:'>=',value:131}]}});
 const rows=buildMonitorTargets();const x=rows.find(r=>r.id===t.id);
 assert.ok(x);
 assert.equal('positions' in x,false);assert.equal('cash' in x,false);assert.equal('trades' in x,false);assert.equal('portfolio' in x,false);
 assert.deepEqual(x.conditions.all[0],{field:'price',op:'>=',value:131});
 assert.equal(x.context.playbook.breakout,131);
 assert.equal(x.context.setup.stage,'WAIT_TRIGGER');
 assert.equal(x.context.rvolBaseline.avgDailyVolume,28389);
 assert.equal('averageCost' in JSON.parse(JSON.stringify(x)),false);
});

test('cloud monitor is opt-in until deployment URL is configured',()=>{
 const old=process.env.CLOUD_MONITOR_URL;delete process.env.CLOUD_MONITOR_URL;
 try{assert.equal(cloudMonitorConfig().configured,false)}finally{if(old)process.env.CLOUD_MONITOR_URL=old}
});

test('cloud requests send the exact configured Cloud API key',async()=>{
 const oldUrl=process.env.CLOUD_MONITOR_URL,oldKey=process.env.CLOUD_MONITOR_API_KEY,oldFetch=global.fetch;
 const key='z'.repeat(64);process.env.CLOUD_MONITOR_URL='https://cloud.test';process.env.CLOUD_MONITOR_API_KEY=key;
 global.fetch=async(url,init={})=>{
  assert.equal(String(url),'https://cloud.test/health');
  assert.equal(init.headers?.['x-api-key'],key);
  return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json'}});
 };
 try{const out=await cloudMonitorHealth();assert.equal(out.ok,true)}finally{global.fetch=oldFetch;if(oldUrl==null)delete process.env.CLOUD_MONITOR_URL;else process.env.CLOUD_MONITOR_URL=oldUrl;if(oldKey==null)delete process.env.CLOUD_MONITOR_API_KEY;else process.env.CLOUD_MONITOR_API_KEY=oldKey;}
});

test('RVOL cloud target is not marked ready until a real daily-volume baseline exists',()=>{
 reset();
 const t=createReviewTrigger({symbol:'6147',label:'rvol',conditions:{all:[{field:'price',op:'>=',value:194},{field:'rvol',op:'>=',value:1.5}]}});
 let x=buildMonitorTargets().find(r=>r.id===t.id);
 assert.equal(x.cloudReady,false);
 assert.deepEqual(x.cloudMissing,['rvolBaseline']);
 db.volumeBaselines['6147']={avgDailyVolume:12000,updatedAt:new Date().toISOString()};
 x=buildMonitorTargets().find(r=>r.id===t.id);
 assert.equal(x.cloudReady,true);
 assert.deepEqual(x.cloudMissing,[]);
 assert.equal(x.context.rvolBaseline.avgDailyVolume,12000);
});


test('direct GPT read replica exposes strategy/positions but never cash or executed trade history',()=>{
 reset();
 db.portfolio.cash=98765;db.trades=[{id:'secret-trade',symbol:'2303',side:'BUY',quantity:100,price:50,timestamp:new Date().toISOString(),costAccountingVersion:'v0.3.10'}];
 const x=buildGptBridgeSnapshot();const raw=JSON.stringify(x);
 assert.equal(x.authoritativeLedger,false);assert.equal(x.readOnlyReplica,true);
 assert.ok(Array.isArray(x.positions));assert.ok(Array.isArray(x.radar));
 assert.equal('portfolio' in x,false);assert.doesNotMatch(raw,/98765|secret-trade/);
});


test('after-close GPT package includes tracked strategy market context without exposing ledger cash or trade ids',()=>{
 reset();
 db.portfolio.cash=54321;
 db.market['2303']={symbol:'2303',name:'聯電',price:60.5,changePct:1.2,high:61,low:59.5,vwap:60.1,rvol:1.3,updatedAt:new Date().toISOString(),source:'test'};
 updatePlaybook('2303',{summary:'等突破',nextStep:'站 61 再複判',breakout:61,invalid:58},'test');
 updateSetup('2303',{stage:'WAIT_TRIGGER',statusReason:'等待價量'},'test');
 generateClosePackage({date:'2026-09-14',force:true});
 const x=buildGptBridgeSnapshot();
 assert.ok(Array.isArray(x.closeReview.trackedStrategies));
 const row=x.closeReview.trackedStrategies.find(r=>r.symbol==='2303');
 assert.equal(row.price,60.5);assert.equal(row.playbook.breakout,61);assert.equal(row.setup.stage,'WAIT_TRIGGER');
 const raw=JSON.stringify(x.closeReview);assert.doesNotMatch(raw,/54321/);
});

test('direct GPT command carries exact review correlation through the safe strategy validator',()=>{
 const text=directCommandToUpdateText({payload:{summary:'test direct',reviewEventId:'ce_exact',setups:[{symbol:'2303',priority:88,stage:'WAIT_TRIGGER',statusReason:'等價量確認',playbook:{breakout:60}}]}});
 assert.match(text,/EASON_TRADING_UPDATE_V1/);assert.match(text,/"symbol":"2303"/);assert.match(text,/"reviewEventId":"ce_exact"/);
});


test('direct GPT NO_CHANGE resolves the exact cloud review locally and remotely without touching ledger',async()=>{
 reset();
 importCloudReviewEvent({id:'ce_exact',targetId:'rt_1',symbol:'2303',name:'聯電',label:'複判',snapshot:{price:60},context:{},reviewStatus:'GPT_SENT',createdAt:'2026-09-14T02:00:00.000Z'});
 const before={cash:db.portfolio.cash,positions:JSON.stringify(db.positions),trades:JSON.stringify(db.trades),priority:db.watchlist.find(w=>w.symbol==='2303')?.priority};
 const oldUrl=process.env.CLOUD_MONITOR_URL,oldKey=process.env.CLOUD_MONITOR_API_KEY,oldFetch=global.fetch;
 process.env.CLOUD_MONITOR_URL='https://cloud.test';process.env.CLOUD_MONITOR_API_KEY='k'.repeat(64);const calls=[];
 global.fetch=async(url,init={})=>{const u=String(url);calls.push({u,method:init.method||'GET',body:init.body||''});
  if(u.includes('/v1/gpt-bridge/commands?status=PENDING'))return new Response(JSON.stringify([{id:'gc_review',kind:'APPLY_STRATEGY_UPDATE',status:'PENDING',requestedAt:new Date().toISOString(),payload:{summary:'看過，維持策略',reviewEventId:'ce_exact',setups:[{symbol:'2303',action:'NO_CHANGE'}]}}]),{status:200,headers:{'content-type':'application/json'}});
  if(u.endsWith('/v1/monitor/events/ce_exact')&&init.method==='PATCH')return new Response(JSON.stringify({ok:true,id:'ce_exact',status:'COMPLETED'}),{status:200,headers:{'content-type':'application/json'}});
  if(u.endsWith('/v1/gpt-bridge/commands/gc_review')&&init.method==='PATCH')return new Response(JSON.stringify({ok:true,status:'APPLIED'}),{status:200,headers:{'content-type':'application/json'}});
  if(u.endsWith('/v1/monitor/targets'))return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json'}});
  if(u.endsWith('/v1/gpt-bridge/state'))return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json'}});
  throw new Error(`unexpected fetch ${u}`);
 };
 try{
  const x=await reconcileGptCommands();assert.equal(x.applied,1);assert.equal(x.failed,0);assert.equal(listReviewInbox({})[0].reviewStatus,'COMPLETED');
  assert.equal(db.portfolio.cash,before.cash);assert.equal(JSON.stringify(db.positions),before.positions);assert.equal(JSON.stringify(db.trades),before.trades);assert.equal(db.watchlist.find(w=>w.symbol==='2303')?.priority,before.priority);
  assert.ok(calls.some(c=>c.u.endsWith('/v1/monitor/events/ce_exact')&&c.method==='PATCH'&&String(c.body).includes('COMPLETED')));
 }finally{global.fetch=oldFetch;if(oldUrl==null)delete process.env.CLOUD_MONITOR_URL;else process.env.CLOUD_MONITOR_URL=oldUrl;if(oldKey==null)delete process.env.CLOUD_MONITOR_API_KEY;else process.env.CLOUD_MONITOR_API_KEY=oldKey;}
});

test('completed local cloud reviews are retried to Cloud idempotently',async()=>{
 reset();importCloudReviewEvent({id:'ce_retry',targetId:'rt_2',symbol:'2303',snapshot:{price:60},context:{},reviewStatus:'COMPLETED',createdAt:'2026-09-14T02:00:00.000Z'});
 const oldUrl=process.env.CLOUD_MONITOR_URL,oldKey=process.env.CLOUD_MONITOR_API_KEY,oldFetch=global.fetch;process.env.CLOUD_MONITOR_URL='https://cloud.test';process.env.CLOUD_MONITOR_API_KEY='k'.repeat(64);let patched=0;
 global.fetch=async(url,init={})=>{if(String(url).endsWith('/v1/monitor/events/ce_retry')&&init.method==='PATCH'){patched++;return new Response(JSON.stringify({ok:true,id:'ce_retry',status:'COMPLETED'}),{status:200,headers:{'content-type':'application/json'}})}throw new Error(`unexpected fetch ${url}`)};
 try{const x=await syncReviewEventStatuses();assert.equal(x.ok,true);assert.equal(x.count,1);assert.equal(patched,1)}finally{global.fetch=oldFetch;if(oldUrl==null)delete process.env.CLOUD_MONITOR_URL;else process.env.CLOUD_MONITOR_URL=oldUrl;if(oldKey==null)delete process.env.CLOUD_MONITOR_API_KEY;else process.env.CLOUD_MONITOR_API_KEY=oldKey;}
});

test('Backend reconciles private PING diagnostic without touching strategy or Ledger',async()=>{
 reset();const before=JSON.stringify({cash:db.portfolio.cash,positions:db.positions,trades:db.trades,watchlist:db.watchlist,playbooks:db.playbooks,setups:db.setups,reviewTriggers:db.reviewTriggers});
 const oldUrl=process.env.CLOUD_MONITOR_URL,oldKey=process.env.CLOUD_MONITOR_API_KEY,oldFetch=global.fetch;process.env.CLOUD_MONITOR_URL='https://cloud.test';process.env.CLOUD_MONITOR_API_KEY='k'.repeat(64);let ack=null;
 global.fetch=async(url,init={})=>{const u=String(url);if(u.includes('/v1/gpt-bridge/commands?status=PENDING'))return new Response(JSON.stringify([{id:'gc_ping',kind:'PING',status:'PENDING',payload:{nonce:'ping_test'}}]),{status:200,headers:{'content-type':'application/json'}});if(u.endsWith('/v1/gpt-bridge/commands/gc_ping')&&init.method==='PATCH'){ack=JSON.parse(init.body);return new Response(JSON.stringify({status:'APPLIED'}),{status:200,headers:{'content-type':'application/json'}})}if(u.endsWith('/v1/monitor/targets')||u.endsWith('/v1/gpt-bridge/state'))return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json'}});throw new Error(`unexpected fetch ${u}`)};
 try{const x=await reconcileGptCommands();assert.equal(x.applied,1);assert.equal(x.failed,0);assert.equal(ack.status,'APPLIED');assert.equal(JSON.stringify({cash:db.portfolio.cash,positions:db.positions,trades:db.trades,watchlist:db.watchlist,playbooks:db.playbooks,setups:db.setups,reviewTriggers:db.reviewTriggers}),before)}finally{global.fetch=oldFetch;if(oldUrl==null)delete process.env.CLOUD_MONITOR_URL;else process.env.CLOUD_MONITOR_URL=oldUrl;if(oldKey==null)delete process.env.CLOUD_MONITOR_API_KEY;else process.env.CLOUD_MONITOR_API_KEY=oldKey;}
});

test('local backend pulls direct GPT command, applies strategy, acks cloud, and preserves ledger',async()=>{
 reset();
 const before={cash:db.portfolio.cash,positions:JSON.stringify(db.positions),trades:JSON.stringify(db.trades)};
 const oldUrl=process.env.CLOUD_MONITOR_URL,oldKey=process.env.CLOUD_MONITOR_API_KEY,oldFetch=global.fetch;
 process.env.CLOUD_MONITOR_URL='https://cloud.test';process.env.CLOUD_MONITOR_API_KEY='k'.repeat(64);
 const acks=[];
 global.fetch=async(url,init={})=>{
  const u=String(url);
  if(u.includes('/v1/gpt-bridge/commands?status=PENDING'))return new Response(JSON.stringify([{id:'gc_1',kind:'APPLY_STRATEGY_UPDATE',status:'PENDING',requestedAt:new Date().toISOString(),payload:{summary:'direct reconcile',setups:[{symbol:'2303',priority:96,stage:'WAIT_TRIGGER',statusReason:'等61突破',playbook:{breakout:61}}]}}]),{status:200,headers:{'content-type':'application/json'}});
  if(u.endsWith('/v1/gpt-bridge/commands/gc_1')&&init.method==='PATCH'){acks.push(JSON.parse(init.body));return new Response(JSON.stringify({ok:true,status:'APPLIED'}),{status:200,headers:{'content-type':'application/json'}});}
  if(u.endsWith('/v1/monitor/targets'))return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json'}});
  if(u.endsWith('/v1/gpt-bridge/state'))return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json'}});
  throw new Error(`unexpected fetch ${u}`);
 };
 try{
  const x=await reconcileGptCommands();assert.equal(x.applied,1);assert.equal(x.failed,0);
  assert.equal(db.watchlist.find(w=>w.symbol==='2303').priority,96);assert.equal(db.playbooks['2303'].breakout,61);
  assert.equal(db.portfolio.cash,before.cash);assert.equal(JSON.stringify(db.positions),before.positions);assert.equal(JSON.stringify(db.trades),before.trades);
  assert.equal(acks[0].status,'APPLIED');
 }finally{global.fetch=oldFetch;if(oldUrl==null)delete process.env.CLOUD_MONITOR_URL;else process.env.CLOUD_MONITOR_URL=oldUrl;if(oldKey==null)delete process.env.CLOUD_MONITOR_API_KEY;else process.env.CLOUD_MONITOR_API_KEY=oldKey;}
});

test('production roundtrip helper acknowledges only the requested PING and never drains strategy commands',async()=>{
 const oldUrl=process.env.CLOUD_MONITOR_URL,oldKey=process.env.CLOUD_MONITOR_API_KEY,oldFetch=global.fetch;
 process.env.CLOUD_MONITOR_URL='https://cloud.test';process.env.CLOUD_MONITOR_API_KEY='k'.repeat(32);
 const seen=[];
 global.fetch=async(url,init={})=>{
  seen.push({url:String(url),method:init.method||'GET',body:init.body||null});
  if((init.method||'GET')==='GET')return new Response(JSON.stringify({id:'gc_ping',kind:'PING',payload:{nonce:'n1'},status:'PENDING'}),{status:200,headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify({id:'gc_ping',kind:'PING',payload:{nonce:'n1'},status:'APPLIED',result:{ok:true}}),{status:200,headers:{'content-type':'application/json'}});
 };
 try{
  const {reconcileGptPingCommand}=await import('./cloud-monitor.mjs');
  const out=await reconcileGptPingCommand('gc_ping');
  assert.equal(out.ok,true);assert.equal(seen.length,2);
  assert.match(seen[0].url,/\/v1\/gpt-bridge\/commands\/gc_ping$/);assert.equal(seen[0].method,'GET');
  assert.equal(seen[1].method,'PATCH');assert.match(String(seen[1].body),/APPLIED/);
  assert.equal(seen.some(x=>String(x.url).includes('commands?status=PENDING')),false);
 }finally{
  global.fetch=oldFetch;if(oldUrl===undefined)delete process.env.CLOUD_MONITOR_URL;else process.env.CLOUD_MONITOR_URL=oldUrl;if(oldKey===undefined)delete process.env.CLOUD_MONITOR_API_KEY;else process.env.CLOUD_MONITOR_API_KEY=oldKey;
 }
});
