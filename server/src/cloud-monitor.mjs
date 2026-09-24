import { db, importCloudReviewEvent, founderBrief, radar, listReviewTriggers, listReviewInbox, listHandoffs, latestClosePackage, applyGptUpdate, undoLastGptUpdate } from './store.mjs';
import {ensureLedgerDevice,applyLedgerMutation} from './ledger-mutations.mjs';

const gptDirectRuntime={lastStateSyncAt:null,lastCommandPollAt:null,lastAppliedAt:null,lastError:null};
export function gptDirectRuntimeStatus(){
 const cfg=cloudMonitorConfig();
 return {bridgeConfigured:cfg.configured&&String(process.env.GPT_DIRECT_MCP_TOKEN||'').length>=20,pollIntervalSeconds:15,...gptDirectRuntime};
}

export function cloudMonitorConfig(){
 const url=String(process.env.CLOUD_MONITOR_URL||'').replace(/\/$/,'');
 const apiKey=String(process.env.CLOUD_MONITOR_API_KEY||'');
 return {configured:!!url&&apiKey.length>=20,url,apiKeyConfigured:apiKey.length>=20};
}

function safePlaybook(symbol){
 const p=db.playbooks?.[symbol]||null;
 if(!p)return null;
 return {
  version:p.version??null,
  summary:p.summary||'',
  nextStep:p.nextStep||'',
  goodZone:Array.isArray(p.goodZone)?p.goodZone.slice(0,2):p.goodZone??null,
  breakout:p.breakout??null,
  invalid:p.invalid??null,
  target1:p.target1??null,
  target2:p.target2??null,
  maxEntry:p.maxEntry??null
 };
}
function safeSetup(symbol){
 const s=db.setups?.[symbol]||null;
 if(!s)return null;
 return {
  stage:s.stage||'',
  setupType:s.setupType||'',
  originalThesis:s.originalThesis||'',
  statusReason:s.statusReason||'',
  selectionValidity:s.selectionValidity||'',
  entryOpportunity:s.entryOpportunity||''
 };
}

function monitorReadiness(trigger){
 const rows=[...(Array.isArray(trigger?.conditions?.all)?trigger.conditions.all:[]),...(Array.isArray(trigger?.conditions?.any)?trigger.conditions.any:[])];
 const missing=[];
 if(rows.some(x=>x?.field==='rvol')){
  const baseline=Number(db.volumeBaselines?.[trigger.symbol]?.avgDailyVolume);
  if(!(baseline>0))missing.push('rvolBaseline');
 }
 return {ready:missing.length===0,missing};
}

export function buildMonitorTargets(){
 const active=(db.reviewTriggers||[]).filter(t=>t.status==='ARMED'&&(!t.expiresAt||Date.parse(t.expiresAt)>Date.now()));
 return active.map(t=>{
  const readiness=monitorReadiness(t);
  return {
   id:t.id,
   symbol:t.symbol,
   name:db.watchlist.find(w=>w.symbol===t.symbol)?.name||db.market?.[t.symbol]?.name||t.symbol,
   label:t.label||'GPT 複判',
   conditions:t.conditions||{all:[]},
   purpose:t.purpose||'REVIEW',
   policy:t.policy||{oneShot:true,minConsecutive:1,cooldownMinutes:0},
   playbookVersion:t.playbookVersion??db.playbooks?.[t.symbol]?.version??null,
   expiresAt:t.expiresAt||null,
   cloudReady:readiness.ready,
   cloudMissing:readiness.missing,
   context:{triggerPurpose:t.purpose||'REVIEW',triggerPolicy:t.policy||{oneShot:true,minConsecutive:1,cooldownMinutes:0},playbookVersion:t.playbookVersion??db.playbooks?.[t.symbol]?.version??null,playbook:safePlaybook(t.symbol),setup:safeSetup(t.symbol),rvolBaseline:db.volumeBaselines?.[t.symbol]?.avgDailyVolume?{avgDailyVolume:Number(db.volumeBaselines[t.symbol].avgDailyVolume),updatedAt:db.volumeBaselines[t.symbol].updatedAt||null}:null}
  };
 });
}

async function call(path,init={}){
 const cfg=cloudMonitorConfig();
 if(!cfg.configured)return {ok:false,configured:false,skipped:true};
 const apiKey=String(process.env.CLOUD_MONITOR_API_KEY||'');
 const r=await fetch(`${cfg.url}${path}`,{
  ...init,
  headers:{'content-type':'application/json','x-api-key':apiKey,...(init.headers||{})}
 });
 let data={};try{data=await r.json()}catch{}
 if(!r.ok)throw new Error(data?.error||`Cloud monitor ${r.status}`);
 return data;
}

