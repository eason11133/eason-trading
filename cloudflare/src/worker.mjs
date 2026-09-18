import { advanceSmartTrigger, evaluateSmartTrigger, normalizeSmartConditions, normalizeTriggerPolicy } from '../../shared/smart-trigger.mjs';
const FUGLE='https://api.fugle.tw/marketdata/v1.0/stock';
const cors={
 'access-control-allow-origin':'*',
 'access-control-allow-headers':'content-type,x-api-key,authorization,mcp-protocol-version,mcp-method,mcp-name',
 'access-control-allow-methods':'GET,PUT,POST,PATCH,OPTIONS'
};
const json=(x,status=200)=>new Response(status===204?null:JSON.stringify(x),{status,headers:{'content-type':'application/json; charset=utf-8',...cors}});
const now=()=>new Date().toISOString();
const uid=p=>`${p}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
export const cloudAuthorized=(provided,configured)=>String(configured||'').length>=20&&String(provided||'')===String(configured);
const auth=(req,env)=>cloudAuthorized(req.headers.get('x-api-key'),env.TRADING_API_KEY);
const parse=x=>{try{return JSON.parse(x)}catch{return null}};
const tp=(date=new Date())=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'}).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
const taipeiDate=(date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function fugleQuoteFreshness(q,at=new Date()){
 const quoteDate=String(q?.date||'').trim();
 if(!quoteDate)return {ok:false,reason:'missing_quote_date'};
 const expected=taipeiDate(at);if(quoteDate!==expected)return {ok:false,reason:'quote_date_mismatch',quoteDate,expected};
 if(q?.isTrial===true)return {ok:false,reason:'trial_quote',quoteDate,expected};
 if(q?.tradingHalt?.isHalted===true)return {ok:false,reason:'trading_halted',quoteDate,expected};
 const raw=Number(q?.lastUpdated??q?.total?.time??q?.lastTrade?.time);
 let updatedAt=null,ageSeconds=null;
 if(Number.isFinite(raw)&&raw>0){const ms=raw>1e14?raw/1000:raw>1e11?raw:raw*1000;const d=new Date(ms);if(Number.isFinite(d.getTime())){updatedAt=d.toISOString();ageSeconds=Math.max(0,(at.getTime()-d.getTime())/1000);}}
 // During an open session a quote older than 15 minutes is too stale to trigger a trading review.
 if(ageSeconds!=null&&ageSeconds>15*60)return {ok:false,reason:'stale_quote',quoteDate,expected,updatedAt,ageSeconds};
 return {ok:true,quoteDate,expected,updatedAt,ageSeconds};
}

export const marketOpen=(date=new Date())=>{
 const p=tp(date),m=Number(p.hour)*60+Number(p.minute);
 return !['Sat','Sun'].includes(p.weekday)&&m>=9*60&&m<=13*60+30;
};
export const sessionFraction=(date=new Date())=>{
 const p=tp(date),m=Number(p.hour)*60+Number(p.minute),start=9*60,end=13*60+30;
 if(m<=start)return 0.05;if(m>=end)return 1;return Math.max(0.05,Math.min(1,(m-start)/(end-start)));
};
export function cloudRvol(volume,avgDailyVolume,date=new Date()){
 const v=Number(volume),avg=Number(avgDailyVolume);if(!(avg>0)||!(v>=0))return null;
 const expected=Math.max(1,avg*sessionFraction(date));return Number((v/expected).toFixed(2));
}
async function all(env,sql,...args){return (await env.DB.prepare(sql).bind(...args).all()).results||[];}
async function one(env,sql,...args){return env.DB.prepare(sql).bind(...args).first();}
async function fugleQuote(env,symbol){
 if(!env.FUGLE_API_KEY)throw new Error('FUGLE_API_KEY not set');
 const r=await fetch(`${FUGLE}/intraday/quote/${encodeURIComponent(symbol)}`,{headers:{'X-API-KEY':env.FUGLE_API_KEY}});
 if(!r.ok)throw new Error(`Fugle ${r.status}`);
 const q=await r.json();const checkedAt=new Date();const freshness=fugleQuoteFreshness(q,checkedAt);
 if(!freshness.ok)throw new Error(`Fugle quote not current: ${freshness.reason}${freshness.quoteDate?` (${freshness.quoteDate})`:''}`);
 const price=Number(q.lastPrice??q.closePrice),prev=Number(q.previousClose??q.referencePrice),volume=Number(q.total?.tradeVolume??q.tradeVolume??0);
 if(!(price>0))throw new Error('Fugle quote has no valid price');
 return {
  symbol:q.symbol||symbol,name:q.name||symbol,price,
  high:Number(q.highPrice??price),low:Number(q.lowPrice??price),vwap:Number(q.avgPrice??price),
  changePct:Number.isFinite(Number(q.changePercent))?Number(q.changePercent):(prev?((price/prev)-1)*100:0),
  volume,source:'fugle-rest',quoteDate:freshness.quoteDate,updatedAt:freshness.updatedAt||checkedAt.toISOString(),checkedAt:checkedAt.toISOString()
 };
}
export function evaluateConditions(conditions,snapshot,context={},meta={}){
 return evaluateSmartTrigger({conditions,purpose:meta.purpose||context?.triggerPurpose||'REVIEW',playbookVersion:meta.playbookVersion??context?.playbookVersion??null},snapshot,context);
}
export function advanceCloudTarget(target,snapshot,context={},at=new Date()){
 const runtime=parse(target?.runtime)||target?.runtime||{};
 return advanceSmartTrigger({conditions:target?.conditions||{},purpose:target?.purpose||context?.triggerPurpose||'REVIEW',playbookVersion:target?.playbookVersion??target?.playbook_version??context?.playbookVersion??null,policy:normalizeTriggerPolicy(target?.policy||context?.triggerPolicy||{}),runtime},snapshot,context,at);
}
export function reviewStatusCanAdvance(current,next){
 const rank={PENDING:0,GPT_SENT:1,COMPLETED:2};
 return next in rank && (current in rank ? rank[next]>=rank[current] : true);
}
export function publicEventTokenMatches(stored,provided){
 const a=String(stored||''),b=String(provided||'');
 return a.length>=20&&a===b;
}
function safeEvent(r){
 return {
  id:r.id,targetId:r.target_id,symbol:r.symbol,name:r.name,label:r.label,
  reasons:parse(r.reasons)||[],snapshot:parse(r.snapshot)||{},context:parse(r.context)||{},
  reviewStatus:r.review_status,pushStatus:r.push_status||'UNKNOWN',pushAttempts:Number(r.push_attempts||0),lastPushError:r.last_push_error||null,lastPushAt:r.last_push_at||null,
  createdAt:r.created_at,updatedAt:r.updated_at
 };
}
export function groupTargetsBySymbol(targets=[]){
 const out=new Map();for(const t of targets){const k=String(t.symbol);if(!out.has(k))out.set(k,[]);out.get(k).push(t);}return [...out.entries()].map(([symbol,rows])=>({symbol,rows}));
}
export function classifyExpoTickets(devices=[],tickets=[]){
 const disabled=[];const errors=[];let ok=0;
 for(let i=0;i<devices.length;i++){
  const ticket=tickets[i]||{};
  if(ticket.status==='ok'){ok++;continue;}
  const code=String(ticket?.details?.error||ticket?.message||'UNKNOWN_PUSH_ERROR');
  errors.push(`${devices[i]?.token||'device'}:${code}`);
  if(code==='DeviceNotRegistered')disabled.push(devices[i]?.token);
 }
 return {ok,failed:Math.max(0,devices.length-ok),disabled:disabled.filter(Boolean),errors};
}
export function buildTestPushMessages(devices=[]){
 return devices.slice(0,100).map(d=>({to:d.token,title:'✅ Eason Trading 雲端通知測試',body:'Cloud Monitor → 手機 Push 已成功送出測試要求。這不是交易訊號。',data:{type:'CLOUD_PUSH_TEST'},sound:'default',channelId:'radar'}));
}
async function sendTestPush(env){
 const devs=await all(env,'SELECT token FROM devices WHERE enabled=1');
 if(!devs.length)return {ok:false,noDevice:true,sent:0,failed:0,disabled:[]};
 try{
  const r=await fetch('https://exp.host/--/api/v2/push/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(buildTestPushMessages(devs))});
  if(!r.ok)throw new Error(`Expo push HTTP ${r.status}`);
  const body=await r.json();const tickets=Array.isArray(body?.data)?body.data:[body?.data].filter(Boolean);const x=classifyExpoTickets(devs.slice(0,100),tickets);
  if(x.disabled.length)await env.DB.batch(x.disabled.map(token=>env.DB.prepare('UPDATE devices SET enabled=0,updated_at=? WHERE token=?').bind(now(),token)));
  return {ok:x.ok>0,sent:x.ok,failed:x.failed,disabled:x.disabled,errors:x.errors};
 }catch(e){return {ok:false,sent:0,failed:devs.length,disabled:[],errors:[String(e?.message||e).slice(0,1000)]};}
}
async function deliverPush(env,event){
 const devs=await all(env,'SELECT token,stock_chat_url FROM devices WHERE enabled=1');
 if(!devs.length){await env.DB.prepare("UPDATE monitor_events SET push_status='NO_DEVICE',last_push_error='no enabled push device',last_push_at=? WHERE id=?").bind(now(),event.id).run();return {ok:false,noDevice:true};}
 const base=String(env.PUBLIC_BASE_URL||'').replace(/\/$/,'');
 const messages=devs.slice(0,100).map(d=>({to:d.token,title:`⚡ ${event.name||event.symbol} 值得重新判斷`,body:event.decisionSummary||event.context?.decisionSummary||event.label,data:{type:'GPT_REVIEW_CLOUD',symbol:event.symbol,cloudEventUrl:base?`${base}/v1/monitor/events/${encodeURIComponent(event.id)}/handoff?token=${encodeURIComponent(event.accessToken)}`:'',stockChatUrl:d.stock_chat_url||''},sound:'default',channelId:'radar'}));
 try{
  const r=await fetch('https://exp.host/--/api/v2/push/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(messages)});
  if(!r.ok)throw new Error(`Expo push HTTP ${r.status}`);
  const body=await r.json();const tickets=Array.isArray(body?.data)?body.data:[body?.data].filter(Boolean);const classified=classifyExpoTickets(devs.slice(0,100),tickets);
  if(classified.disabled.length)await env.DB.batch(classified.disabled.map(token=>env.DB.prepare('UPDATE devices SET enabled=0,updated_at=? WHERE token=?').bind(now(),token)));
  const success=classified.ok>0;const err=classified.errors.join('; ').slice(0,1000)||null;
  await env.DB.prepare('UPDATE monitor_events SET push_status=?,push_attempts=push_attempts+1,last_push_error=?,last_push_at=? WHERE id=?').bind(success?'SENT':'FAILED',err,now(),event.id).run();
  return {ok:success,...classified};
 }catch(e){const msg=String(e?.message||e).slice(0,1000);await env.DB.prepare("UPDATE monitor_events SET push_status='FAILED',push_attempts=push_attempts+1,last_push_error=?,last_push_at=? WHERE id=?").bind(msg,now(),event.id).run();return {ok:false,error:msg};}
}
async function retryPendingPushes(env){
 const cutoff=new Date(Date.now()-24*60*60*1000).toISOString();
 const rows=await all(env,"SELECT * FROM monitor_events WHERE review_status='PENDING' AND push_status!='SENT' AND push_attempts<8 AND created_at>? ORDER BY created_at ASC LIMIT 30",cutoff);
 for(const r of rows){const ctx=parse(r.context)||{};await deliverPush(env,{id:r.id,symbol:r.symbol,name:r.name,label:r.label,decisionSummary:ctx.decisionSummary,context:ctx,accessToken:r.access_token});}
 return rows.length;
}
async function syncTargets(req,env){
 const x=await req.json();if(!Array.isArray(x.targets))return json({error:'targets required'},400);
 const seen=new Set();const stmts=[];
 for(const t of x.targets){
  if(!t?.id||!t?.symbol)return json({error:'invalid target'},400);try{normalizeSmartConditions(t?.conditions||{})}catch(e){return json({error:`invalid target: ${e.message}`},400);}
  seen.add(String(t.id));
  stmts.push(env.DB.prepare(`INSERT INTO monitor_targets(id,symbol,name,label,conditions,context,status,playbook_version,expires_at,synced_at,fired_at,runtime)
   VALUES(?,?,?,?,?,?,'ARMED',?,?,?,NULL,'{}')
   ON CONFLICT(id) DO UPDATE SET symbol=excluded.symbol,name=excluded.name,label=excluded.label,conditions=excluded.conditions,context=excluded.context,
   status=CASE WHEN monitor_targets.status='FIRED' THEN monitor_targets.status ELSE 'ARMED' END,
   playbook_version=excluded.playbook_version,expires_at=excluded.expires_at,synced_at=excluded.synced_at`)
   .bind(String(t.id),String(t.symbol),t.name||String(t.symbol),t.label||'GPT 複判',JSON.stringify(t.conditions),JSON.stringify(t.context||{}),t.playbookVersion??null,t.expiresAt||null,now()));
 }
 if(stmts.length)await env.DB.batch(stmts);
 const existing=await all(env,"SELECT id FROM monitor_targets WHERE status='ARMED'");
 const stale=existing.filter(r=>!seen.has(String(r.id)));
 if(stale.length)await env.DB.batch(stale.map(r=>env.DB.prepare("UPDATE monitor_targets SET status='CANCELLED',synced_at=? WHERE id=?").bind(now(),r.id)));
 return json({ok:true,armed:seen.size,cancelled:stale.length});
}
async function scheduled(env){
 await retryPendingPushes(env);
 if(!env.FUGLE_API_KEY||!marketOpen())return;
 const targets=await all(env,"SELECT * FROM monitor_targets WHERE status='ARMED' AND (expires_at IS NULL OR expires_at>?) ORDER BY synced_at DESC LIMIT 60",now());
 const groups=groupTargetsBySymbol(targets);
 for(let i=0;i<groups.length;i+=6){
  await Promise.all(groups.slice(i,i+6).map(async group=>{
   try{
    const baseSnapshot=await fugleQuote(env,group.symbol);
    for(const t of group.rows){
     const snapshot={...baseSnapshot};const ctx=parse(t.context)||{};const tickAt=new Date();const rvol=cloudRvol(snapshot.volume,ctx?.rvolBaseline?.avgDailyVolume,tickAt);if(rvol!=null)snapshot.rvol=rvol;
     const conditions=parse(t.conditions)||{};const policy=normalizeTriggerPolicy(ctx?.triggerPolicy||{});const result=advanceCloudTarget({conditions,purpose:ctx.triggerPurpose||'REVIEW',playbookVersion:t.playbook_version,policy,runtime:parse(t.runtime)||{}},snapshot,ctx,tickAt);
     const runtimeJson=JSON.stringify(result.runtime||{});if(runtimeJson!==String(t.runtime||'{}'))await env.DB.prepare("UPDATE monitor_targets SET runtime=? WHERE id=? AND status='ARMED'").bind(runtimeJson,t.id).run();
     if(!result.matched)continue;
     const fired=now();const claim=result.policy?.oneShot!==false
      ?await env.DB.prepare("UPDATE monitor_targets SET status='FIRED',fired_at=?,runtime=? WHERE id=? AND status='ARMED'").bind(fired,runtimeJson,t.id).run()
      :await env.DB.prepare("UPDATE monitor_targets SET fired_at=?,runtime=? WHERE id=? AND status='ARMED'").bind(fired,runtimeJson,t.id).run();
     if(!claim.meta?.changes)continue;
     const accessToken=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
     const eventContext={...ctx,decisionSummary:result.summary,decisionEvidence:result.evidence,triggerPolicy:result.policy,triggerRuntime:result.runtime};const e={id:uid('ce'),targetId:t.id,symbol:t.symbol,name:t.name,label:t.label,reasons:result.reasons,decisionSummary:result.summary,snapshot,context:eventContext,accessToken,reviewStatus:'PENDING',createdAt:fired,updatedAt:fired};
     await env.DB.prepare("INSERT INTO monitor_events(id,target_id,symbol,name,label,reasons,snapshot,context,access_token,review_status,push_status,push_attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'PENDING',0,?,?)")
       .bind(e.id,e.targetId,e.symbol,e.name,e.label,JSON.stringify(e.reasons),JSON.stringify(e.snapshot),JSON.stringify(e.context),e.accessToken,e.reviewStatus,e.createdAt,e.updatedAt).run();
     await deliverPush(env,e);
    }
   }catch(e){console.log('monitor',group.symbol,e?.message||e);}
  }));
 }
}
async function publicEvent(req,env,u,p){
 const m=p.match(/^\/v1\/monitor\/events\/([^/]+)\/handoff$/);if(!m)return null;
 const id=decodeURIComponent(m[1]);const r=await one(env,'SELECT * FROM monitor_events WHERE id=?',id);if(!r)return json({error:'not found'},404);
 if(!publicEventTokenMatches(r.access_token,u.searchParams.get('token')))return json({error:'unauthorized'},401);
 const updated=now();
 if(r.review_status==='PENDING'){
  await env.DB.prepare('UPDATE monitor_events SET review_status=?,updated_at=? WHERE id=? AND review_status=?').bind('GPT_SENT',updated,id,'PENDING').run();
  r.review_status='GPT_SENT';
 }else{
  // Touch the exact opened event so getLatestReviewEvent can resolve the notification the user actually tapped.
  await env.DB.prepare('UPDATE monitor_events SET updated_at=? WHERE id=?').bind(updated,id).run();
 }
 r.updated_at=updated;
 return json({ok:true,event:safeEvent(r),monitorOnly:true});
}


export const directGptToolNames=['get_trading_state','get_stock_strategy','get_active_handoff','get_latest_review_event','get_close_review_package','update_trading_strategy','undo_last_strategy_update','get_strategy_command_status'];
export const mcpAuthorized=(req,env)=>{
 const configured=String(env.MCP_BEARER_TOKEN||'');
 const authz=String(req.headers.get('authorization')||'');
 const bearer=authz.toLowerCase().startsWith('bearer ')?authz.slice(7):'';
 return cloudAuthorized(bearer,configured);
};
const setupStages=['NEW_DISCOVERY','WAIT_TRIGGER','TRIGGERED_NO_ENTRY','WAIT_PULLBACK','READY','RECONFIRM','LOW_PRIORITY','POSITION_MANAGEMENT','CLOSED_POSITION','INVALIDATED','EXPIRED','ARCHIVED'];
const ratings=['A','A-','B+','B','B-'];
const selectionValidity=['UNREVIEWED','VALIDATED','PARTIAL','FAILED'];
const entryOpportunity=['WAITING','GOOD','MARGINAL','BAD','MISSED','NOT_APPLICABLE'];
const triggerFields=['price','rvol','vwap','high','low','changePct'];
const triggerOps=['>=','>','<=','<','=='];
const symbolSchema={type:'string',pattern:'^[0-9]{4,6}$'};
const triggerPredicateSchema={type:'object',additionalProperties:false,properties:{field:{type:'string',enum:triggerFields},op:{type:'string',enum:triggerOps},value:{type:'number'}},required:['field','op','value']};
const triggerGroupSchema={type:'object',additionalProperties:false,properties:{all:{type:'array',minItems:1,items:triggerPredicateSchema},any:{type:'array',minItems:1,items:triggerPredicateSchema}}};
const triggerPolicySchema={type:'object',additionalProperties:false,properties:{oneShot:{type:'boolean',default:true},minConsecutive:{type:'integer',minimum:1,maximum:5,default:1},cooldownMinutes:{type:'number',minimum:0,maximum:1440,default:0}}};
const triggerSchema={type:'object',additionalProperties:false,properties:{label:{type:'string'},purpose:{type:'string',enum:['REVIEW','INVALIDATION','TARGET'],default:'REVIEW'},conditions:{type:'object',additionalProperties:false,properties:{all:{type:'array',minItems:1,items:triggerPredicateSchema},any:{type:'array',minItems:1,items:triggerPredicateSchema},invalidation:triggerGroupSchema}},policy:triggerPolicySchema,expiresAt:{type:'string'}},required:['conditions']};
const setupUpdateSchema={type:'object',additionalProperties:false,properties:{symbol:symbolSchema,name:{type:'string'},action:{type:'string',enum:['UPSERT','KEEP','ARCHIVE','NO_CHANGE']},priority:{type:'number',minimum:0,maximum:100},rating:{type:'string',enum:ratings},stage:{type:'string',enum:setupStages},setupType:{type:'string'},originalThesis:{type:'string'},statusReason:{type:'string'},selectionValidity:{type:'string',enum:selectionValidity},entryOpportunity:{type:'string',enum:entryOpportunity},removalReason:{type:'string'},removalReasonCode:{type:'string'},replaceReviewTriggers:{type:'boolean'},playbook:{type:'object',additionalProperties:false,properties:{goodZone:{type:'array',minItems:2,maxItems:2,items:{type:'number'}},breakout:{type:'number'},invalid:{type:'number'},target1:{type:'number'},target2:{type:'number'},maxEntry:{type:'number'},summary:{type:'string'},nextStep:{type:'string'}}},reviewTriggers:{type:'array',items:triggerSchema}},required:['symbol']};
export function directGptToolDefinitions(){return [
 {name:'get_trading_state',title:'Read Eason Trading strategy state',description:'Read the latest read-only Eason Trading replica synced from the user app: held positions, radar, Setup/Playbook and armed GPT review triggers. This replica is not an authoritative ledger and contains no cash balance or executed-trade history.',annotations:{readOnlyHint:true,openWorldHint:false},inputSchema:{type:'object',additionalProperties:false,properties:{}}},
 {name:'get_stock_strategy',title:'Read one stock strategy',description:'Read the latest synced position/radar/setup/playbook/trigger context for one stock symbol.',annotations:{readOnlyHint:true,openWorldHint:false},inputSchema:{type:'object',additionalProperties:false,properties:{symbol:symbolSchema},required:['symbol']}},
 {name:'get_active_handoff',title:'Read the handoff the user just opened',description:'Read the latest App-created handoff context. Use when the user arrives from Eason Trading or asks to review the package the App just prepared.',annotations:{readOnlyHint:true,openWorldHint:false},inputSchema:{type:'object',additionalProperties:false,properties:{}}},
 {name:'get_latest_review_event',title:'Read the latest meaningful monitor event',description:'Read the latest pending/GPT-sent review event, including the market snapshot, original context and the reason the smart trigger fired.',annotations:{readOnlyHint:true,openWorldHint:false},inputSchema:{type:'object',additionalProperties:false,properties:{eventId:{type:'string'}}}},
 {name:'get_close_review_package',title:'Read the latest after-close review package',description:'Read the latest sanitized after-close package prepared by Eason Trading. It includes positions/market/setup/trigger context but no cash amount and no executed-trade history.',annotations:{readOnlyHint:true,openWorldHint:false},inputSchema:{type:'object',additionalProperties:false,properties:{}}},
 {name:'update_trading_strategy',title:'Update Eason Trading strategy',description:'Queue strategy-only updates to Eason Trading. Use reviewEventId when responding to a monitor event so that review is completed even when the decision is NO_CHANGE. NEVER use this tool to represent a trade, cash change, holding quantity change, or executed order. The local app validates and applies the command to strategy state only.',annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false},inputSchema:{type:'object',additionalProperties:false,properties:{summary:{type:'string'},reviewEventId:{type:'string',description:'The exact event.id returned by getLatestReviewEvent when this update resolves that review.'},waitForApplySeconds:{type:'integer',minimum:0,maximum:20,default:16,description:'Wait briefly for the online local Backend to acknowledge the command. Use 16 for normal interactive updates.'},setups:{type:'array',minItems:1,items:setupUpdateSchema}},required:['setups']}},
 {name:'undo_last_strategy_update',title:'Undo last GPT strategy update',description:'Queue an undo of the last GPT strategy-only update. This can restore Radar/Setup/Playbook/Trigger state and can never alter cash, holdings quantities or executed trades.',annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false},inputSchema:{type:'object',additionalProperties:false,properties:{reason:{type:'string'}}}},
 {name:'get_strategy_command_status',title:'Check strategy update status',description:'Check whether a previously queued direct GPT strategy command is still pending, applied, or failed.',annotations:{readOnlyHint:true,openWorldHint:false},inputSchema:{type:'object',additionalProperties:false,properties:{commandId:{type:'string'}},required:['commandId']}}
]}
function cleanDirectSetup(x){
 if(!x||typeof x!=='object')throw new Error('setup must be an object');
 const symbol=String(x.symbol||'').trim();if(!/^\d{4,6}$/.test(symbol))throw new Error(`invalid symbol: ${symbol||'(empty)'}`);
 for(const forbidden of ['positions','position','portfolio','cash','trades','trade','ledger','actualTrading','realizedPnl'])if(Object.prototype.hasOwnProperty.call(x,forbidden))throw new Error(`forbidden strategy key: ${forbidden}`);
 return {...x,symbol};
}
export function normalizeDirectStrategyPayload(input){
 const setups=Array.isArray(input?.setups)?input.setups.map(cleanDirectSetup):[];if(!setups.length)throw new Error('setups required');
 return {version:1,generatedAt:now(),summary:String(input?.summary||'GPT direct strategy update'),reviewEventId:input?.reviewEventId?String(input.reviewEventId):null,setups};
}
async function putGptBridgeState(req,env){
 const x=await req.json();if(!x?.state||typeof x.state!=='object')return json({error:'state required'},400);
 const serialized=JSON.stringify(x.state);if(serialized.length>750000)return json({error:'state too large'},413);
 await env.DB.prepare(`INSERT INTO gpt_bridge_state(id,payload,source_version,synced_at) VALUES('current',?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,source_version=excluded.source_version,synced_at=excluded.synced_at`).bind(serialized,String(x.sourceVersion||''),now()).run();
 return json({ok:true,syncedAt:now(),sourceVersion:String(x.sourceVersion||'')});
}
function safeCommand(r){return {id:r.id,kind:r.kind,payload:parse(r.payload)||{},status:r.status,requestedAt:r.requested_at,appliedAt:r.applied_at||null,failedAt:r.failed_at||null,error:r.error||null,result:parse(r.result)||null};}
async function queueGptCommand(env,kind,payload){
 const id=uid('gc'),requestedAt=now();await env.DB.prepare("INSERT INTO gpt_strategy_commands(id,kind,payload,status,requested_at) VALUES(?,?,?,'PENDING',?)").bind(id,kind,JSON.stringify(payload||{}),requestedAt).run();return {id,kind,status:'PENDING',requestedAt};
}
async function latestGptBridgeState(env){const r=await one(env,"SELECT * FROM gpt_bridge_state WHERE id='current'");return r?{state:parse(r.payload)||{},sourceVersion:r.source_version||'',syncedAt:r.synced_at}:null;}
async function readLatestReviewEvent(env,eventId=''){
 let cloud=null;
 if(eventId){try{cloud=await one(env,'SELECT * FROM monitor_events WHERE id=?',eventId)}catch{}}
 else {try{cloud=await one(env,"SELECT * FROM monitor_events WHERE review_status IN ('PENDING','GPT_SENT') ORDER BY CASE WHEN review_status='GPT_SENT' THEN 0 ELSE 1 END, updated_at DESC, created_at DESC LIMIT 1")}catch{}}
 if(cloud)return {ok:true,source:'cloud-monitor',event:safeEvent(cloud)};
 const bridge=await latestGptBridgeState(env);const events=bridge?.state?.reviewEvents||[];
 const event=eventId?events.find(x=>x.id===eventId||x.cloudEventId===eventId):events.find(x=>x.reviewStatus!=='COMPLETED')||events[0]||null;
 return event?{ok:true,source:'local-bridge',event,syncedAt:bridge.syncedAt}:{ok:false,event:null,message:'No review event is waiting.'};
}
function secondsSince(iso){const t=Date.parse(String(iso||''));return Number.isFinite(t)?Math.max(0,Math.floor((Date.now()-t)/1000)):null;}
async function gptActionReadiness(env){
 const bridge=await latestGptBridgeState(env);
 const pending=await one(env,"SELECT COUNT(*) AS c FROM gpt_strategy_commands WHERE status='PENDING'");
 const failed=await one(env,"SELECT COUNT(*) AS c FROM gpt_strategy_commands WHERE status='FAILED'");
 const age=bridge?secondsSince(bridge.syncedAt):null;
 return {ok:true,connected:!!bridge,appOnline:age!==null&&age<=45,stateAgeSeconds:age,sourceVersion:bridge?.sourceVersion||null,syncedAt:bridge?.syncedAt||null,pendingCommands:Number(pending?.c||0),failedCommands:Number(failed?.c||0),applyBehavior:age!==null&&age<=45?'Online app normally reconciles within 15 seconds.':'Commands stay queued until the local Backend is online.'};
}
async function waitForGptCommand(env,id,seconds=0){
 const max=Math.max(0,Math.min(20,Number(seconds)||0));
 const deadline=Date.now()+max*1000;
 let r=await one(env,'SELECT * FROM gpt_strategy_commands WHERE id=?',id);
 while(r&&r.status==='PENDING'&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,500));r=await one(env,'SELECT * FROM gpt_strategy_commands WHERE id=?',id);}
 return r?safeCommand(r):null;
}
async function gptBridgeRoutes(req,env,u,p){
 if(req.method==='PUT'&&p==='/v1/gpt-bridge/state')return putGptBridgeState(req,env);
 if(req.method==='POST'&&p==='/v1/gpt-bridge/roundtrip-test'){
  const nonce=uid('ping');const command=await queueGptCommand(env,'PING',{nonce});return json({ok:true,command,nonce},201);
 }
 if(req.method==='GET'&&/^\/v1\/gpt-bridge\/commands\/[^/]+$/.test(p)){
  const id=decodeURIComponent(p.split('/')[4]),r=await one(env,'SELECT * FROM gpt_strategy_commands WHERE id=?',id);return r?json(safeCommand(r)):json({error:'not found'},404);
 }
 if(req.method==='GET'&&p==='/v1/gpt-bridge/commands'){
  const status=String(u.searchParams.get('status')||'PENDING');const limit=Math.max(1,Math.min(50,Number(u.searchParams.get('limit')||20)));
  return json((await all(env,'SELECT * FROM gpt_strategy_commands WHERE status=? ORDER BY requested_at ASC LIMIT ?',status,limit)).map(safeCommand));
 }
 if(req.method==='PATCH'&&/^\/v1\/gpt-bridge\/commands\/[^/]+$/.test(p)){
  const id=decodeURIComponent(p.split('/')[4]),x=await req.json();if(!['APPLIED','FAILED'].includes(x.status))return json({error:'invalid status'},400);
  const current=await one(env,'SELECT * FROM gpt_strategy_commands WHERE id=?',id);if(!current)return json({error:'not found'},404);if(current.status!=='PENDING')return json(safeCommand(current));
  if(x.status==='APPLIED')await env.DB.prepare("UPDATE gpt_strategy_commands SET status='APPLIED',applied_at=?,result=?,error=NULL WHERE id=? AND status='PENDING'").bind(now(),JSON.stringify(x.result||null),id).run();
  else await env.DB.prepare("UPDATE gpt_strategy_commands SET status='FAILED',failed_at=?,error=? WHERE id=? AND status='PENDING'").bind(now(),String(x.error||'unknown error').slice(0,1000),id).run();
  return json(safeCommand(await one(env,'SELECT * FROM gpt_strategy_commands WHERE id=?',id)));
 }
 return null;
}
function mcpRpc(id,result){return json({jsonrpc:'2.0',id,result});}
function mcpError(id,code,message){return json({jsonrpc:'2.0',id,error:{code,message}},200);}
function mcpToolResult(data){return {resultType:'complete',content:[{type:'text',text:JSON.stringify(data,null,2)}],structuredContent:data,isError:false};}
async function callDirectGptTool(env,name,args={}){
 if(name==='get_trading_state'){
  const row=await latestGptBridgeState(env);if(!row)return mcpToolResult({ok:false,connected:false,message:'No app state has been synced yet.'});return mcpToolResult({ok:true,connected:true,...row});
 }
 if(name==='get_stock_strategy'){
  const symbol=String(args.symbol||'').trim(),row=await latestGptBridgeState(env);if(!row)return mcpToolResult({ok:false,connected:false,message:'No app state has been synced yet.'});const state=row.state||{};return mcpToolResult({ok:true,symbol,position:(state.positions||[]).find(x=>x.symbol===symbol)||null,radar:(state.radar||[]).find(x=>x.symbol===symbol)||null,reviewTriggers:(state.reviewTriggers||[]).filter(x=>x.symbol===symbol),syncedAt:row.syncedAt,sourceVersion:row.sourceVersion});
 }
 if(name==='get_active_handoff'){const row=await latestGptBridgeState(env);return mcpToolResult(row?.state?.activeHandoff?{ok:true,handoff:row.state.activeHandoff,syncedAt:row.syncedAt}:{ok:false,handoff:null,message:'No active App handoff.'});}
 if(name==='get_latest_review_event')return mcpToolResult(await readLatestReviewEvent(env,String(args.eventId||'')));
 if(name==='get_close_review_package'){const row=await latestGptBridgeState(env);return mcpToolResult(row?.state?.closeReview?{ok:true,closeReview:row.state.closeReview,syncedAt:row.syncedAt}:{ok:false,closeReview:null,message:'No close package has been synced yet.'});}
 if(name==='update_trading_strategy'){const payload=normalizeDirectStrategyPayload(args);const cmd=await queueGptCommand(env,'APPLY_STRATEGY_UPDATE',payload);return mcpToolResult({ok:true,queued:true,command:cmd,safetyBoundary:'Strategy only. Ledger/cash/trades are not writable from this tool.'});}
 if(name==='undo_last_strategy_update'){const cmd=await queueGptCommand(env,'UNDO_STRATEGY_UPDATE',{reason:String(args.reason||'GPT requested undo')});return mcpToolResult({ok:true,queued:true,command:cmd,safetyBoundary:'Strategy-only undo.'});}
 if(name==='get_strategy_command_status'){const r=await one(env,'SELECT * FROM gpt_strategy_commands WHERE id=?',String(args.commandId||''));return mcpToolResult(r?{ok:true,command:safeCommand(r)}:{ok:false,error:'command not found'});}
 throw new Error(`Unknown tool: ${name}`);
}


export function gptActionOpenApi(origin='https://YOUR_WORKER.workers.dev'){
 return {openapi:'3.1.0',info:{title:'Eason Trading Direct Strategy API',version:'0.3.18',description:'Read Eason Trading strategy state and queue strategy-only updates. This API cannot modify cash, executed trades, or holding quantities.'},externalDocs:{description:'Eason Trading GPT Action usage instructions',url:String(origin).replace(/\/$/,'')+'/gpt-action-instructions.txt'},servers:[{url:String(origin).replace(/\/$/,'')}],components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',bearerFormat:'opaque'}}},security:[{bearerAuth:[]}],paths:{
  '/v1/gpt-action/readiness':{get:{operationId:'checkEasonTradingConnection',summary:'Check whether Eason Trading is synced and whether the local app is online',responses:{'200':{description:'Connection readiness and pending command counts'}}}},
  '/v1/gpt-action/state':{get:{operationId:'getTradingState',summary:'Read current Eason Trading strategy state',description:'Call this before material strategy analysis so the answer uses the latest App state.',responses:{'200':{description:'Latest synced read-only state'}}}},
  '/v1/gpt-action/stocks/{symbol}':{get:{operationId:'getStockStrategy',summary:'Read one stock strategy',parameters:[{name:'symbol',in:'path',required:true,schema:symbolSchema}],responses:{'200':{description:'Stock strategy context'}}}},
  '/v1/gpt-action/handoff':{get:{operationId:'getActiveHandoffContext',summary:'Read the handoff the user just opened from Eason Trading',responses:{'200':{description:'Latest App handoff metadata and context pointer'}}}},
  '/v1/gpt-action/review-event':{get:{operationId:'getLatestReviewEvent',summary:'Read the latest meaningful monitor event',parameters:[{name:'eventId',in:'query',required:false,schema:{type:'string'}}],responses:{'200':{description:'Latest pending review event and trigger evidence'}}}},
  '/v1/gpt-action/close-review':{get:{operationId:'getCloseReviewPackage',summary:'Read latest after-close review package',responses:{'200':{description:'Sanitized close package prepared by the App'}}}},
  '/v1/gpt-action/strategy':{post:{operationId:'updateTradingStrategy',summary:'Queue strategy-only updates',description:'Never use for executed trades, cash, or holding quantity changes.',requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,properties:{summary:{type:'string'},reviewEventId:{type:'string',description:'Exact event.id returned by getLatestReviewEvent when this update resolves that review.'},waitForApplySeconds:{type:'integer',minimum:0,maximum:20,default:16,description:'Wait briefly for the online local Backend to acknowledge the command. Use 16 for normal interactive updates.'},setups:{type:'array',minItems:1,items:setupUpdateSchema}},required:['setups']}}}},responses:{'200':{description:'Strategy command queued'}}}},
  '/v1/gpt-action/undo':{post:{operationId:'undoLastStrategyUpdate',summary:'Queue undo of last GPT strategy update',requestBody:{required:false,content:{'application/json':{schema:{type:'object',additionalProperties:false,properties:{reason:{type:'string'},waitForApplySeconds:{type:'integer',minimum:0,maximum:20,default:16}}}}}},responses:{'200':{description:'Undo command queued or applied'}}}},
  '/v1/gpt-action/commands/{commandId}':{get:{operationId:'getStrategyCommandStatus',summary:'Check queued strategy update status',parameters:[{name:'commandId',in:'path',required:true,schema:{type:'string'}}],responses:{'200':{description:'Command status'}}}}
 }};
}
async function handleGptAction(req,env,u,p){
 if(!mcpAuthorized(req,env))return json({error:'unauthorized'},401);
 if(req.method==='GET'&&p==='/v1/gpt-action/readiness')return json(await gptActionReadiness(env));
 if(req.method==='GET'&&p==='/v1/gpt-action/state'){
  const r=await latestGptBridgeState(env);return json(r?{ok:true,connected:true,...r}:{ok:false,connected:false,message:'No app state has been synced yet.'});
 }
 if(req.method==='GET'&&p==='/v1/gpt-action/handoff'){const r=await latestGptBridgeState(env);return json(r?.state?.activeHandoff?{ok:true,handoff:r.state.activeHandoff,syncedAt:r.syncedAt}:{ok:false,handoff:null,message:'No active App handoff.'});}
 if(req.method==='GET'&&p==='/v1/gpt-action/review-event')return json(await readLatestReviewEvent(env,String(u.searchParams.get('eventId')||'')));
 if(req.method==='GET'&&p==='/v1/gpt-action/close-review'){const r=await latestGptBridgeState(env);return json(r?.state?.closeReview?{ok:true,closeReview:r.state.closeReview,syncedAt:r.syncedAt}:{ok:false,closeReview:null,message:'No close package has been synced yet.'});}
 if(req.method==='GET'&&/^\/v1\/gpt-action\/stocks\/[^/]+$/.test(p)){
  const symbol=decodeURIComponent(p.split('/')[4]),r=await latestGptBridgeState(env);if(!r)return json({ok:false,connected:false,message:'No app state has been synced yet.'},409);const state=r.state||{};return json({ok:true,symbol,position:(state.positions||[]).find(x=>x.symbol===symbol)||null,radar:(state.radar||[]).find(x=>x.symbol===symbol)||null,reviewTriggers:(state.reviewTriggers||[]).filter(x=>x.symbol===symbol),syncedAt:r.syncedAt,sourceVersion:r.sourceVersion});
 }
 if(req.method==='POST'&&p==='/v1/gpt-action/strategy'){const input=await req.json();const payload=normalizeDirectStrategyPayload(input);const queued=await queueGptCommand(env,'APPLY_STRATEGY_UPDATE',payload);const command=await waitForGptCommand(env,queued.id,input?.waitForApplySeconds===undefined?16:input.waitForApplySeconds);return json({ok:true,queued:command?.status==='PENDING',applied:command?.status==='APPLIED',command:command||queued,safetyBoundary:'Strategy only. Ledger/cash/trades are not writable.'});}
 if(req.method==='POST'&&p==='/v1/gpt-action/undo'){let input={};try{input=await req.json()}catch{}const queued=await queueGptCommand(env,'UNDO_STRATEGY_UPDATE',{reason:String(input?.reason||'GPT requested undo')});const command=await waitForGptCommand(env,queued.id,input?.waitForApplySeconds===undefined?16:input.waitForApplySeconds);return json({ok:true,queued:command?.status==='PENDING',applied:command?.status==='APPLIED',command:command||queued,safetyBoundary:'Strategy-only undo.'});}
 if(req.method==='GET'&&/^\/v1\/gpt-action\/commands\/[^/]+$/.test(p)){const id=decodeURIComponent(p.split('/')[4]),r=await one(env,'SELECT * FROM gpt_strategy_commands WHERE id=?',id);return r?json({ok:true,command:safeCommand(r)}):json({ok:false,error:'command not found'},404);}
 return json({error:'not found'},404);
}

export async function handleMcp(req,env){
 if(!mcpAuthorized(req,env))return json({error:'unauthorized'},401);
 let msg;try{msg=await req.json()}catch{return json({error:'invalid json'},400)}
 const id=msg?.id??null,method=String(msg?.method||'');
 if(method==='initialize')return mcpRpc(id,{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'eason-trading-direct',version:'0.3.18'}});
 if(method==='server/discover')return mcpRpc(id,{protocolVersion:'2026-07-28',capabilities:{tools:{}},serverInfo:{name:'eason-trading-direct',version:'0.3.18'}});
 if(method==='notifications/initialized')return new Response(null,{status:202,headers:cors});
 if(method==='tools/list')return mcpRpc(id,{resultType:'complete',tools:directGptToolDefinitions()});
 if(method==='tools/call'){
  try{return mcpRpc(id,await callDirectGptTool(env,String(msg?.params?.name||''),msg?.params?.arguments||{}));}
  catch(e){return mcpRpc(id,{resultType:'complete',content:[{type:'text',text:String(e?.message||e)}],isError:true});}
 }
 return mcpError(id,-32601,`Method not found: ${method}`);
}

async function handle(req,env){
 if(req.method==='OPTIONS')return json({},204);
 const u=new URL(req.url),p=u.pathname;
 if(req.method==='GET'&&p==='/privacy')return new Response(`<!doctype html><meta charset="utf-8"><title>Eason Trading Privacy</title><main style="font-family:system-ui;max-width:760px;margin:40px auto;line-height:1.65"><h1>Eason Trading GPT Direct Privacy</h1><p>This private integration mirrors only the strategy context needed for the user's own trading workflow. It intentionally excludes cash balance and executed-trade history.</p><p>GPT-facing tools can update strategy metadata such as Radar, Setup, Playbook and review Triggers. They cannot create trades, change cash, change holding quantities or initialize the authoritative Ledger.</p><p>Data is stored in the user's own Cloudflare account and local Eason Trading installation.</p></main>`,{headers:{'content-type':'text/html; charset=utf-8',...cors}});
 if(req.method==='GET'&&p==='/gpt-action-instructions.txt')return new Response(`EASON TRADING DIRECT ACTION RULES\n\n1. Eason Trading is a quiet monitor/data bridge, not a market-browsing app. Before material analysis, call getTradingState/getStockStrategy.\n2. If the user arrives from an Eason Trading notification or says a stock just triggered / asks '現在勒', call getLatestReviewEvent first. Use its snapshot, original strategy context and decision evidence before re-evaluating, and remember event.id as reviewEventId.\n3. If the user opens Eason Trading after close and asks for a review, call getActiveHandoffContext and getCloseReviewPackage before analysis. Do not ask for screenshots.\n4. When analysis changes actionable strategy, write it back automatically with updateTradingStrategy unless the user explicitly says not to update the App. If this analysis resolves a monitor event, always pass reviewEventId. If the correct decision is no strategy change, still complete that review with updateTradingStrategy using reviewEventId and one setup for the reviewed symbol with action=NO_CHANGE. Smart review triggers must represent a decision point, not a raw price alarm: combine price with useful structure such as RVOL/VWAP/change/high/low when relevant, put invalidation in conditions.invalidation, and use policy.minConsecutive/cooldownMinutes/oneShot to avoid noisy repeat alerts. A price touch alone is not automatically a good alert.\n5. Never represent a real BUY/SELL, cash change, holding quantity change or executed order through these Actions. Those belong only to the authoritative local Ledger after the user actually trades.\n6. For normal interactive writes use waitForApplySeconds=16. If applied=true, say the App strategy was updated. If PENDING, say it will apply when the local Backend is online.\n7. If a write fails, do not claim success. Read getStrategyCommandStatus or explain the failure.\n8. Do not ask the user to copy EASON_TRADING_UPDATE_V1 when Direct Actions are available. Raw JSON is fallback-only after a real Action failure.\n`,{headers:{'content-type':'text/plain; charset=utf-8',...cors}});
 if(req.method==='GET'&&p==='/gpt-action-openapi.json')return json(gptActionOpenApi(u.origin));
 if(p.startsWith('/v1/gpt-action/'))return handleGptAction(req,env,u,p);
 if(req.method==='POST'&&p==='/mcp')return handleMcp(req,env);
 if(req.method==='GET'){
  const pub=await publicEvent(req,env,u,p);if(pub)return pub;
 }
 if(!auth(req,env))return json({error:'unauthorized'},401);
 const gptBridge=await gptBridgeRoutes(req,env,u,p);if(gptBridge)return gptBridge;
 if(p==='/health'){const devices=await one(env,'SELECT COUNT(*) AS c FROM devices WHERE enabled=1');const pendingPush=await one(env,"SELECT COUNT(*) AS c FROM monitor_events WHERE review_status='PENDING' AND push_status!='SENT'");return json({ok:true,service:'eason-trading-cloud-monitor',version:'0.3.18',monitorOnly:true,directGptBridge:true,mcpBearerConfigured:String(env.MCP_BEARER_TOKEN||'').length>=20,publicBaseConfigured:!!env.PUBLIC_BASE_URL,enabledDevices:Number(devices?.c||0),pendingPush:Number(pendingPush?.c||0)});}
 if(req.method==='PUT'&&p==='/v1/monitor/targets')return syncTargets(req,env);
 if(req.method==='GET'&&p==='/v1/monitor/targets')return json(await all(env,'SELECT * FROM monitor_targets ORDER BY synced_at DESC'));
 if(req.method==='GET'&&p==='/v1/monitor/events'){
  const status=u.searchParams.get('status');
  const rows=status?await all(env,'SELECT * FROM monitor_events WHERE review_status=? ORDER BY created_at DESC LIMIT 100',status):await all(env,'SELECT * FROM monitor_events ORDER BY created_at DESC LIMIT 100');
  return json(rows.map(safeEvent));
 }
 if(req.method==='GET'&&/^\/v1\/monitor\/events\/[^/]+$/.test(p)){
  const r=await one(env,'SELECT * FROM monitor_events WHERE id=?',decodeURIComponent(p.split('/')[4]));return r?json(safeEvent(r)):json({error:'not found'},404);
 }
 if(req.method==='PATCH'&&/^\/v1\/monitor\/events\/[^/]+$/.test(p)){
  const id=decodeURIComponent(p.split('/')[4]),x=await req.json();if(!['PENDING','GPT_SENT','COMPLETED'].includes(x.status))return json({error:'invalid status'},400);
  const current=await one(env,'SELECT review_status FROM monitor_events WHERE id=?',id);if(!current)return json({error:'not found'},404);
  if(!reviewStatusCanAdvance(current.review_status,x.status))return json({ok:true,id,status:current.review_status,ignoredDowngrade:true});
  await env.DB.prepare('UPDATE monitor_events SET review_status=?,updated_at=? WHERE id=?').bind(x.status,now(),id).run();return json({ok:true,id,status:x.status});
 }
 if(req.method==='POST'&&p==='/v1/devices/test-push'){
  const result=await sendTestPush(env);return json({monitorOnly:true,testOnly:true,...result},result.noDevice?409:(result.ok?200:502));
 }
 if(req.method==='POST'&&p==='/v1/devices'){
  const x=await req.json();if(!x.token)return json({error:'token required'},400);
  await env.DB.prepare('INSERT INTO devices(token,platform,stock_chat_url,enabled,updated_at) VALUES(?,?,?,1,?) ON CONFLICT(token) DO UPDATE SET platform=excluded.platform,stock_chat_url=excluded.stock_chat_url,enabled=1,updated_at=excluded.updated_at')
    .bind(x.token,x.platform||'',String(x.stockChatUrl||''),now()).run();
  return json({ok:true},201);
 }
 return json({error:'not found'},404);
}
export default{
 fetch:(req,env)=>handle(req,env).catch(e=>json({error:e?.message||'bad request'},400)),
 scheduled:(controller,env,ctx)=>ctx.waitUntil(scheduled(env))
};
