import type { AppSettings, ChartMode, ChartSeries, ClosePackage, Handoff, HealthStatus, RadarAlert, ReviewTrigger, StockContext, StockSnapshot, TradeReview, TradeSide, TriggerEvent } from './types/trading';
import { connectionReady, getConnection, initializeConnection, normalizeApiUrl, saveConnection } from './connection';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
function headers(key:string,extra:Record<string,string>={}){return {'content-type':'application/json',...(key?{'x-api-key':key}:{}),...extra};}
async function timedFetch(url:string,init:RequestInit={},ms=10000){const controller=new AbortController(),id=setTimeout(()=>controller.abort(),ms);try{return await fetch(url,{...init,signal:controller.signal})}catch(e:any){if(e?.name==='AbortError')throw new Error('連線逾時，請確認網路後重試');throw e}finally{clearTimeout(id)}}
async function request<T>(path:string,init:RequestInit={}):Promise<T>{await initializeConnection();const c=getConnection();if(!connectionReady(c))throw new Error('PAIRING_REQUIRED');const r=await timedFetch(`${c.apiUrl}${path}`,{...init,headers:headers(c.apiKey,(init.headers||{}) as Record<string,string>)});if(!r.ok){let msg=`API ${r.status}`;try{const x=await r.json();msg=x.error||msg}catch{}throw new Error(msg)}return r.json();}
export function apiConnection(){return getConnection();}
export async function claimPairing(apiUrl:string,code:string){const base=normalizeApiUrl(apiUrl);const r=await timedFetch(`${base}/v1/pairing/claim`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:String(code||'').trim()})});let x:any={};try{x=await r.json()}catch{}if(!r.ok)throw new Error(x.error==='PAIRING_CODE_INVALID'?'配對碼錯誤或已失效':x.error==='PAIRING_RATE_LIMITED'?'配對嘗試太多，請在電腦重新產生配對碼':x.error||`Pair API ${r.status}`);if(!x.apiKey)throw new Error('Backend 沒有回傳配對 token');await saveConnection(base,String(x.apiKey),x.ledgerCloud);return {ok:true,apiUrl:base};}