export async function syncCloudMonitor(){
 const allTargets=buildMonitorTargets();
 const unavailable=allTargets.filter(x=>x.cloudReady===false).map(x=>({id:x.id,symbol:x.symbol,missing:x.cloudMissing||[]}));
 const targets=allTargets.filter(x=>x.cloudReady!==false).map(({cloudReady,cloudMissing,...x})=>x);
 const remote=await call('/v1/monitor/targets',{method:'PUT',body:JSON.stringify({generatedAt:new Date().toISOString(),targets})});
 return {...remote,localArmed:allTargets.length,synced:targets.length,notReady:unavailable};
}

export async function syncCloudDevice(token,platform='',stockChatUrl=''){
 if(!token)return {ok:false,skipped:true};
 return call('/v1/devices',{method:'POST',body:JSON.stringify({token,platform,stockChatUrl:String(stockChatUrl||'')})});
}

export async function syncAllCloudDevices(){
 const cfg=cloudMonitorConfig();
 if(!cfg.configured)return {ok:false,configured:false,skipped:true};
 const devices=(db.devices||[]).filter(x=>x.enabled!==false&&x.token);
 const stockChatUrl=String(db.settings?.stockChatUrl||'');
 const results=[];
 for(const d of devices){
  try{results.push(await syncCloudDevice(d.token,d.platform||'',stockChatUrl));}
  catch(e){results.push({ok:false,error:e?.message||String(e),token:String(d.token).slice(0,12)});}
 }
 return {ok:results.every(x=>x?.ok!==false),count:devices.length,results};
}

export async function cloudMonitorHealth(){return call('/health');}

export async function registerCloudLedgerDevice(){
 const device=ensureLedgerDevice();const cfg=cloudMonitorConfig();if(!cfg.configured)return {ok:false,skipped:true,device};
 const result=await call('/v1/ledger/devices',{method:'POST',body:JSON.stringify(device)});return {ok:true,device,result};
}
export function mobileLedgerCloudConfig(){const cfg=cloudMonitorConfig(),device=ensureLedgerDevice();return cfg.configured?{url:cfg.url,deviceId:device.deviceId,deviceToken:device.token}:null;}
export async function reconcileLedgerMutations(limit=50){
 const cfg=cloudMonitorConfig();if(!cfg.configured)return {ok:false,skipped:true};
 const rows=await call(`/v1/ledger/mutations?status=pending&limit=${Math.max(1,Math.min(100,Number(limit)||50))}`);const results=[];
 for(const row of Array.isArray(rows)?rows:[]){
  try{const result=applyLedgerMutation(row);await call(`/v1/ledger/mutations/${encodeURIComponent(row.mutationId)}`,{method:'PATCH',body:JSON.stringify({status:'applied',result})});results.push({mutationId:row.mutationId,status:'applied',alreadyApplied:result.alreadyApplied});}
  catch(e){const reason=String(e?.message||e).slice(0,1000);try{await call(`/v1/ledger/mutations/${encodeURIComponent(row.mutationId)}`,{method:'PATCH',body:JSON.stringify({status:'rejected',reason})});results.push({mutationId:row.mutationId,status:'rejected',reason});}catch(ackError){results.push({mutationId:row.mutationId,status:'ack_failed',reason,ackError:String(ackError?.message||ackError)});}}
 }
 return {ok:results.every(x=>x.status!=='ack_failed'),count:results.length,results};
}

