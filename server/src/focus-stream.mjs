import { addAlerts, db, runtimeState, updateMarket } from './store.mjs';
import { evaluate } from './alerts.mjs';
import { notifyAlerts } from './notifier.mjs';
import { getVolumeBaseline, relativeVolume } from './volume-baseline.mjs';
import { processReviewTriggers } from './review-triggers.mjs';
const URL='wss://api.fugle.tw/marketdata/v1.0/stock/streaming';

function normalizeAggregate(a){
 const price=a.lastPrice ?? a.closePrice; const previous=a.previousClose ?? a.referencePrice; const volume=a.total?.tradeVolume ?? 0;
 const baseline=getVolumeBaseline(a.symbol); const rvol=relativeVolume(volume,baseline?.avgDailyVolume) ?? db.market[a.symbol]?.rvol ?? 1;
 return {symbol:a.symbol,name:a.name,price,changePct:a.changePercent ?? (previous&&price?((price/previous)-1)*100:0),high:a.highPrice,low:a.lowPrice,vwap:a.avgPrice ?? price,rvol,volume,source:'fugle-ws'};
}

export function createFocusStream({apiKey=process.env.FUGLE_API_KEY,maxSlots=5,refreshMs=5000}={}){
 if(!apiKey) return {start(){console.log('[focus] disabled: FUGLE_API_KEY not set')},stop(){}};
 let socket=null; let timer=null; let activeKey=''; let stopped=false;
 const focusSymbols=()=>{const ranked=db.watchlist.filter(x=>!['DROP','CLOSED'].includes(x.state)).sort((a,b)=>b.priority-a.priority).map(x=>x.symbol);const all=[runtimeState.focusSymbol,...ranked].filter(Boolean);return [...new Set(all)].slice(0,maxSlots);};
 function connect(symbols){
  if(socket) try{socket.close()}catch{}
  activeKey=symbols.join(','); if(!symbols.length)return;
  socket=new WebSocket(URL);
  socket.onopen=()=>socket.send(JSON.stringify({event:'auth',data:{apikey:apiKey}}));
  socket.onmessage=(message)=>{
   try{
    const msg=JSON.parse(String(message.data));
    if(msg.event==='authenticated') for(const symbol of symbols) socket.send(JSON.stringify({event:'subscribe',data:{channel:'aggregates',symbol}}));
    if(msg.event==='data'&&msg.channel==='aggregates'&&!msg.data?.isTrial){
      const q=normalizeAggregate(msg.data); const previous=db.market[q.symbol]||{}; updateMarket(q); const pb=db.playbooks[q.symbol];
      const events=[];if(pb)events.push(...evaluate(q,pb,{breakout:pb.breakout!=null&&previous.price>=pb.breakout&&previous.rvol>=1.5,invalid:pb.invalid!=null&&previous.price<=pb.invalid,goodZone:pb.goodZone&&previous.price>=pb.goodZone[0]&&previous.price<=pb.goodZone[1]}));
      processReviewTriggers(q).then(review=>{const added=addAlerts([...events,...review]);if(added.length)notifyAlerts(added).catch(console.error);for(const e of added)console.log('[alert]',e.level,e.title,e.body);}).catch(e=>console.error('[review trigger]',e.message));
    }
    if(msg.event==='error') console.error('[focus] fugle error',msg.data?.message||msg);
   }catch(e){console.error('[focus] message',e.message)}
  };
  socket.onerror=(e)=>console.error('[focus] websocket error',e?.message||'error');
  socket.onclose=()=>{if(!stopped)setTimeout(()=>{const now=focusSymbols();if(now.join(',')===activeKey)connect(now)},3000)};
  console.log('[focus] connecting',symbols.join(','));
 }
 function reconcile(){const symbols=focusSymbols();const key=symbols.join(',');if(key!==activeKey)connect(symbols);}
 return {start(){stopped=false;reconcile();timer=setInterval(reconcile,refreshMs)},stop(){stopped=true;if(timer)clearInterval(timer);if(socket)socket.close();}};
}
