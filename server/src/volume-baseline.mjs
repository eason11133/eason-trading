import { db, persist } from './store.mjs';

const TAIPEI='Asia/Taipei';
function parts(date=new Date()){
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:TAIPEI,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return {year:+p.year,month:+p.month,day:+p.day,hour:+p.hour,minute:+p.minute,weekday:p.weekday};
}
export function taipeiYmd(date=new Date()){const p=parts(date);return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;}
export function isTradingWindow(date=new Date()){
  const p=parts(date); if(['Sat','Sun'].includes(p.weekday))return false;
  const mins=p.hour*60+p.minute; return mins>=8*60+55 && mins<=13*60+40;
}
export function sessionFraction(date=new Date()){
  const p=parts(date); const mins=p.hour*60+p.minute; const start=9*60,end=13*60+30;
  if(mins<=start)return 0.05; if(mins>=end)return 1;
  return Math.max(0.05,Math.min(1,(mins-start)/(end-start)));
}
export function relativeVolume(volume,avgDailyVolume,date=new Date()){
  if(!(avgDailyVolume>0)||!(volume>=0))return null;
  const expected=Math.max(1,avgDailyVolume*sessionFraction(date));
  return Number((volume/expected).toFixed(2));
}
export function getVolumeBaseline(symbol){
  return db.volumeBaselines?.[symbol]||null;
}
export function baselineNeedsRefresh(symbol,date=new Date()){
  const row=getVolumeBaseline(symbol); if(!row?.avgDailyVolume||!row.updatedAt)return true;
  const age=Date.now()-Date.parse(row.updatedAt); return age>36*60*60*1000;
}
function candlesFrom(payload){return Array.isArray(payload)?payload:(payload?.data||payload?.candles||[]);}
export function historicalBaselineVolumeScale(payload={}){
  const market=String(payload?.market||'').toUpperCase();
  const type=String(payload?.type||'').toUpperCase();
  if(type==='INDEX')return 1;
  return (market==='TSE'||market==='OTC') ? 1/1000 : 1;
}
export async function refreshVolumeBaseline(symbol,rest,date=new Date()){
  if(!rest)return null;
  const to=taipeiYmd(date); const fromDate=new Date(date.getTime()-16*86400000); const from=taipeiYmd(fromDate);
  const raw=await rest.historicalCandles(symbol,from,to,'D');
  const today=taipeiYmd(date);
  const completed=candlesFrom(raw).filter(c=>String(c.date||c.time||c.timestamp||'').slice(0,10)!==today).filter(c=>(c.volume??c.tradeVolume??0)>0).slice(0,5);
  if(!completed.length)return null;
  const volumeScale=historicalBaselineVolumeScale(raw);
  const avg=completed.reduce((s,c)=>s+((c.volume??c.tradeVolume??0)*volumeScale),0)/completed.length;
  db.volumeBaselines=db.volumeBaselines||{};
  db.volumeBaselines[symbol]={avgDailyVolume:Number(avg.toFixed(2)),sampleDays:completed.length,updatedAt:new Date().toISOString()};
  persist(); return db.volumeBaselines[symbol];
}