export async function fetchCloudEvents(){
 const x=await call('/v1/monitor/events');
 return Array.isArray(x)?x:[];
}
export async function reconcileCloudEvents(){
 const cfg=cloudMonitorConfig();if(!cfg.configured)return {ok:false,configured:false,skipped:true};
 const rows=await fetchCloudEvents();let imported=0;
 for(const row of rows){try{importCloudReviewEvent(row,'cloud-monitor');imported++;}catch{}}
 return {ok:true,count:rows.length,imported};
}
export async function updateCloudEventStatus(id,status){
 if(!id)return {ok:false,skipped:true};
 return call(`/v1/monitor/events/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status})});
}
export async function syncReviewEventStatuses(){
 const rows=listReviewInbox({limit:100}).filter(x=>x.cloudEventId&&x.reviewStatus==='COMPLETED');
 const results=[];
 for(const row of rows){try{results.push({id:row.cloudEventId,...await updateCloudEventStatus(row.cloudEventId,'COMPLETED')})}catch(e){results.push({id:row.cloudEventId,ok:false,error:String(e?.message||e)})}}
 return {ok:results.every(x=>x.ok!==false),count:rows.length,results};
}


export function buildGptBridgeSnapshot(){
 const brief=founderBrief();
 const positions=(brief.positions||[]).map(p=>({
  symbol:p.symbol,name:p.name||p.symbol,quantity:Number(p.quantity||0),averageCost:Number(p.averageCost||0),
  currentPrice:p.currentPrice??p.price??null,marketValue:p.marketValue??null,unrealizedPnl:p.unrealizedPnl??null,
  dataTrusted:p.dataTrusted??null,dataFresh:p.dataFresh??null
 }));
 const rows=(radar()||[]).map(x=>({
  symbol:x.symbol,name:x.name||x.symbol,price:x.price??null,changePct:x.changePct??null,rvol:x.rvol??null,
  updatedAt:x.updatedAt||null,dataTrusted:x.dataTrusted??null,dataFresh:x.dataFresh??null,
  rating:x.rating??null,state:x.state??null,priority:x.priority??null,
  position:x.position?{quantity:Number(x.position.quantity||0),averageCost:Number(x.position.averageCost||0)}:null,
  setup:x.setup||null,playbook:x.playbook||null
 }));
 const activeHandoff=listHandoffs({status:'READY',limit:1})[0]||null;
 const close=latestClosePackage();
 const closeReview=close?{
  id:close.id,date:close.date,generatedAt:close.generatedAt,
  cashKnown:brief.portfolio?.cashKnown===true,
  actualTrading:{noTrade:close.actualTrading?.noTrade===true,totalTrades:Number(close.actualTrading?.totalTrades||0),buyCount:Number(close.actualTrading?.buyCount||0),sellCount:Number(close.actualTrading?.sellCount||0),symbolsTouched:Number(close.actualTrading?.symbolsTouched||0),realizedPnl:Number(close.actualTrading?.realizedPnl||0)},
  closingPositions:(close.closingPositions||[]).map(p=>({symbol:p.symbol,name:p.name||p.symbol,quantity:Number(p.quantity||0),averageCost:Number(p.averageCost||0),market:p.market?{price:p.market.price??null,changePct:p.market.changePct??null,high:p.market.high??null,low:p.market.low??null,vwap:p.market.vwap??null,rvol:p.market.rvol??null,updatedAt:p.market.updatedAt||null}:null,setup:p.setup||null})),
  trackedStrategies:rows.map(x=>({symbol:x.symbol,name:x.name,price:x.price,changePct:x.changePct,rvol:x.rvol,updatedAt:x.updatedAt,dataTrusted:x.dataTrusted,dataFresh:x.dataFresh,rating:x.rating,state:x.state,priority:x.priority,setup:x.setup,playbook:x.playbook})),
  setupChanges:close.setupChanges||[],triggerEvents:(close.triggerEvents||[]).map(e=>({id:e.id,symbol:e.symbol,label:e.label,triggeredAt:e.triggeredAt,reasons:e.reasons||[],decisionSummary:e.decisionSummary||null,evidence:e.evidence||null,reviewStatus:e.reviewStatus||'PENDING'})),
  newDiscoveries:close.newDiscoveries||[],rollingPool:close.rollingPool||[],pendingReviewTriggers:close.pendingReviewTriggers||[],nightSelection:close.nightSelection||null,learningCandidates:close.learningCandidates||[]
 }:null;
 const reviewEvents=listReviewInbox({limit:20}).map(e=>({id:e.id,cloudEventId:e.cloudEventId||null,triggerId:e.triggerId,symbol:e.symbol,name:e.name||e.symbol,label:e.label,triggeredAt:e.triggeredAt,reasons:e.reasons||[],decisionSummary:e.decisionSummary||null,evidence:e.evidence||null,market:e.market||e.snapshot?.marketAtTrigger||null,reviewStatus:e.reviewStatus,handoffId:e.handoffId||null}));
 return {
  schemaVersion:2,
  generatedAt:new Date().toISOString(),
  readOnlyReplica:true,
  authoritativeLedger:false,
  privacyBoundary:'No cash amount and no executed-trade history are mirrored to the GPT bridge. cashKnown is metadata only.',
  cashKnown:brief.portfolio?.cashKnown===true,
  positions,
  radar:rows,
  reviewTriggers:listReviewTriggers({status:'ARMED'}),
  reviewEvents,
  activeHandoff:activeHandoff?{id:activeHandoff.id,type:activeHandoff.type,symbol:activeHandoff.symbol||null,eventId:activeHandoff.eventId||null,snapshotId:activeHandoff.snapshotId||null,closePackageId:activeHandoff.closePackageId||null,prompt:activeHandoff.prompt,createdAt:activeHandoff.createdAt}:null,
  closeReview
 };
}

export function directCommandToUpdateText(command){
 const payload=command?.payload&&typeof command.payload==='object'?command.payload:command;
 const x={version:1,generatedAt:payload?.generatedAt||command?.requestedAt||new Date().toISOString(),summary:String(payload?.summary||'GPT direct strategy update'),reviewEventId:payload?.reviewEventId?String(payload.reviewEventId):null,setups:Array.isArray(payload?.setups)?payload.setups:[]};
 if(!x.setups.length)throw new Error('Direct GPT strategy command has no setups');
 return `--- EASON_TRADING_UPDATE_V1 ---\n${JSON.stringify(x)}\n--- END_EASON_TRADING_UPDATE ---`;
}

export async function syncGptBridgeState(){
 const cfg=cloudMonitorConfig();if(!cfg.configured)return {ok:false,configured:false,skipped:true};
 try{
  const out=await call('/v1/gpt-bridge/state',{method:'PUT',body:JSON.stringify({sourceVersion:'0.3.19',state:buildGptBridgeSnapshot()})});
  gptDirectRuntime.lastStateSyncAt=new Date().toISOString();gptDirectRuntime.lastError=null;return out;
 }catch(e){gptDirectRuntime.lastError=String(e?.message||e);throw e}
}

export async function fetchPendingGptCommands(limit=20){
 const x=await call(`/v1/gpt-bridge/commands?status=PENDING&limit=${Math.max(1,Math.min(50,Number(limit)||20))}`);
 return Array.isArray(x)?x:[];
}

async function ackGptCommand(id,status,result=null,error=null){
 return call(`/v1/gpt-bridge/commands/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status,result,error})});
}

