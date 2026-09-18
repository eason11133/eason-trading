const BASE=process.env.FUGLE_BASE_URL||'https://api.fugle.tw/marketdata/v1.0/stock';
export function createFugleRest(apiKey=process.env.FUGLE_API_KEY){
 if(!apiKey) return null;
 async function get(path){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),Number(process.env.FUGLE_TIMEOUT_MS||6500));
  try{
   const r=await fetch(`${BASE}${path}`,{headers:{'X-API-KEY':apiKey},signal:controller.signal});
   if(!r.ok)throw new Error(`Fugle ${r.status}: ${await r.text()}`);
   return r.json();
  } finally { clearTimeout(timeout); }
 }
 return {
  quote: symbol=>get(`/intraday/quote/${encodeURIComponent(symbol)}`),
  candles: (symbol,timeframe='5')=>get(`/intraday/candles/${encodeURIComponent(symbol)}?timeframe=${encodeURIComponent(timeframe)}&sort=asc`),
  historicalCandles: (symbol,from,to,timeframe='D')=>get(`/historical/candles/${encodeURIComponent(symbol)}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&timeframe=${encodeURIComponent(timeframe)}&sort=desc&adjusted=true`)
 };
}
export function normalizeQuote(q){
 const price=q.lastPrice ?? q.closePrice; const previous=q.previousClose ?? q.referencePrice;
 const avg=q.avgPrice ?? q.averagePrice ?? price; const volume=q.total?.tradeVolume ?? q.tradeVolume ?? 0;
 return {symbol:q.symbol,name:q.name,price,changePct:q.changePercent ?? (previous?((price/previous)-1)*100:0),open:q.openPrice,high:q.highPrice,low:q.lowPrice,vwap:avg,volume,source:'fugle-rest'};
}
