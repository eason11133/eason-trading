import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateConditions,marketOpen,publicEventTokenMatches,cloudRvol,reviewStatusCanAdvance,cloudAuthorized,fugleQuoteFreshness} from './worker.mjs';

test('cloud monitor requires every trigger condition',()=>{
 const c={all:[{field:'price',op:'>=',value:100},{field:'rvol',op:'>=',value:1.5}]};
 assert.equal(evaluateConditions(c,{price:101,rvol:1.6}).matched,true);
 assert.equal(evaluateConditions(c,{price:101,rvol:1.2}).matched,false);
});

test('cloud monitor follows Taipei stock market hours',()=>{
 assert.equal(marketOpen(new Date('2026-09-08T02:00:00Z')),true);
 assert.equal(marketOpen(new Date('2026-09-06T02:00:00Z')),false);
});

test('cloud Fugle quote freshness rejects exchange-holiday/stale prior-session quotes',()=>{
 const at=new Date('2026-09-08T02:00:00Z');
 assert.equal(fugleQuoteFreshness({date:'2026-09-08',lastUpdated:at.getTime()*1000},at).ok,true);
 const old=fugleQuoteFreshness({date:'2026-09-07',lastUpdated:new Date('2026-09-07T05:30:00Z').getTime()*1000},at);assert.equal(old.ok,false);assert.equal(old.reason,'quote_date_mismatch');
 const stale=fugleQuoteFreshness({date:'2026-09-08',lastUpdated:new Date('2026-09-08T01:30:00Z').getTime()*1000},at);assert.equal(stale.ok,false);assert.equal(stale.reason,'stale_quote');
 assert.equal(fugleQuoteFreshness({date:'2026-09-08',isTrial:true,lastUpdated:at.getTime()*1000},at).reason,'trial_quote');
 assert.equal(fugleQuoteFreshness({date:'2026-09-08',tradingHalt:{isHalted:true},lastUpdated:at.getTime()*1000},at).reason,'trading_halted');
});

test('public cloud event handoff requires the exact opaque event token',()=>{
 const token='a'.repeat(64);
 assert.equal(publicEventTokenMatches(token,token),true);
 assert.equal(publicEventTokenMatches(token,'b'.repeat(64)),false);
 assert.equal(publicEventTokenMatches('short','short'),false);
});


test('cloud fallback computes RVOL with the same time-adjusted daily-volume idea',()=>{
 const noon=new Date('2026-09-08T04:00:00Z');
 const avg=10000;
 const r=cloudRvol(10000,avg,noon);
 assert.ok(r>1);
 assert.equal(cloudRvol(10000,null,noon),null);
});


test('cloud review status cannot move backward',()=>{
 assert.equal(reviewStatusCanAdvance('PENDING','GPT_SENT'),true);
 assert.equal(reviewStatusCanAdvance('GPT_SENT','COMPLETED'),true);
 assert.equal(reviewStatusCanAdvance('COMPLETED','GPT_SENT'),false);
 assert.equal(reviewStatusCanAdvance('GPT_SENT','PENDING'),false);
});

import {groupTargetsBySymbol,classifyExpoTickets,buildTestPushMessages} from './worker.mjs';

test('cloud monitor fetch plan groups multiple triggers for the same stock',()=>{
 const g=groupTargetsBySymbol([{id:'a',symbol:'2303'},{id:'b',symbol:'2303'},{id:'c',symbol:'6147'}]);
 assert.equal(g.length,2);assert.equal(g.find(x=>x.symbol==='2303').rows.length,2);
});

test('Expo push ticket classifier disables dead device tokens but keeps successful devices',()=>{
 const x=classifyExpoTickets([{token:'good'},{token:'dead'}],[{status:'ok',id:'ticket'},{status:'error',details:{error:'DeviceNotRegistered'}}]);
 assert.equal(x.ok,1);assert.equal(x.failed,1);assert.deepEqual(x.disabled,['dead']);
});


test('cloud privileged API authentication fails closed when secret is missing',()=>{assert.equal(cloudAuthorized('',''),false);assert.equal(cloudAuthorized('x',''),false);const k='c'.repeat(64);assert.equal(cloudAuthorized(k,k),true);assert.equal(cloudAuthorized('d'.repeat(64),k),false);});