// Production audit helper: acknowledge exactly one synthetic PING command without
// draining or applying any real pending GPT strategy commands.
export async function reconcileGptPingCommand(id){
 const commandId=String(id||'').trim();if(!commandId)throw new Error('PING command id required');
 const row=await call(`/v1/gpt-bridge/commands/${encodeURIComponent(commandId)}`);
 if(row?.kind!=='PING')throw new Error('Roundtrip command is not PING');
 if(row?.status==='APPLIED')return {ok:true,alreadyApplied:true,command:row};
 if(row?.status!=='PENDING')throw new Error(`Roundtrip PING is ${row?.status||'missing'}`);
 const result={ok:true,summary:'cloud-backend-roundtrip-ping',touched:[],nonce:row?.payload?.nonce||null};
 const applied=await ackGptCommand(commandId,'APPLIED',result);
 return {ok:true,alreadyApplied:false,command:applied,result};
}

export async function reconcileGptCommands(){
 const cfg=cloudMonitorConfig();if(!cfg.configured)return {ok:false,configured:false,skipped:true};
 gptDirectRuntime.lastCommandPollAt=new Date().toISOString();
 const rows=await fetchPendingGptCommands();let applied=0,failed=0;const results=[];
 for(const row of rows){
  try{
   let result;
   if(row.kind==='APPLY_STRATEGY_UPDATE')result=applyGptUpdate(directCommandToUpdateText(row),'gpt-direct');
   else if(row.kind==='UNDO_STRATEGY_UPDATE')result=undoLastGptUpdate('gpt-direct');
   else if(row.kind==='PING')result={ok:true,summary:'cloud-backend-roundtrip-ping',touched:[],nonce:row?.payload?.nonce||null};
   else throw new Error(`Unsupported direct GPT command kind: ${row.kind}`);
   let reviewCompletion=null;
   if(result?.cloudEventId){try{reviewCompletion=await updateCloudEventStatus(result.cloudEventId,'COMPLETED')}catch(e){reviewCompletion={ok:false,error:String(e?.message||e)}}}
   await ackGptCommand(row.id,'APPLIED',{ok:true,summary:result?.summary||null,touched:result?.touched||result?.symbols||[],reviewEventId:row?.payload?.reviewEventId||null,reviewCompletion});
   applied++;results.push({id:row.id,status:'APPLIED',reviewCompletion});
  }catch(e){
   const message=String(e?.message||e).slice(0,1000);failed++;results.push({id:row.id,status:'FAILED',error:message});
   try{await ackGptCommand(row.id,'FAILED',null,message)}catch{}
  }
 }
 if(applied){gptDirectRuntime.lastAppliedAt=new Date().toISOString();try{await syncCloudMonitor()}catch{}try{await syncGptBridgeState()}catch{}}
 if(failed)gptDirectRuntime.lastError=results.find(x=>x.error)?.error||'GPT direct command failed';else if(rows.length)gptDirectRuntime.lastError=null;
 return {ok:failed===0,count:rows.length,applied,failed,results};
}
