import type { Candle, ChartMode } from './types/trading';

type Entry = { source:string; data:Candle[]; savedAt:number; updatedAt?:string };
const cache = new Map<string,Entry>();
const key=(symbol:string,mode:ChartMode)=>`${symbol}:${mode}`;
const maxAge:Record<ChartMode,number>={timeline:5_000,'1m':5_000,'5m':8_000,daily:10*60_000,weekly:30*60_000};

export function getCachedCandles(symbol:string,mode:ChartMode,allowStale=true){
  const row=cache.get(key(symbol,mode));
  if(!row)return null;
  if(!allowStale && Date.now()-row.savedAt>maxAge[mode])return null;
  return row;
}
export function putCachedCandles(symbol:string,mode:ChartMode,value:{source:string;data:Candle[];updatedAt?:string}){
  const row={...value,savedAt:Date.now()}; cache.set(key(symbol,mode),row); return row;
}
export function candleCacheFresh(symbol:string,mode:ChartMode){return !!getCachedCandles(symbol,mode,false)};
