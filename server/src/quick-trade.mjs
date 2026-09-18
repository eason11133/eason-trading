export function parseQuickTrade(text,{resolveName}={}){
 const raw=String(text||'').trim().replace(/，/g,' ').replace(/\s+/g,' ');
 if(!raw)throw new Error('請輸入成交，例如：2303 140 +100');
 const parts=raw.split(' ');if(parts.length<3)throw new Error('格式：股票 价格 +股數 / -股數');
 const stock=parts[0];const price=Number(parts[1]);const signed=Number(parts[2]);
 if(!Number.isFinite(price)||price<=0)throw new Error('成交價不正確');
 if(!Number.isFinite(signed)||signed===0)throw new Error('股數不正確，買進用 +、賣出用 -');
 let symbol=stock,name;
 if(!/^\d{4,6}$/.test(stock)){
  const resolved=resolveName?.(stock);if(!resolved?.symbol)throw new Error(`找不到股票：${stock}`);symbol=String(resolved.symbol);name=resolved.name||stock;
 }
 return {symbol,name,side:signed>0?'BUY':'SELL',quantity:Math.abs(Math.trunc(signed)),price};
}