test('cloud test push payload is explicitly non-trading and has no GPT handoff',()=>{
 const [m]=buildTestPushMessages([{token:'ExponentPushToken[test]'}]);
 assert.equal(m.data.type,'CLOUD_PUSH_TEST');
 assert.equal('cloudEventUrl' in m.data,false);
 assert.match(m.body,/不是交易訊號/);
});

import {directGptToolDefinitions,directGptToolNames,normalizeDirectStrategyPayload,gptActionOpenApi} from './worker.mjs';

test('direct GPT cloud tool surface has strategy writes but no ledger write tool',()=>{
 const defs=directGptToolDefinitions();
 assert.deepEqual(defs.map(x=>x.name),directGptToolNames);
 const names=defs.map(x=>x.name).join(' ');
 assert.doesNotMatch(names,/trade|ledger|cash|position_quantity/i);
 const write=defs.find(x=>x.name==='update_trading_strategy');
 assert.equal(write.annotations.readOnlyHint,false);
 assert.match(write.description,/NEVER.*trade/i);
});

test('direct GPT strategy payload rejects ledger-shaped keys',()=>{
 assert.throws(()=>normalizeDirectStrategyPayload({setups:[{symbol:'2303',cash:1000}]}),/forbidden strategy key: cash/);
 const x=normalizeDirectStrategyPayload({summary:'聯電改成等待突破',reviewEventId:'ce_123',setups:[{symbol:'2303',priority:95,playbook:{breakout:60}}]});
 assert.equal(x.setups[0].symbol,'2303');
 assert.equal(x.reviewEventId,'ce_123');
 assert.equal(x.version,1);
});

import {handleMcp} from './worker.mjs';

