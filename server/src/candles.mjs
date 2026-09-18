import { createFugleRest } from './fugle.mjs';
import { db } from './store.mjs';
import { mockCandles } from './market-history.mjs';
const rest=createFugleRest();
const cache=new Map();
const ttl={timeline:5_000,'1m':5_000,'5m':8_000,daily:60_000,weekly:300_000};
function dateOnly(d){return d.toISOString().slice(0,10);}
function cacheKey(symbol,mode,limit){return `${symbol}:${mode}:${limit}`;}
function getCache(key,mode){const x=cache.get(key);if(!x||Date.now()-x.at>(ttl[mode]||60_000))return null;return {...x.value,cached:true};}
function getStaleLive(key){const x=cache.get(key);if(!x||!String(x.value?.source||'').startsWith('fugle'))return null;return {...x.value,cached:true,stale:true};}
function setCache(key,value){cache.set(key,{at:Date.now(),value});return value;}
function normalizeRows(rows=[],{volumeScale=1}={}){
 let pv=0,v=0;
 return rows.map(r=>{const volume=Number(r.volume??r.tradeVolume??0)*volumeScale,open=Number(r.open),high=Number(r.high),low=Number(r.low),close=Number(r.close);pv+=close*volume;v+=volume;return {date:r.date||r.time||r.timestamp,open,high,low,close,volume,average:Number(r.average??r.avgPrice??(pv/Math.max(1,v)))};});
}
export function historicalVolumeScale(payload={}){
 // Fugle v1.0 uses lots for listed/OTC intraday candles, but shares for daily/weekly/monthly candles.
 // Normalize all listed/OTC chart volumes to lots so live quote + historical bars are comparable.
 const market=String(payload.market||'').toUpperCase();
 const type=String(payload.type||'').toUpperCase();
 if(type==='INDEX')return 1;
 if(market==='TSE'||market==='OTC')return 1/1000;
 return 1;
}
function weekKey(value){
 const d=new Date(value); if(Number.isNaN(d.getTime()))return String(value).slice(0,10);
 const u=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));
 const day=(u.getUTCDay()+6)%7;u.setUTCDate(u.getUTCDate()-day);
 return u.toISOString().slice(0,10);
}
export function aggregateWeekly(rows=[]){
 const map=new Map();
 for(const r of rows){
  const k=weekKey(r.date);const prev=map.get(k);
  if(!prev){map.set(k,{date:k,open:r.open,high:r.high,low:r.low,close:r.close,volume:r.volume||0,average:r.average??r.close});continue;}
  prev.high=Math.max(prev.high,r.high);prev.low=Math.min(prev.low,r.low);prev.close=r.close;prev.volume+=(r.volume||0);
  // Approximate weekly average with close-volume weighting; chart VWAP is not used for weekly decisions.
  prev.average=((prev.average*(prev.volume-(r.volume||0)))+(r.close*(r.volume||0)))/Math.max(1,prev.volume);
 }
 return [...map.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
}
export function mergeLiveBar(rows,mode,market,{historicalIncludesToday=false,now=new Date()}={}){
 if(!rows.length||!market?.price||!['daily','weekly'].includes(mode))return rows;
 const last={...rows.at(-1)};const key=mode==='weekly'?weekKey(now):dateOnly(now);
 const lastKey=mode==='weekly'?weekKey(last.date):dateOnly(new Date(last.date));
 if(lastKey===key){
   last.close=market.price;last.high=Math.max(last.high,market.high||market.price);last.low=Math.min(last.low,market.low||market.price);
   if(mode==='daily') last.volume=market.volume||last.volume;
   else if(!historicalIncludesToday) last.volume=(last.volume||0)+(market.volume||0);
   return [...rows.slice(0,-1),last];
 }
 return [...rows,{date:mode==='weekly'?key:now.toISOString(),open:market.open||market.price,high:market.high||market.price,low:market.low||market.price,close:market.price,volume:market.volume||0,average:market.vwap||market.price}];
}
export async function getCandles(symbol,mode='timeline',limit=80){
 const valid=['timeline','1m','5m','daily','weekly'];mode=valid.includes(mode)?mode:'timeline';
 const safeLimit=Math.max(10,Math.min(360,Number(limit)||80));
 const key=cacheKey(symbol,mode,safeLimit);const hit=getCache(key,mode);if(hit)return hit;
 if(rest){
  try{
   if(['timeline','1m','5m'].includes(mode)){
    const timeframe=mode==='5m'?'5':'1';const x=await rest.candles(symbol,timeframe);const data=normalizeRows((x.data||[]).slice(-safeLimit));
    return setCache(key,{symbol,mode,source:'fugle-live',updatedAt:new Date().toISOString(),data});
   }
   const to=new Date();const from=new Date(to);from.setDate(from.getDate()-(mode==='weekly'?350:150));
   // Fugle historical ranges must stay below one year. Weekly is built locally from daily candles.
   const x=await rest.historicalCandles(symbol,dateOnly(from),dateOnly(to),'D');
   const volumeScale=historicalVolumeScale(x);
   let daily=normalizeRows((x.data||[]).reverse(),{volumeScale});
   const today=dateOnly(new Date());
   const historicalIncludesToday=daily.some(r=>String(r.date||'').slice(0,10)===today);
   let data=mode==='weekly'?aggregateWeekly(daily):daily;
   data=data.slice(-safeLimit);data=mergeLiveBar(data,mode,db.market[symbol]||{},{historicalIncludesToday});
   return setCache(key,{symbol,mode,source:'fugle-live',updatedAt:new Date().toISOString(),data});
  }catch(e){
    console.error('[candles]',symbol,mode,e.message);
    const stale=getStaleLive(key);
    if(stale)return {...stale,source:'fugle-stale',error:e.message};
    return {symbol,mode,source:'fugle-error',updatedAt:new Date().toISOString(),error:e.message,data:[]};
  }
 }
 if(process.env.TRADING_TEST_SEED==='1')return setCache(key,{symbol,mode,source:'test-fixture',updatedAt:new Date().toISOString(),data:mockCandles(symbol,mode,db.market[symbol]||{}).slice(-safeLimit)});
 return {symbol,mode,source:'market-data-unavailable',updatedAt:new Date().toISOString(),error:'FUGLE_API_KEY is not configured',data:[]};
}
