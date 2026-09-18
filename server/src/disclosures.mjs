import { addAlerts, db, persist } from './store.mjs';
import { notifyAlerts } from './notifier.mjs';
const ENDPOINTS=[
 ['TWSE','https://openapi.twse.com.tw/v1/opendata/t187ap04_L'],
 ['TPEx','https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O']
];
const every=Number(process.env.DISCLOSURE_INTERVAL_MS||300000);
function field(row,needle){const k=Object.keys(row).find(k=>k.trim().includes(needle));return k?String(row[k]??'').trim():'';}
function parseRoc(date,time=''){
 const d=(date||'').replace(/\D/g,''); const t=(time||'').replace(/\D/g,'').padStart(6,'0');if(d.length!==7)return null;
 const y=Number(d.slice(0,3))+1911,m=Number(d.slice(3,5)),day=Number(d.slice(5,7)),hh=Number(t.slice(0,2)),mm=Number(t.slice(2,4)),ss=Number(t.slice(4,6));
 const iso=`${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}+08:00`;const dt=new Date(iso);return Number.isNaN(dt.valueOf())?null:dt;
}
async function getJson(url){const r=await fetch(url,{headers:{accept:'application/json','user-agent':'EasonTrading/0.2'}});if(!r.ok)throw new Error(`${r.status}`);return r.json();}
export async function pollDisclosures(){
 const active=new Set(db.watchlist.filter(x=>!['DROP','CLOSED'].includes(x.state)).map(x=>x.symbol));
 db.disclosureSeen=db.disclosureSeen||[];const seen=new Set(db.disclosureSeen);const events=[];const now=Date.now();
 for(const [market,url] of ENDPOINTS){try{const rows=await getJson(url);for(const row of rows){const symbol=field(row,'公司代號');if(!active.has(symbol))continue;const subject=field(row,'主旨');const spokenDate=field(row,'發言日期'),spokenTime=field(row,'發言時間');const published=parseRoc(spokenDate,spokenTime);const id=`${market}:${symbol}:${spokenDate}:${spokenTime}:${subject}`;if(seen.has(id))continue;seen.add(id);const recent=!published||now-published.getTime()<=30*60*1000;if(!recent)continue;events.push({symbol,name:field(row,'公司名稱'),level:'NEWS',type:'DISCLOSURE',title:`${field(row,'公司名稱')||symbol} 重大訊息`,body:subject,dedupeKey:`disclosure:${id}`,publishedAt:published?.toISOString()||null,source:market,detail:field(row,'說明')});}}catch(e){console.error('[disclosure]',market,e.message)}}
 db.disclosureSeen=[...seen].slice(-3000);persist();const added=addAlerts(events);if(added.length)await notifyAlerts(added);return {checked:true,events:added.length};
}
export function startDisclosures(){pollDisclosures().catch(console.error);setInterval(()=>pollDisclosures().catch(console.error),every);console.log(`[disclosure] official TWSE/TPEx feeds every ${every}ms`);}