test('remote MCP tools/list is bearer-authenticated and exposes only the direct strategy surface',async()=>{
 const token='m'.repeat(64),env={MCP_BEARER_TOKEN:token};
 const body={jsonrpc:'2.0',id:1,method:'tools/list',params:{}};
 let r=await handleMcp(new Request('https://example.test/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env);
 assert.equal(r.status,401);
 r=await handleMcp(new Request('https://example.test/mcp',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`,'mcp-protocol-version':'2026-07-28','mcp-method':'tools/list'},body:JSON.stringify(body)}),env);
 assert.equal(r.status,200);const x=await r.json();
 assert.deepEqual(x.result.tools.map(t=>t.name),directGptToolNames);
});

import worker from './worker.mjs';
class FakeStmt{
 constructor(db,sql){this.db=db;this.sql=sql;this.args=[]}
 bind(...args){this.args=args;return this}
 async run(){const q=this.sql.replace(/\s+/g,' ').trim();
  if(q.startsWith('INSERT INTO gpt_bridge_state')){this.db.state={id:'current',payload:this.args[0],source_version:this.args[1],synced_at:this.args[2]};return {meta:{changes:1}}}
  if(q.startsWith('INSERT INTO gpt_strategy_commands')){const [id,kind,payload,requested_at]=this.args;this.db.commands.set(id,{id,kind,payload,status:'PENDING',requested_at,applied_at:null,failed_at:null,error:null,result:null});return {meta:{changes:1}}}
  if(q.startsWith("UPDATE gpt_strategy_commands SET status='APPLIED'")){const [applied_at,result,id]=this.args,r=this.db.commands.get(id);if(r&&r.status==='PENDING')Object.assign(r,{status:'APPLIED',applied_at,result,error:null});return {meta:{changes:r?1:0}}}
  if(q.startsWith("UPDATE gpt_strategy_commands SET status='FAILED'")){const [failed_at,error,id]=this.args,r=this.db.commands.get(id);if(r&&r.status==='PENDING')Object.assign(r,{status:'FAILED',failed_at,error});return {meta:{changes:r?1:0}}}
  if(q.startsWith('UPDATE monitor_events SET review_status=?,updated_at=? WHERE id=? AND review_status=?')){const [status,updated,id,expected]=this.args,r=this.db.events.get(id);const ok=r&&r.review_status===expected;if(ok)Object.assign(r,{review_status:status,updated_at:updated});return {meta:{changes:ok?1:0}}}
  if(q.startsWith('UPDATE monitor_events SET updated_at=? WHERE id=?')){const [updated,id]=this.args,r=this.db.events.get(id);if(r)r.updated_at=updated;return {meta:{changes:r?1:0}}}
  if(q.startsWith('UPDATE monitor_events SET review_status=?,updated_at=? WHERE id=?')){const [status,updated,id]=this.args,r=this.db.events.get(id);if(r)Object.assign(r,{review_status:status,updated_at:updated});return {meta:{changes:r?1:0}}}
  throw new Error(`FakeDB run unsupported: ${q}`);
 }
 async first(){const q=this.sql.replace(/\s+/g,' ').trim();
  if(q.includes("FROM gpt_bridge_state WHERE id='current'"))return this.db.state;
  if(q.includes('FROM gpt_strategy_commands WHERE id=?'))return this.db.commands.get(this.args[0])||null;
  if(q.includes('COUNT(*) AS c FROM devices'))return {c:0};
  if(q.includes('COUNT(*) AS c FROM monitor_events'))return {c:0};
  if(q.includes("COUNT(*) AS c FROM gpt_strategy_commands WHERE status='PENDING'"))return {c:[...this.db.commands.values()].filter(x=>x.status==='PENDING').length};
  if(q.includes("COUNT(*) AS c FROM gpt_strategy_commands WHERE status='FAILED'"))return {c:[...this.db.commands.values()].filter(x=>x.status==='FAILED').length};
  if(q==='SELECT * FROM monitor_events WHERE id=?')return this.db.events.get(this.args[0])||null;
  if(q==='SELECT review_status FROM monitor_events WHERE id=?'){const r=this.db.events.get(this.args[0]);return r?{review_status:r.review_status}:null}
  if(q.includes("FROM monitor_events WHERE review_status IN ('PENDING','GPT_SENT') ORDER BY CASE")){return [...this.db.events.values()].filter(x=>['PENDING','GPT_SENT'].includes(x.review_status)).sort((a,b)=>{const ar=a.review_status==='GPT_SENT'?0:1,br=b.review_status==='GPT_SENT'?0:1;if(ar!==br)return ar-br;return String(b.updated_at).localeCompare(String(a.updated_at))||String(b.created_at).localeCompare(String(a.created_at));})[0]||null}
  throw new Error(`FakeDB first unsupported: ${q}`);
 }
 async all(){const q=this.sql.replace(/\s+/g,' ').trim();
  if(q.startsWith('SELECT * FROM gpt_strategy_commands WHERE status=?')){const [status,limit]=this.args;return {results:[...this.db.commands.values()].filter(x=>x.status===status).slice(0,Number(limit)||20)}}
  throw new Error(`FakeDB all unsupported: ${q}`);
 }
}
class FakeDB{constructor(){this.state=null;this.commands=new Map();this.events=new Map()}prepare(sql){return new FakeStmt(this,sql)}async batch(stmts){for(const s of stmts)await s.run();return []}}

async function rpc(env,token,method,params={}){
 const r=await worker.fetch(new Request('https://bridge.test/mcp',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`,'mcp-protocol-version':'2026-07-28','mcp-method':method,...(params.name?{'mcp-name':params.name}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),env,{});return {status:r.status,body:await r.json()};
}

test('private Cloud-to-Backend roundtrip diagnostic queues and exposes a non-mutating PING command',async()=>{
 const key='c'.repeat(64),env={DB:new FakeDB(),TRADING_API_KEY:key,MCP_BEARER_TOKEN:'m'.repeat(64),PUBLIC_BASE_URL:'https://bridge.test'};
 let r=await worker.fetch(new Request('https://bridge.test/v1/gpt-bridge/roundtrip-test',{method:'POST',headers:{'x-api-key':key,'content-type':'application/json'},body:'{}'}),env,{});assert.equal(r.status,201);const x=await r.json();assert.equal(x.ok,true);assert.equal(x.command.kind,'PING');
 r=await worker.fetch(new Request(`https://bridge.test/v1/gpt-bridge/commands/${x.command.id}`,{headers:{'x-api-key':key}}),env,{});assert.equal(r.status,200);const c=await r.json();assert.equal(c.kind,'PING');assert.equal(c.status,'PENDING');assert.equal(c.payload.nonce,x.nonce);
});

test('direct GPT bridge closes state-read -> strategy-command -> local-ack loop without ledger tools',async()=>{
 const cloudKey='c'.repeat(64),mcpToken='m'.repeat(64),env={DB:new FakeDB(),TRADING_API_KEY:cloudKey,MCP_BEARER_TOKEN:mcpToken,PUBLIC_BASE_URL:'https://bridge.test'};
 let r=await worker.fetch(new Request('https://bridge.test/v1/gpt-bridge/state',{method:'PUT',headers:{'content-type':'application/json','x-api-key':cloudKey},body:JSON.stringify({sourceVersion:'0.3.16',state:{schemaVersion:1,positions:[{symbol:'2303',quantity:100}],radar:[{symbol:'2303',priority:90}],reviewTriggers:[]}})}),env,{});
 assert.equal(r.status,200);
 let x=await rpc(env,mcpToken,'tools/call',{name:'get_trading_state',arguments:{}});assert.equal(x.body.result.structuredContent.connected,true);assert.equal(x.body.result.structuredContent.state.positions[0].symbol,'2303');
 x=await rpc(env,mcpToken,'tools/call',{name:'update_trading_strategy',arguments:{summary:'升級聯電',setups:[{symbol:'2303',priority:99,playbook:{breakout:61}}]}});assert.equal(x.body.result.structuredContent.queued,true);const commandId=x.body.result.structuredContent.command.id;
 r=await worker.fetch(new Request('https://bridge.test/v1/gpt-bridge/commands?status=PENDING',{headers:{'x-api-key':cloudKey}}),env,{});let commands=await r.json();assert.equal(commands.length,1);assert.equal(commands[0].id,commandId);assert.equal(commands[0].payload.setups[0].priority,99);
 r=await worker.fetch(new Request(`https://bridge.test/v1/gpt-bridge/commands/${commandId}`,{method:'PATCH',headers:{'content-type':'application/json','x-api-key':cloudKey},body:JSON.stringify({status:'APPLIED',result:{ok:true}})}),env,{});assert.equal((await r.json()).status,'APPLIED');
 x=await rpc(env,mcpToken,'tools/call',{name:'get_strategy_command_status',arguments:{commandId}});assert.equal(x.body.result.structuredContent.command.status,'APPLIED');
});

test('GPT Action schema lets GPT express safe smart-trigger persistence, cooldown, and review correlation',()=>{
 const schema=gptActionOpenApi('https://bridge.test');
 const action=schema.paths['/v1/gpt-action/strategy'].post.requestBody.content['application/json'].schema;
 const trigger=action.properties.setups.items.properties.reviewTriggers.items;
 assert.equal(action.properties.reviewEventId.type,'string');
 assert.equal(trigger.properties.policy.properties.oneShot.type,'boolean');
 assert.equal(trigger.properties.policy.properties.minConsecutive.maximum,5);
 assert.equal(trigger.properties.policy.properties.cooldownMinutes.maximum,1440);
 assert.equal(trigger.additionalProperties,false);
});

test('tapping an older cloud notification makes that exact event the default GPT review event',async()=>{
 const cloudKey='c'.repeat(64),token='m'.repeat(64),env={DB:new FakeDB(),TRADING_API_KEY:cloudKey,MCP_BEARER_TOKEN:token,PUBLIC_BASE_URL:'https://bridge.test'};
 const base={target_id:'rt',name:'測試',label:'review',reasons:'[]',snapshot:'{}',context:'{}',push_status:'SENT',push_attempts:1,last_push_error:null,last_push_at:null};
 env.DB.events.set('older',{...base,id:'older',symbol:'2303',access_token:'a'.repeat(64),review_status:'PENDING',created_at:'2026-09-14T01:00:00.000Z',updated_at:'2026-09-14T01:00:00.000Z'});
 env.DB.events.set('newer',{...base,id:'newer',symbol:'2337',access_token:'b'.repeat(64),review_status:'PENDING',created_at:'2026-09-14T01:05:00.000Z',updated_at:'2026-09-14T01:05:00.000Z'});
 let r=await worker.fetch(new Request(`https://bridge.test/v1/monitor/events/older/handoff?token=${'a'.repeat(64)}`),env,{});assert.equal(r.status,200);assert.equal((await r.json()).event.id,'older');
 r=await worker.fetch(new Request('https://bridge.test/v1/gpt-action/review-event',{headers:{authorization:`Bearer ${token}`}}),env,{});assert.equal(r.status,200);const x=await r.json();assert.equal(x.event.id,'older');assert.equal(x.event.reviewStatus,'GPT_SENT');
});

test('GPT Action queues reviewEventId so NO_CHANGE can complete the exact review',async()=>{
 const token='m'.repeat(64),env={DB:new FakeDB(),TRADING_API_KEY:'c'.repeat(64),MCP_BEARER_TOKEN:token,PUBLIC_BASE_URL:'https://bridge.test'};
 const r=await worker.fetch(new Request('https://bridge.test/v1/gpt-action/strategy',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({summary:'看過，策略不變',reviewEventId:'ce_exact',waitForApplySeconds:0,setups:[{symbol:'2303',action:'NO_CHANGE'}]})}),env,{});
 assert.equal(r.status,200);const cmd=[...env.DB.commands.values()][0];const payload=JSON.parse(cmd.payload);assert.equal(payload.reviewEventId,'ce_exact');assert.equal(payload.setups[0].action,'NO_CHANGE');
});

test('GPT Action REST/OpenAPI uses the same bearer auth and strategy-only command queue',async()=>{
 const cloudKey='c'.repeat(64),token='m'.repeat(64),env={DB:new FakeDB(),TRADING_API_KEY:cloudKey,MCP_BEARER_TOKEN:token,PUBLIC_BASE_URL:'https://bridge.test'};
 let r=await worker.fetch(new Request('https://bridge.test/gpt-action-openapi.json'),env,{});assert.equal(r.status,200);let schema=await r.json();assert.ok(schema.paths['/v1/gpt-action/strategy']);assert.ok(schema.paths['/v1/gpt-action/readiness']);assert.match(schema.info.description,/cannot modify cash/i);
 r=await worker.fetch(new Request('https://bridge.test/gpt-action-instructions.txt'),env,{});assert.equal(r.status,200);assert.match(await r.text(),/Do not ask the user to copy EASON_TRADING_UPDATE_V1/);
 r=await worker.fetch(new Request('https://bridge.test/privacy'),env,{});assert.equal(r.status,200);assert.match(await r.text(),/cannot create trades/i);
 r=await worker.fetch(new Request('https://bridge.test/v1/gpt-action/strategy',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({setups:[{symbol:'2303',priority:91}]})}),env,{});assert.equal(r.status,401);
 r=await worker.fetch(new Request('https://bridge.test/v1/gpt-action/readiness',{headers:{'authorization':`Bearer ${token}`}}),env,{});assert.equal(r.status,200);const ready=await r.json();assert.equal(ready.connected,false);assert.equal(ready.pendingCommands,0);
 r=await worker.fetch(new Request('https://bridge.test/v1/gpt-action/strategy',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`},body:JSON.stringify({summary:'action path',waitForApplySeconds:0,setups:[{symbol:'2303',priority:91}]})}),env,{});assert.equal(r.status,200);const x=await r.json();assert.equal(x.queued,true);assert.equal([...env.DB.commands.values()][0].payload.includes('"priority":91'),true);
});

test('GPT Action readiness reports fresh app heartbeat as online and stale heartbeat as offline',async()=>{
 const cloudKey='c'.repeat(64),token='m'.repeat(64),env={DB:new FakeDB(),TRADING_API_KEY:cloudKey,MCP_BEARER_TOKEN:token,PUBLIC_BASE_URL:'https://bridge.test'};
 env.DB.state={id:'current',payload:JSON.stringify({radar:[]}),source_version:'0.3.16',synced_at:new Date().toISOString()};
 let r=await worker.fetch(new Request('https://bridge.test/v1/gpt-action/readiness',{headers:{authorization:`Bearer ${token}`}}),env,{});let x=await r.json();assert.equal(x.appOnline,true);assert.equal(x.sourceVersion,'0.3.16');
 env.DB.state.synced_at=new Date(Date.now()-120000).toISOString();
 r=await worker.fetch(new Request('https://bridge.test/v1/gpt-action/readiness',{headers:{authorization:`Bearer ${token}`}}),env,{});x=await r.json();assert.equal(x.appOnline,false);assert.ok(x.stateAgeSeconds>=119);
});

test('GPT Action write can wait for local Backend acknowledgement and return applied=true',async()=>{
 const token='m'.repeat(64),env={DB:new FakeDB(),TRADING_API_KEY:'c'.repeat(64),MCP_BEARER_TOKEN:token,PUBLIC_BASE_URL:'https://bridge.test'};
 const originalPrepare=env.DB.prepare.bind(env.DB);
 env.DB.prepare=(sql)=>{
  const stmt=originalPrepare(sql);
  if(sql.replace(/\s+/g,' ').trim().startsWith('INSERT INTO gpt_strategy_commands')){
   const originalRun=stmt.run.bind(stmt);
   stmt.run=async()=>{const out=await originalRun();const id=stmt.args[0];setTimeout(()=>{const row=env.DB.commands.get(id);if(row&&row.status==='PENDING'){row.status='APPLIED';row.applied_at=new Date().toISOString();row.result=JSON.stringify({ok:true});}},20);return out;};
  }
  return stmt;
 };
 const r=await worker.fetch(new Request('https://bridge.test/v1/gpt-action/strategy',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({summary:'wait apply',waitForApplySeconds:1,setups:[{symbol:'2303',priority:93}]})}),env,{});
 assert.equal(r.status,200);const x=await r.json();assert.equal(x.applied,true);assert.equal(x.queued,false);assert.equal(x.command.status,'APPLIED');
});

import {advanceCloudTarget} from './worker.mjs';
import {advanceSmartTrigger} from '../../shared/smart-trigger.mjs';

test('cloud and local smart-trigger state machine stay in parity',()=>{
 const trigger={conditions:{all:[{field:'price',op:'>=',value:100},{field:'rvol',op:'>=',value:1.2}],invalidation:{any:[{field:'price',op:'<=',value:90}]}},policy:{oneShot:false,minConsecutive:2,cooldownMinutes:5},playbookVersion:4,runtime:{}};
 const context={playbook:{version:4,invalid:90},triggerPolicy:trigger.policy,playbookVersion:4};
 const ticks=[
  ['2026-09-14T01:00:00Z',{price:101,rvol:1.3}],
  ['2026-09-14T01:01:00Z',{price:102,rvol:1.4}],
  ['2026-09-14T01:02:00Z',{price:103,rvol:1.5}],
  ['2026-09-14T01:03:00Z',{price:98,rvol:1.0}],
  ['2026-09-14T01:07:00Z',{price:101,rvol:1.4}],
  ['2026-09-14T01:08:00Z',{price:102,rvol:1.4}]
 ];
 let local={...trigger},cloud={...trigger};
 for(const [time,snapshot] of ticks){
  const a=advanceSmartTrigger(local,snapshot,context,new Date(time));
  const b=advanceCloudTarget(cloud,snapshot,context,new Date(time));
  assert.equal(b.matched,a.matched);assert.equal(b.summary,a.summary);assert.deepEqual(b.runtime,a.runtime);
  local={...local,runtime:a.runtime};cloud={...cloud,runtime:b.runtime};
 }
});

test('cloud smart trigger does not notify on price zone if invalidation already fired',()=>{
 const t={conditions:{all:[{field:'price',op:'<=',value:60}]},purpose:'REVIEW',policy:{oneShot:true},runtime:{}};
 const x=advanceCloudTarget(t,{price:56.5,rvol:0.8},{playbook:{invalid:57}},new Date('2026-09-14T01:00:00Z'));
 assert.equal(x.matched,false);assert.equal(x.blockedByInvalidation,true);
});

test('cloud smart trigger suppresses repeated ticks in the same qualifying state',()=>{
 const t={conditions:{all:[{field:'price',op:'>=',value:50}]},policy:{oneShot:false},runtime:{}};
 const a=advanceCloudTarget(t,{price:51},{},new Date('2026-09-14T01:00:00Z'));assert.equal(a.matched,true);
 const b=advanceCloudTarget({...t,runtime:a.runtime},{price:52},{},new Date('2026-09-14T01:01:00Z'));assert.equal(b.matched,false);
});
