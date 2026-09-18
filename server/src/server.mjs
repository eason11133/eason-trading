import http from 'node:http';
import { URL } from 'node:url';
import {
  db, founderBrief, radar, recordTrade, previewTrade, adjustPosition, setPosition, removePosition, updateCash, updatePlaybook, addWatch, dropWatch, alertsSince, registerDevice,
  listReviews, recordReview, initializeLedger, listReviewTriggers, createReviewTrigger, updateReviewTrigger,
  listTriggerEvents, getTriggerSnapshot, listReviewInbox, updateReviewInboxEvent, setFocusSymbol, listSetups, updateSetup, recordHypothesis, updateHypothesis,
  getSettings, updateSettings, latestClosePackage, generateClosePackage, maybeGenerateClosePackage,
  createHandoff, getHandoff, listHandoffs, acknowledgeHandoff, previewGptUpdate, applyGptUpdate, undoLastGptUpdate, marketFreshness, flushPendingPersist
} from './store.mjs';
import { bootstrapQuotes, startScanner, hydrateQuote, providerStatus, verifyProvider } from './scanner.mjs';
import { createFocusStream } from './focus-stream.mjs';
import { evaluate } from './alerts.mjs';
import { getCandles } from './candles.mjs';
import { startDisclosures } from './disclosures.mjs';
import { marketSession } from './market-session.mjs';
import { parseQuickTrade } from './quick-trade.mjs';
import { buildMonitorTargets, syncCloudMonitor, syncCloudDevice, syncAllCloudDevices, reconcileCloudEvents, updateCloudEventStatus, syncReviewEventStatuses, cloudMonitorConfig, syncGptBridgeState, reconcileGptCommands, reconcileGptPingCommand, gptDirectRuntimeStatus } from './cloud-monitor.mjs';
import { createPairingManager } from './pairing.mjs';
import { apiAuthorized } from './auth.mjs';