const SEQ_KEY='eason_trading_ledger_sequence_v1';let sequenceLock=Promise.resolve(0);
function storage(){try{return (globalThis as any).localStorage||null}catch{return null}}
async function nextSequence(){sequenceLock=sequenceLock.then(async()=>{const raw=Platform.OS==='web'?storage()?.getItem(SEQ_KEY):await SecureStore.getItemAsync(SEQ_KEY);const n=Math.max(0,Number(raw)||0)+1;if(Platform.OS==='web')storage()?.setItem(SEQ_KEY,String(n));else await SecureStore.setItemAsync(SEQ_KEY,String(n));return n});return sequenceLock;}
function mutationId(){return `lm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,12)}`}
export type LedgerMutationStatus='pending'|'applied'|'rejected';
export async function queueLedgerMutation(mutationType:string,payload:Record<string,unknown>){await initializeConnection();const c=getConnection();if(!c.cloudUrl||!c.deviceId||!c.deviceToken)throw new Error('尚未取得雲端待同步憑證，請在電腦開啟時重新配對一次');const id=mutationId(),clientSequence=await nextSequence(),body=JSON.stringify({mutationId:id,idempotencyKey:id,clientSequence,schemaVersion:1,mutationType,payload});const init={method:'POST',headers:{'content-type':'application/json','x-device-id':c.deviceId,'x-device-token':c.deviceToken},body};let last:any;for(let i=0;i<2;i++){try{const r=await timedFetch(`${c.cloudUrl}/v1/ledger/mutations`,init,8000);const x:any=await r.json().catch(()=>({}));if(!r.ok)throw new Error(x.error||`Cloud API ${r.status}`);return x.mutation}catch(e){last=e;if(i===0)continue}}throw new Error(last?.message||'無法連線雲端；這筆變更尚未提交，請稍後重試');}
export async function fetchLedgerMutationStatuses(){await initializeConnection();const c=getConnection();if(!c.cloudUrl||!c.deviceId||!c.deviceToken)return [];const r=await timedFetch(`${c.cloudUrl}/v1/ledger/mutations`,{headers:{'x-device-id':c.deviceId,'x-device-token':c.deviceToken}},8000);if(!r.ok)throw new Error(`Cloud API ${r.status}`);return r.json();}
export async function fetchRadar():Promise<StockSnapshot[]>{const data:any[]=await request('/v1/radar');const n=(v:any)=>Number.isFinite(Number(v))?Number(v):Number.NaN;return data.map(x=>({symbol:x.symbol,name:x.name||x.symbol,price:n(x.price),changePct:n(x.changePct),high:n(x.high),low:n(x.low),vwap:n(x.vwap),rvol:n(x.rvol),dataSource:x.source||'unavailable',dataTrusted:x.dataTrusted===true,dataFresh:x.dataFresh!==false,quoteAgeSeconds:x.quoteAgeSeconds??null,updatedAt:x.updatedAt,rating:x.rating,state:x.state,priority:x.priority,nextStep:x.playbook?.nextStep||'',summary:x.playbook?.summary,goodZone:x.playbook?.goodZone,breakout:x.playbook?.breakout,invalid:x.playbook?.invalid,target1:x.playbook?.target1,target2:x.playbook?.target2,maxEntry:x.playbook?.maxEntry,reviewTriggerPrice:x.playbook?.reviewTriggerPrice,reviewTriggerLabel:x.playbook?.reviewTriggerLabel,position:x.position?{quantity:x.position.quantity,averageCost:x.position.averageCost,day:x.position.day||1,openedAt:x.position.openedAt}:undefined,spark:x.spark,setup:x.setup,setupStage:x.setup?.stage,selectionValidity:x.setup?.selectionValidity,entryOpportunity:x.setup?.entryOpportunity,discoveredAt:x.setup?.discoveredAt,setupReason:x.setup?.statusReason}));}
export async function fetchFounderBrief(){return request<any>('/v1/founder-brief');}
export async function fetchReviews():Promise<TradeReview[]>{return request('/v1/reviews');}
export async function fetchStockContext(symbol:string):Promise<StockContext>{return request(`/v1/stocks/${encodeURIComponent(symbol)}/context`);}
export async function fetchAlerts(since?:string):Promise<RadarAlert[]>{const rows:any[]=await request(`/v1/alerts${since?`?since=${encodeURIComponent(since)}`:''}`);return rows.map(x=>({...x,createdAt:x.createdAt||x.created_at,body:x.body||''}));}
export async function fetchCandles(symbol:string,mode:ChartMode):Promise<ChartSeries>{const limit=mode==='timeline'?300:mode==='1m'?120:mode==='5m'?54:mode==='daily'?60:40;return request(`/v1/stocks/${encodeURIComponent(symbol)}/candles?mode=${mode}&limit=${limit}`);}
export async function parseQuickTrade(text:string){return request<any>('/v1/trades/parse',{method:'POST',headers:{'x-source':'app'},body:JSON.stringify({text})});}
export async function previewTrade(input:{symbol:string;name?:string;side:TradeSide;quantity:number;price:number;dayTrade?:boolean}){return request<any>('/v1/trades/preview',{method:'POST',headers:{'x-source':'app'},body:JSON.stringify(input)});}
export async function recordTrade(input:{symbol:string;name?:string;side:TradeSide;quantity:number;price:number;dayTrade?:boolean}){return queueLedgerMutation('TRADE_RECORD',input);}

export async function adjustPosition(symbol:string,input:{symbol:string;quantity:number;averageCost:number},expectedPosition?:{quantity:number;averageCost:number}){
  return queueLedgerMutation('POSITION_ADJUST',{...input,expectedSymbol:symbol,...(expectedPosition?{expectedPosition}:{})});
}

export async function addPosition(input:{symbol:string;name?:string;quantity:number;averageCost:number}){return queueLedgerMutation('POSITION_ADD',{...input,expectedPosition:null});}
export async function removePosition(symbol:string,expectedPosition?:{quantity:number;averageCost:number}){return queueLedgerMutation('POSITION_REMOVE',{symbol,...(expectedPosition?{expectedPosition}:{})});}
export async function updateCash(cash:number,expectedCash?:number){return queueLedgerMutation('CASH_SET',{cash,...(expectedCash!==undefined?{expectedCash}:{})});}
export async function addWatch(input:{symbol:string;name?:string;rating?:string;priority?:number;setupType?:string;originalThesis?:string}){return request('/v1/watchlist',{method:'POST',headers:{'x-source':'app'},body:JSON.stringify(input)});}
export async function dropWatch(symbol:string,reason='使用者從單股頁手動封存'){return request(`/v1/watchlist/${encodeURIComponent(symbol)}`,{method:'DELETE',headers:{'x-source':'app'},body:JSON.stringify({reasonCode:'MANUAL',reason})});}
export async function registerDevice(token:string,platform:string){return request('/v1/devices',{method:'POST',body:JSON.stringify({token,platform,enabled:true})});}

