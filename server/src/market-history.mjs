function hash(s){let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function rng(seed){let x=seed||1;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return((x>>>0)%100000)/100000;};}
export function mockCandles(symbol,mode='timeline',market={}){
 const intraday=['timeline','1m','5m'].includes(mode);
 const count=mode==='timeline'?270:mode==='1m'?120:mode==='5m'?54:mode==='weekly'?40:60;
 const end=market.price||100; const r=rng(hash(symbol+mode));
 const drift=intraday?0.0008:0.004;
 let close=end*(intraday?0.985:0.72); const rows=[]; const now=new Date(); let cumPV=0,cumV=0;
 for(let i=0;i<count;i++){
  const open=close; const move=(r()-.46)*drift*open*3; close=Math.max(.1,open+move);
  const high=Math.max(open,close)*(1+r()*drift*1.8); const low=Math.min(open,close)*(1-r()*drift*1.8);
  const volume=Math.round(500+r()*8000*(1+i/count));
  let date;
  if(intraday){const d=new Date(now);d.setHours(9,0,0,0);d.setMinutes(i*(mode==='5m'?5:1));date=d.toISOString();}
  else {const d=new Date(now);d.setDate(now.getDate()-(count-i)*(mode==='weekly'?7:1));date=d.toISOString();}
  cumPV+=close*volume;cumV+=volume;
  rows.push({date,open:Number(open.toFixed(2)),high:Number(high.toFixed(2)),low:Number(low.toFixed(2)),close:Number(close.toFixed(2)),volume,average:Number((cumPV/Math.max(1,cumV)).toFixed(2))});
 }
 const scale=end/rows.at(-1).close;
 let cpv=0,cv=0;
 return rows.map(c=>{const row={...c,open:Number((c.open*scale).toFixed(2)),high:Number((c.high*scale).toFixed(2)),low:Number((c.low*scale).toFixed(2)),close:Number((c.close*scale).toFixed(2))};cpv+=row.close*row.volume;cv+=row.volume;return {...row,average:Number((cpv/Math.max(1,cv)).toFixed(2))};});
}
