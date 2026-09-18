import { createFugleRest, normalizeQuote } from './fugle.mjs';
import { addAlerts, db, updateMarket } from './store.mjs';
import { evaluate } from './alerts.mjs';
import { notifyAlerts } from './notifier.mjs';
import { baselineNeedsRefresh, getVolumeBaseline, isTradingWindow, refreshVolumeBaseline, relativeVolume } from './volume-baseline.mjs';
import { processReviewTriggers } from './review-triggers.mjs';

const rest=createFugleRest();
const intervalMs=Number(process.env.RADAR_INTERVAL_MS||60000);
// Leave headroom inside Fugle Basic REST quota for one baseline refresh and manual app calls.
const maxPerMinute=Math.min(45,Number(process.env.RADAR_MAX_PER_MIN||45));
let cursor=0, baselineCursor=0;
const provider={configured:!!rest,verified:false,lastCheckedAt:null,lastError:null};


export function providerStatus(){return {...provider};}
export async function verifyProvider(){
 provider.lastCheckedAt=new Date().toISOString();
 if(!rest){provider.configured=false;provider.verified=false;provider.lastError='FUGLE_API_KEY not set';return providerStatus();}
 try{
  const q=normalizeQuote(await rest.quote('2330'));
  if(!q?.price||!Number.isFinite(Number(q.price)))throw new Error('Fugle verification returned no price');
  provider.configured=true;provider.verified=true;provider.lastError=null;
 }catch(e){provider.configured=true;provider.verified=false;provider.lastError=e?.message||String(e);}
 return providerStatus();
}

function activeSymbols(){
 return db.watchlist.filter(x=>!['DROP','CLOSED'].includes(x.state)).sort((a,b)=>b.priority-a.priority).map(x=>x.symbol);
}

async function scanSymbols(symbols,{date=new Date(),evaluateAlerts=true,processReviews=true}={}){
 const events=[];let scanned=0,failed=0;
 for(const symbol of symbols){
  try{
   const previous=db.market[symbol]||{}; const q=normalizeQuote(await rest.quote(symbol)); provider.verified=true;provider.lastCheckedAt=new Date().toISOString();provider.lastError=null;
   const baseline=getVolumeBaseline(symbol); const computed=relativeVolume(q.volume,baseline?.avgDailyVolume,date);
   q.rvol=computed ?? previous.rvol ?? 1;
   updateMarket(q); scanned++;
   const pb=db.playbooks[symbol];
   if(evaluateAlerts&&pb)events.push(...evaluate(q,pb,{breakout:previous.price>=pb.breakout&&previous.rvol>=1.5,invalid:previous.price<=pb.invalid,goodZone:pb.goodZone&&previous.price>=pb.goodZone[0]&&previous.price<=pb.goodZone[1]}));
   if(processReviews){const reviewEvents=await processReviewTriggers(q);events.push(...reviewEvents);}
  }catch(e){failed++;console.error('[scanner]',symbol,e.message);}
 }
 const added=addAlerts(events);if(added.length)await notifyAlerts(added);
 return {scanned,failed,events:added.length};
}


export async function hydrateQuote(symbol,{date=new Date()}={}){
 if(!rest) return {enabled:false,ok:false,reason:'FUGLE_API_KEY not set'};
 const id=String(symbol||'').trim();
 if(!id) return {enabled:true,ok:false,reason:'symbol required'};
 try{
  const previous=db.market[id]||{};
  const q=normalizeQuote(await rest.quote(id)); provider.verified=true;provider.lastCheckedAt=new Date().toISOString();provider.lastError=null;
  const baseline=getVolumeBaseline(id); const computed=relativeVolume(q.volume,baseline?.avgDailyVolume,date);
  q.rvol=computed ?? previous.rvol ?? 1;
  const market=updateMarket(q);
  return {enabled:true,ok:true,market};
 }catch(e){
  console.error('[hydrateQuote]',id,e.message);
  return {enabled:true,ok:false,reason:e.message};
 }
}

export async function bootstrapQuotes({date=new Date()}={}){
 if(!rest) return {enabled:false,reason:'FUGLE_API_KEY not set'};
 const verified=await verifyProvider();if(!verified.verified)return {enabled:true,scanned:0,failed:0,reason:verified.lastError||'Fugle verification failed'};
 const symbols=activeSymbols().slice(0,maxPerMinute);
 if(!symbols.length)return {enabled:true,scanned:0,failed:0};
 // Always hydrate latest quotes at startup, even after market close. This replaces demo seed values.
 const result=await scanSymbols(symbols,{date,evaluateAlerts:false,processReviews:false});
 return {enabled:true,...result,reason:'bootstrap latest quote'};
}

export async function scanOnce({force=false,date=new Date(),skipBaselines=false}={}){
 if(!rest) return {enabled:false,reason:'FUGLE_API_KEY not set'};
 if(!force&&!isTradingWindow(date))return {enabled:true,scanned:0,reason:'outside trading window'};
 const symbols=activeSymbols();
 if(!symbols.length)return {enabled:true,scanned:0};
 // Bootstrap/refresh a few historical-volume baselines per minute while keeping free REST headroom.
 if(!skipBaselines){
  let refreshed=0;
  for(let tries=0;tries<symbols.length&&refreshed<5;tries++){
    const symbol=symbols[(baselineCursor+tries)%symbols.length];
    if(baselineNeedsRefresh(symbol,date)){
      try{await refreshVolumeBaseline(symbol,rest,date);refreshed++;}catch(e){console.error('[baseline]',symbol,e.message);}
    }
    baselineCursor=(baselineCursor+1)%symbols.length;
  }
 }
 const batch=[];for(let i=0;i<Math.min(maxPerMinute,symbols.length);i++)batch.push(symbols[(cursor+i)%symbols.length]);
 const result=await scanSymbols(batch,{date,evaluateAlerts:true});
 cursor=(cursor+batch.length)%symbols.length;
 return {enabled:true,...result};
}

export function startScanner({skipBootstrap=false}={}){
 if(!rest){console.log('[scanner] disabled: set FUGLE_API_KEY to enable free REST rotation');return;}
 if(!skipBootstrap)bootstrapQuotes().then(x=>console.log(`[scanner] bootstrap scanned ${x.scanned||0}, failed ${x.failed||0}`)).catch(e=>console.error('[scanner bootstrap]',e.message));
 setInterval(()=>scanOnce().catch(console.error),intervalMs);
 console.log(`[scanner] enabled every ${intervalMs}ms, max ${maxPerMinute} quotes/min + up to 5 baseline refreshes`);
}