export async function fetchHealth():Promise<HealthStatus>{return request('/health');}
export async function fetchReviewTriggers(status?:string,symbol?:string):Promise<ReviewTrigger[]>{const q=new URLSearchParams();if(status)q.set('status',status);if(symbol)q.set('symbol',symbol);return request(`/v1/review-triggers${q.toString()?`?${q}`:''}`);}
export async function createReviewTrigger(input:{symbol:string;label?:string;purpose?:'REVIEW'|'INVALIDATION'|'TARGET';conditions:{all?:Array<{field:string;op:string;value:number}>;any?:Array<{field:string;op:string;value:number}>;invalidation?:{all?:Array<{field:string;op:string;value:number}>;any?:Array<{field:string;op:string;value:number}>}};policy?:{oneShot?:boolean;minConsecutive?:number;cooldownMinutes?:number};expiresAt?:string}){return request('/v1/review-triggers',{method:'POST',headers:{'x-source':'app'},body:JSON.stringify(input)});}
export async function fetchTriggerEvents(symbol?:string):Promise<TriggerEvent[]>{return request(`/v1/trigger-events${symbol?`?symbol=${encodeURIComponent(symbol)}`:''}`);}
export async function fetchTriggerSnapshot(id:string){return request(`/v1/trigger-snapshots/${encodeURIComponent(id)}`);}

export async function setBackendFocus(symbol?:string){return request('/v1/focus',{method:symbol?'POST':'DELETE',headers:{'x-source':'app'},body:symbol?JSON.stringify({symbol}):undefined});}
export async function fetchLatestClosePackage():Promise<ClosePackage|null>{try{return await request('/v1/close-packages/latest')}catch{return null}}
export async function generateClosePackage():Promise<ClosePackage>{return request('/v1/close-packages/generate',{method:'POST',headers:{'x-source':'app'},body:JSON.stringify({force:true})});}
export async function fetchSettings():Promise<AppSettings>{return request('/v1/settings');}
export async function saveSettings(input:Partial<AppSettings>):Promise<AppSettings>{return request('/v1/settings',{method:'PATCH',headers:{'x-source':'app'},body:JSON.stringify(input)});}
export async function createHandoff(input:{type:'TRIGGER_REVIEW'|'CLOSE_REVIEW'|'NIGHT_SELECTION'|'STOCK_REVIEW'|'RADAR_SYNC';symbol?:string;eventId?:string;snapshotId?:string;closePackageId?:string}):Promise<Handoff>{return request('/v1/handoffs',{method:'POST',headers:{'x-source':'app'},body:JSON.stringify(input)});}
export async function fetchHandoff(id:string):Promise<Handoff>{return request(`/v1/handoffs/${encodeURIComponent(id)}`);}

export async function previewGptUpdate(text:string){return request<any>('/v1/gpt-updates/preview',{method:'POST',headers:{'x-source':'app'},body:JSON.stringify({text})});}
export async function applyGptUpdate(text:string){return request<any>('/v1/gpt-updates/apply',{method:'POST',headers:{'x-source':'app'},body:JSON.stringify({text})});}

export async function fetchReviewInbox(status?:'PENDING'|'GPT_SENT'|'COMPLETED'){return request<any[]>(`/v1/gpt-review-inbox${status?`?status=${status}`:''}`);}
export async function updateReviewInboxEvent(id:string,status:'PENDING'|'GPT_SENT'|'COMPLETED'){return request(`/v1/gpt-review-inbox/${encodeURIComponent(id)}`,{method:'PATCH',headers:{'x-source':'app'},body:JSON.stringify({status})});}
export async function undoLastGptUpdate(){return request<any>('/v1/gpt-updates/undo',{method:'POST',headers:{'x-source':'app'},body:'{}'});}

export async function fetchCloudReviewHandoff(url:string){
 const r=await fetch(url,{headers:{'content-type':'application/json'}});
 if(!r.ok){let msg=`Cloud API ${r.status}`;try{const x:any=await r.json();msg=x.error||msg}catch{}throw new Error(msg)}
 return r.json() as Promise<{ok:boolean;event:any;monitorOnly:boolean}>;
}