const port=Number(process.env.PORT||8787);
const auditMode=String(process.env.EASON_AUDIT_MODE||'')==='1';
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{try{flushPendingPersist();}catch{}process.exit(0)});
const send=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','access-control-allow-headers':'content-type,x-api-key,x-source','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS'});res.end(status===204?'':JSON.stringify(data));};
const body=async req=>{let x='';for await(const c of req)x+=c;return x?JSON.parse(x):{};};
const auth=req=>apiAuthorized(req.headers['x-api-key'],process.env.TRADING_API_KEY);
const pairing=createPairingManager();
const clientId=req=>String((req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown')).split(',')[0].trim();
function compactSeries(result,limit){return {source:result?.source||'unknown',updatedAt:result?.updatedAt||null,error:result?.error||null,unit:{price:'TWD',volume:'lots'},data:(result?.data||[]).slice(-limit).map(r=>({time:r.date,open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume:Number(r.volume||0)}))};}
function parseTime(x){const t=Date.parse(x||'');return Number.isFinite(t)?t:null;}
function handoffTask(type){
 return type==='TRIGGER_REVIEW'?'複判這次觸發：比較觸發當下與現在，判斷是否真的成立、要不要操作，以及下一個要等待的條件。'
  :type==='NIGHT_SELECTION'?'先用今天真實成交、持股、Trigger 與滾動候選池做必要復盤；接著由你自己上網掃描公開市場、新聞、題材、籌碼與量價，找出新的候選，和既有 Setup 一起比較後選出明天最值得看的標的。App 不會替你預選新股，也不要每天重置舊 Setup。'
  :type==='CLOSE_REVIEW'?'用今天真實成交、持股、Trigger 與 Setup 變化做收盤復盤。'
  :type==='RADAR_SYNC'?'同步目前 App 的持股、滾動候選、Playbook 與行情。把這份資料當作後續股票對話的最新 App 狀態；直接回答使用者在同一則訊息中的問題。'
  :'依照 App 帶入的持股、Playbook、Setup 與最新行情資料複判這支股票。';
}
function compactRadarForGpt(rows=[]){return rows.map(x=>({symbol:x.symbol,name:x.name,price:x.price,changePct:x.changePct,high:x.high,low:x.low,vwap:x.vwap,rvol:x.rvol,updatedAt:x.updatedAt,dataTrusted:x.dataTrusted,dataFresh:x.dataFresh,rating:x.rating,state:x.state,priority:x.priority,position:x.position||null,setup:x.setup||null,playbook:x.playbook||null}));}
function clipboardPayload(expanded){
 const base={id:expanded.id,type:expanded.type,createdAt:expanded.createdAt,symbol:expanded.symbol||null,contextMode:expanded.contextMode};
 if(expanded.type==='TRIGGER_REVIEW')return {...base,event:expanded.event||null,snapshot:expanded.snapshot||null,stockContext:expanded.stockContext||null,latestReviewData:expanded.latestReviewData||null,portfolio:expanded.portfolio||null};
 if(expanded.type==='NIGHT_SELECTION'||expanded.type==='CLOSE_REVIEW')return {...base,closePackage:expanded.closePackage||null,portfolio:expanded.portfolio||null,positions:expanded.positions||[],radar:compactRadarForGpt(expanded.radarSnapshot||[]),pendingReviewTriggers:expanded.pendingReviewTriggers||[]};
 if(expanded.type==='RADAR_SYNC')return {...base,portfolio:expanded.portfolio||null,positions:expanded.positions||[],radar:compactRadarForGpt(expanded.radarSnapshot||[]),pendingReviewTriggers:expanded.pendingReviewTriggers||[]};
 return {...base,stockContext:expanded.stockContext||null,portfolio:expanded.portfolio||null};
}
function buildClipboardText(expanded){
 const payload=clipboardPayload(expanded);
 return [
  '[EASON TRADING APP HANDOFF]',
  `任務：${handoffTask(expanded.type)}`,
  '以下資料是由 Eason Trading App/Backend 直接帶入這則訊息，不是 ChatGPT 已連上 Backend。請把這份資料當作持股、成交、Setup、Trigger 的事實來源；若要補最新公開新聞、籌碼或市場資訊，再自行上網查。',
  '重要：只有 actualTrading / trades / position ledger 代表真的成交；Playbook、Setup、GPT 建議都不等於成交。App 不做全市場選股；若任務是晚間選股，新的市場候選必須由 GPT 自己查公開資料後提出。',
  `handoff_id: ${expanded.id}`,
  '--- APP DATA BEGIN ---',
  JSON.stringify(payload,null,2),
  '--- APP DATA END ---',
  '',
  '【回寫 App 規則】如果你的結論會新增、保留、調整、降級或淘汰雷達標的，或建立下一個 GPT Review Trigger，請在正常中文回答最後附上一個機器可讀區塊。不要把持股、現金、成交、portfolio 或 ledger 放進這個區塊；這些只能由真實帳本修改。',
  '--- EASON_TRADING_UPDATE_V1 ---',
  JSON.stringify({version:1,handoffId:expanded.id,triggerEventId:expanded.event?.id||null,marketDate:'YYYY-MM-DD',summary:'一句話',setups:[{symbol:'6147',name:'頎邦',action:'UPSERT',priority:95,rating:'A',stage:'WAIT_PULLBACK',setupType:'SECOND_LEG',originalThesis:'第一段反轉成功，等待第二段',statusReason:'188.5-191 守住後再轉強',selectionValidity:'VALIDATED',entryOpportunity:'WAITING',playbook:{goodZone:[188.5,191],breakout:194,invalid:188,target1:198,target2:205,maxEntry:195,summary:'等第二段',nextStep:'守住後重新站194再複判'},reviewTriggers:[{label:'重新站回194且量能確認',conditions:{all:[{field:'price',op:'>=',value:194},{field:'rvol',op:'>=',value:1.3}]}}]}]},null,2),
  '--- END_EASON_TRADING_UPDATE ---',
  '只輸出你真的要更新的股票；沒有要改的不要硬塞。App 會在使用者按「套用 GPT 結果」後先預覽，再寫入雷達。'
 ].join('\n');
}
async function expandHandoffForGpt(id){
 const base=getHandoff(id);if(!base)return null;
 let expanded={...base,transferMode:'CLIPBOARD_STRUCTURED_DATA',generatedImage:false};
 if(base.type==='TRIGGER_REVIEW'&&base.symbol){
  const [oneMinuteFull,fiveMinute,daily]=await Promise.all([getCandles(base.symbol,'1m',360),getCandles(base.symbol,'5m',72),getCandles(base.symbol,'daily',60)]);
  const latestMarket=db.market[base.symbol]||null;
  const triggerMarket=base.snapshot?.marketAtTrigger||base.snapshot?.market||base.event?.market||null;
  const triggerAt=base.snapshot?.capturedAt||base.event?.triggeredAt||null;
  const triggerMs=parseTime(triggerAt);
  const allRows=oneMinuteFull?.data||[];
  const firstBarMs=parseTime(allRows[0]?.date);const lastBarMs=parseTime(allRows.at(-1)?.date);
  const coversTrigger=triggerMs!=null&&firstBarMs!=null&&lastBarMs!=null&&triggerMs>=firstBarMs-60_000&&triggerMs<=lastBarMs+60_000;
  const rows=allRows.filter(r=>{const t=parseTime(r.date);return triggerMs==null||t==null||t>=triggerMs-60_000;});
  const triggerPrice=Number(triggerMarket?.price||0);
  const highSince=rows.length?Math.max(...rows.map(r=>Number(r.high))):null;
  const lowSince=rows.length?Math.min(...rows.map(r=>Number(r.low))):null;
  const latestPrice=Number(latestMarket?.price||allRows.at(-1)?.close||triggerPrice||0);
  const delta=triggerPrice?latestPrice-triggerPrice:null;
  const observedAt=latestMarket?.updatedAt||oneMinuteFull?.updatedAt||new Date().toISOString();
  const comparison={
   triggerAt,latestObservedAt:observedAt,
   triggerPrice:triggerPrice||null,latestPrice:latestPrice||null,
   priceDelta:delta==null?null:Number(delta.toFixed(4)),priceDeltaPct:triggerPrice&&delta!=null?Number((delta/triggerPrice*100).toFixed(3)):null,
   highSinceTrigger:highSince,lowSinceTrigger:lowSince,
   mfePctLong:triggerPrice&&highSince!=null?Number(((highSince/triggerPrice-1)*100).toFixed(3)):null,
   maePctLong:triggerPrice&&lowSince!=null?Number(((lowSince/triggerPrice-1)*100).toFixed(3)):null,
   barsSinceTrigger:rows.length,
   coverage:coversTrigger?'FULL_INTRADAY_FROM_TRIGGER':'PARTIAL_OR_DIFFERENT_SESSION',
   availableFrom:allRows[0]?.date||null,availableTo:allRows.at(-1)?.date||null
  };
  expanded={...expanded,latestReviewData:{market:latestMarket,comparison,series:{oneMinute:compactSeries(oneMinuteFull,60),fiveMinute:compactSeries(fiveMinute,36),daily:compactSeries(daily,60)}}};
 }
 return {...expanded,copyText:buildClipboardText(expanded)};
}

http.createServer(async(req,res)=>{
 try{
  if(req.method==='OPTIONS') return send(res,204,{});
  const u=new URL(req.url||'/',`http://${req.headers.host}`); const p=u.pathname;
  if(req.method==='POST'&&p==='/v1/pairing/claim'){
    const x=await body(req);
    try{return send(res,200,{ok:true,...pairing.claim(x.code,clientId(req))});}
    catch(e){const msg=e?.message||'PAIRING_FAILED';return send(res,msg==='PAIRING_RATE_LIMITED'?429:400,{error:msg});}
  }
  if(!auth(req)) return send(res,401,{error:'unauthorized'});
  if(req.method==='POST'&&p==='/v1/pairing/start') return send(res,201,{ok:true,...pairing.start()});
  if(req.method==='GET'&&p==='/v1/pairing/status') return send(res,200,{ok:true,...pairing.status()});
  if(req.method==='GET'&&p==='/health') { const provider=providerStatus();const active=radar();const hydrated=active.filter(x=>x.dataTrusted).length;const fresh=active.filter(x=>x.dataFresh).length;const quotesReady=provider.verified&&fresh>=active.length;const cloudCfg=cloudMonitorConfig();const cloudTargets=buildMonitorTargets();const cloudReady=cloudTargets.filter(x=>x.cloudReady!==false);const cloudNotReady=cloudTargets.filter(x=>x.cloudReady===false).map(x=>({symbol:x.symbol,missing:x.cloudMissing||[]}));return send(res,200,{ok:true,service:'eason-trading',version:'0.3.18',marketDataConfigured:provider.configured,marketData:'fugle',marketDataVerified:provider.verified,marketDataError:provider.lastError||null,activeSymbols:active.length,hydratedSymbols:hydrated,freshSymbols:fresh,quotesReady,session:marketSession(),ledgerMode:db.metadata?.ledgerMode||'uninitialized',cloudMonitorConfigured:cloudCfg.configured,cloudMonitor:{configured:cloudCfg.configured,armed:cloudTargets.length,ready:cloudReady.length,notReady:cloudNotReady},gptDirect:gptDirectRuntimeStatus(),auditMode}); }
  if(req.method==='GET'&&p==='/v1/market-status'){const provider=providerStatus();return send(res,200,{...marketSession(),marketDataConfigured:provider.configured,marketDataVerified:provider.verified,marketDataError:provider.lastError||null});}
  if(req.method==='POST'&&p==='/v1/cloud-monitor/sync'){
   const completed={};
   const runStage=async(name,fn)=>{
    try{const value=await fn();completed[name]=value;return value}
    catch(e){const message=String(e?.message||e);const err=new Error(`Cloud sync failed at ${name}: ${message}`);err.stage=name;err.causeMessage=message;throw err}
   };
   try{
    const reviewStatuses=await runStage('syncReviewEventStatuses',()=>syncReviewEventStatuses());
    const reconcile=await runStage('reconcileCloudEvents',()=>reconcileCloudEvents());
    const sync=await runStage('syncCloudMonitor',()=>syncCloudMonitor());
    const devices=await runStage('syncAllCloudDevices',()=>syncAllCloudDevices());
    const gptState=await runStage('syncGptBridgeState',()=>syncGptBridgeState());
    const applyCommands=!auditMode&&u.searchParams.get('applyCommands')!=='false';
    const gptCommands=applyCommands?await runStage('reconcileGptCommands',()=>reconcileGptCommands()):{ok:true,skipped:true,reason:'applyCommands=false'};
    return send(res,200,{ok:true,reviewStatuses,reconcile,sync,devices,gptState,gptCommands});
   }catch(e){
    return send(res,502,{error:e.message,stage:e.stage||'unknown',cause:e.causeMessage||String(e?.message||e),completed});
   }
  }
  if(req.method==='GET'&&p==='/v1/founder-brief') return send(res,200,founderBrief());
  if(req.method==='GET'&&p==='/v1/portfolio') return send(res,200,founderBrief().portfolio);
  if(req.method==='GET'&&p==='/v1/positions') return send(res,200,founderBrief().positions);
  if(req.method==='POST'&&p==='/v1/positions'){const x=await body(req);const changed=setPosition(x,req.headers['x-source']||'app');let quote=null;if(process.env.FUGLE_API_KEY)quote=await hydrateQuote(changed.position.symbol);return send(res,201,{...changed,market:db.market[changed.position.symbol]||null,quoteHydration:quote});}
  if(req.method==='PATCH'&&p==='/v1/portfolio/cash'){const x=await body(req);return send(res,200,updateCash(x.cash,req.headers['x-source']||'app'));}
  if(req.method==='PATCH'&&/^\/v1\/positions\/[^/]+$/.test(p)){
    const symbol=decodeURIComponent(p.split('/')[3]);const x=await body(req);
    const changed=adjustPosition(symbol,x,req.headers['x-source']||'app');
    let quote=null;if(process.env.FUGLE_API_KEY)quote=await hydrateQuote(changed.position.symbol);
    return send(res,200,{...changed,market:db.market[changed.position.symbol]||null,quoteHydration:quote});
  }
  if(req.method==='DELETE'&&/^\/v1\/positions\/[^/]+$/.test(p)){const symbol=decodeURIComponent(p.split('/')[3]);return send(res,200,removePosition(symbol,req.headers['x-source']||'app'));}
  if(req.method==='GET'&&p==='/v1/watchlist') return send(res,200,db.watchlist);
  if(req.method==='GET'&&p==='/v1/radar') return send(res,200,radar());
  if(req.method==='GET'&&p==='/v1/setups') return send(res,200,listSetups({activeOnly:u.searchParams.get('active')!=='false'}));
  if(req.method==='GET'&&/^\/v1\/setups\/[^/]+$/.test(p)){const symbol=p.split('/')[3];return send(res,200,db.setups[symbol]||null);}
  if(req.method==='PATCH'&&/^\/v1\/setups\/[^/]+$/.test(p)){const symbol=p.split('/')[3];const x=await body(req);return send(res,200,updateSetup(symbol,x,req.headers['x-source']||'api'));}
  if(req.method==='POST'&&p==='/v1/hypotheses'){const x=await body(req);return send(res,201,recordHypothesis(x,req.headers['x-source']||'user'));}
  if(req.method==='PATCH'&&/^\/v1\/hypotheses\/[^/]+$/.test(p)){const id=p.split('/')[3];const x=await body(req);return send(res,200,updateHypothesis(id,x,req.headers['x-source']||'api'));}
  if(req.method==='GET'&&p==='/v1/settings') return send(res,200,getSettings());
  if(req.method==='PATCH'&&p==='/v1/settings'){const x=await body(req);const settings=updateSettings(x,req.headers['x-source']||'app');let cloudDevices=null;if(x.stockChatUrl!=null){try{cloudDevices=await syncAllCloudDevices()}catch(e){cloudDevices={ok:false,error:e.message}}}return send(res,200,{...settings,cloudDevices});}
  if(req.method==='POST'&&p==='/v1/gpt-direct/sync'){const state=await syncGptBridgeState();const commands=auditMode?{ok:true,skipped:true,reason:'audit-mode'}:await reconcileGptCommands();return send(res,200,{ok:true,state,commands});}
  if(req.method==='POST'&&p==='/v1/gpt-direct/roundtrip-test'){const x=await body(req);const ping=await reconcileGptPingCommand(x.commandId);return send(res,200,{ok:true,ping});}
  if(req.method==='GET'&&p==='/v1/alerts') return send(res,200,alertsSince(u.searchParams.get('since')));
  if(req.method==='GET'&&p==='/v1/reviews') return send(res,200,listReviews());
  if(req.method==='POST'&&p==='/v1/focus'){const x=await body(req);return send(res,200,setFocusSymbol(x.symbol||null));}
  if(req.method==='DELETE'&&p==='/v1/focus') return send(res,200,setFocusSymbol(null));
  if(req.method==='GET'&&/^\/v1\/stocks\/[^/]+\/context$/.test(p)){
    const symbol=decodeURIComponent(p.split('/')[3]);
    const current=db.market[symbol];
    const needsQuote=!!process.env.FUGLE_API_KEY&&(!current||!String(current.source||'').startsWith('fugle')||!Number.isFinite(Number(current.price))||Number(current.price)<=0);
    if(needsQuote)await hydrateQuote(symbol);
    const market=db.market[symbol]||null;const freshness=marketFreshness(market);
    return send(res,200,{symbol,position:founderBrief().positions.find(x=>x.symbol===symbol)||null,watch:db.watchlist.find(x=>x.symbol===symbol)||null,market:market?{...market,dataTrusted:freshness.trusted,dataFresh:freshness.fresh,quoteAgeSeconds:freshness.ageSeconds}:null,playbook:db.playbooks[symbol]||null,setup:db.setups[symbol]||null,hypotheses:db.hypotheses.filter(x=>x.symbol===symbol).slice().reverse(),trades:db.trades.filter(x=>x.symbol===symbol).slice().reverse(),reviewTriggers:listReviewTriggers({status:'ARMED',symbol}),triggerEvents:listTriggerEvents({symbol,limit:10}),setupEvents:db.setupEvents.filter(x=>x.symbol===symbol).slice(-30).reverse(),audit:db.audit.filter(x=>x.symbol===symbol).slice(-30).reverse()});
  }
  if(req.method==='GET'&&/^\/v1\/stocks\/[^/]+\/candles$/.test(p)){const symbol=p.split('/')[3];return send(res,200,await getCandles(symbol,u.searchParams.get('mode')||'intraday',u.searchParams.get('limit')||80));}
  if(req.method==='POST'&&p==='/v1/ledger/initialize'){const x=await body(req);if(!Array.isArray(x.positions)||!Number.isFinite(Number(x.cash)))return send(res,400,{error:'cash and positions required'});return send(res,200,initializeLedger(x,req.headers['x-source']||'api'));}
  if(req.method==='GET'&&p==='/v1/review-triggers') return send(res,200,listReviewTriggers({status:u.searchParams.get('status')||undefined,symbol:u.searchParams.get('symbol')||undefined}));
  if(req.method==='POST'&&p==='/v1/review-triggers'){const x=await body(req);if(!x.symbol||!x.conditions)return send(res,400,{error:'symbol and conditions required'});const row=createReviewTrigger(x,req.headers['x-source']||'api');let cloudMonitor=null;try{cloudMonitor=await syncCloudMonitor()}catch(e){cloudMonitor={ok:false,error:e.message}}return send(res,201,{...row,cloudMonitor});}
  if(req.method==='PATCH'&&/^\/v1\/review-triggers\/[^/]+$/.test(p)){const id=p.split('/')[3];const x=await body(req);const row=updateReviewTrigger(id,x,req.headers['x-source']||'api');let cloudMonitor=null;try{cloudMonitor=await syncCloudMonitor()}catch(e){cloudMonitor={ok:false,error:e.message}}return send(res,200,{...row,cloudMonitor});}
  if(req.method==='DELETE'&&/^\/v1\/review-triggers\/[^/]+$/.test(p)){const id=p.split('/')[3];const row=updateReviewTrigger(id,{status:'CANCELLED'},req.headers['x-source']||'api');let cloudMonitor=null;try{cloudMonitor=await syncCloudMonitor()}catch(e){cloudMonitor={ok:false,error:e.message}}return send(res,200,{...row,cloudMonitor});}
  if(req.method==='GET'&&p==='/v1/trigger-events') return send(res,200,listTriggerEvents({symbol:u.searchParams.get('symbol')||undefined,limit:u.searchParams.get('limit')||50}));
  if(req.method==='GET'&&p==='/v1/gpt-review-inbox') return send(res,200,listReviewInbox({status:u.searchParams.get('status')||undefined,limit:u.searchParams.get('limit')||100}));
  if(req.method==='PATCH'&&/^\/v1\/gpt-review-inbox\/[^/]+$/.test(p)){const id=decodeURIComponent(p.split('/')[3]);const x=await body(req);return send(res,200,updateReviewInboxEvent(id,x.status,req.headers['x-source']||'app'));}
  if(req.method==='GET'&&/^\/v1\/trigger-snapshots\/[^/]+$/.test(p)){const id=p.split('/')[3];const x=getTriggerSnapshot(id);return x?send(res,200,x):send(res,404,{error:'snapshot not found'});}
  if(req.method==='GET'&&p==='/v1/close-packages/latest'){maybeGenerateClosePackage();const x=latestClosePackage();return x?send(res,200,x):send(res,404,{error:'close package not ready'});}
  if(req.method==='POST'&&p==='/v1/close-packages/generate'){const x=await body(req);return send(res,201,generateClosePackage({date:x.date,force:x.force===true}));}
  if(req.method==='GET'&&p==='/v1/handoffs') return send(res,200,listHandoffs({status:u.searchParams.get('status')||'READY',limit:u.searchParams.get('limit')||50}));
  if(req.method==='POST'&&p==='/v1/handoffs'){const x=await body(req);const row=createHandoff(x,req.headers['x-source']||'app');let gptBridge={ok:false,skipped:true};try{gptBridge=await syncGptBridgeState()}catch(e){gptBridge={ok:false,error:e.message}}return send(res,201,{...row,gptBridge});}
  if(req.method==='GET'&&/^\/v1\/handoffs\/[^/]+$/.test(p)){const id=decodeURIComponent(p.split('/')[3]).replace(/^#/,'');const x=await expandHandoffForGpt(id);return x?send(res,200,x):send(res,404,{error:'handoff not found'});}
  if(req.method==='PATCH'&&/^\/v1\/handoffs\/[^/]+\/ack$/.test(p)){const id=decodeURIComponent(p.split('/')[3]).replace(/^#/,'');return send(res,200,acknowledgeHandoff(id,req.headers['x-source']||'chatgpt'));}
  if(req.method==='POST'&&p==='/v1/gpt-updates/preview'){const x=await body(req);return send(res,200,previewGptUpdate(x.text||''));}
  if(req.method==='POST'&&p==='/v1/gpt-updates/apply'){const x=await body(req);const applied=applyGptUpdate(x.text||'',req.headers['x-source']||'gpt-clipboard');for(const symbol of applied.touched||[]){try{if(process.env.FUGLE_API_KEY)await hydrateQuote(symbol);}catch{}}let cloudMonitor=null;try{if(applied.cloudEventId)await updateCloudEventStatus(applied.cloudEventId,'COMPLETED');await reconcileCloudEvents();cloudMonitor=await syncCloudMonitor()}catch(e){cloudMonitor={ok:false,error:e.message}}return send(res,200,{...applied,cloudMonitor,radar:radar()});}
  if(req.method==='POST'&&p==='/v1/gpt-updates/undo') return send(res,200,{...undoLastGptUpdate(req.headers['x-source']||'app'),radar:radar()});
  if(req.method==='POST'&&p==='/v1/trades/parse'){const x=await body(req);const parsed=parseQuickTrade(x.text||'',{resolveName:name=>{const q=String(name||'').trim();const rows=[...db.positions,...db.watchlist,...Object.values(db.market||{})];const hit=rows.find(r=>String(r?.name||'').trim()===q);return hit?{symbol:hit.symbol,name:hit.name}:null;}});return send(res,200,parsed);}
  if(req.method==='POST'&&p==='/v1/trades/preview'){const x=await body(req);return send(res,200,previewTrade(x));}
  if(req.method==='POST'&&p==='/v1/trades'){const x=await body(req); if(!['BUY','SELL'].includes(x.side)||!x.symbol||!(x.quantity>0)||!(x.price>0)) return send(res,400,{error:'invalid trade'});return send(res,201,recordTrade(x,req.headers['x-source']||'user'));}
  if(req.method==='PATCH'&&/^\/v1\/playbooks\/[^/]+$/.test(p)){const symbol=p.split('/')[3];const x=await body(req);return send(res,200,updatePlaybook(symbol,x,req.headers['x-source']||'api'));}
  if(req.method==='POST'&&p==='/v1/watchlist'){
    const x=await body(req);if(!x.symbol)return send(res,400,{error:'symbol required'});
    const added=addWatch(x,req.headers['x-source']||'api');let quote=null;
    if(process.env.FUGLE_API_KEY)quote=await hydrateQuote(x.symbol);
    return send(res,201,{...added,market:db.market[x.symbol]||null,quoteHydration:quote});
  }
  if(req.method==='DELETE'&&/^\/v1\/watchlist\/[^/]+$/.test(p)){const symbol=p.split('/')[3];const x=await body(req);return send(res,200,dropWatch(symbol,x,req.headers['x-source']||'api'));}
  if(req.method==='POST'&&p==='/v1/reviews'){const x=await body(req);if(!x.symbol)return send(res,400,{error:'symbol required'});return send(res,201,recordReview(x,req.headers['x-source']||'api'));}
  if(req.method==='POST'&&p==='/v1/devices'){const x=await body(req);if(!x.token)return send(res,400,{error:'token required'});const row=registerDevice({...x,enabled:x.enabled!==false});let cloudDevice=null;try{cloudDevice=await syncCloudDevice(row.token,row.platform||'',db.settings?.stockChatUrl||'')}catch(e){cloudDevice={ok:false,error:e.message}}return send(res,201,{...row,cloudDevice});}
  if(req.method==='POST'&&p==='/v1/alerts/evaluate'){const x=await body(req);return send(res,200,{events:evaluate(x.snapshot,x.playbook,x.previous)});}
  return send(res,404,{error:'not found'});
 }catch(e){return send(res,400,{error:e.message||'bad request'});}
}).listen(port,async()=>{
 console.log(`Eason Trading API http://localhost:${port}`);
 try{const p=await verifyProvider();if(!p.verified)console.error(`[fugle] verification failed: ${p.lastError||'unknown error'}`);const x=await bootstrapQuotes();if(x.enabled)console.log(`[scanner] startup hydration scanned ${x.scanned||0}, failed ${x.failed||0}`);}catch(e){console.error('[scanner hydration]',e.message)}
 try{maybeGenerateClosePackage();}catch(e){console.error('[close package]',e.message)}
 try{if(cloudMonitorConfig().configured){await syncReviewEventStatuses();await reconcileCloudEvents();await syncCloudMonitor();await syncAllCloudDevices();await syncGptBridgeState();if(!auditMode)await reconcileGptCommands();console.log(`[cloud monitor] startup reconcile/sync complete${auditMode?' (audit mode: commands held)':''}`)}}catch(e){console.error('[cloud monitor startup sync]',e.message)}
 setInterval(()=>{try{maybeGenerateClosePackage();}catch(e){console.error('[close package]',e.message)}},60_000);
 setInterval(()=>{if(cloudMonitorConfig().configured)Promise.all([syncReviewEventStatuses(),reconcileCloudEvents(),syncCloudMonitor()]).catch(e=>console.error('[cloud monitor reconcile/sync]',e.message));},60_000);
 setInterval(()=>{if(cloudMonitorConfig().configured){if(auditMode)syncGptBridgeState().catch(e=>console.error('[gpt direct state sync]',e.message));else Promise.all([reconcileGptCommands(),syncGptBridgeState()]).catch(e=>console.error('[gpt direct reconcile/sync]',e.message));}},15_000);
 startScanner({skipBootstrap:true});createFocusStream().start();startDisclosures();
});
