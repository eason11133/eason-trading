export function volumeDescription(rvol?:number|null){
  const n=Number(rvol);
  if(!Number.isFinite(n)||n<=0)return '';
  if(n>=2)return '成交量明顯放大';
  if(n>=1.35)return '成交量比平常大';
  if(n<=0.7)return '成交量比平常小';
  return '成交量和平常差不多';
}

function fmt(n:number){
  if(!Number.isFinite(n))return '';
  return n.toFixed(n>=100?1:2).replace(/\.00$/,'').replace(/\.0$/,'').replace(/(\.\d)0$/,'$1');
}

export function humanizeTradingText(input?:string|null){
  let text=String(input||'').trim();
  if(!text)return '';

  // Turn raw predicate text into the sentence a user actually needs.
  text=text.replace(/price\s*(>=|<=|>|<)\s*([0-9.]+)(?:\s*\(now\s*([0-9.]+)\))?/ig,(_m,op,rawThreshold,rawNow)=>{
    const threshold=Number(rawThreshold),now=Number(rawNow);
    if((!Number.isFinite(threshold)||threshold<=0)&&Number.isFinite(now))return `目前價格 ${fmt(now)} 元，這筆提醒需要重新確認`;
    const point=fmt(threshold);
    const current=Number.isFinite(now)?`（目前 ${fmt(now)} 元）`:'';
    if(op==='>='||op==='>')return `價格來到我設定的觀察價 ${point} 元以上${current}`;
    return `價格來到我設定的重新確認價 ${point} 元以下${current}`;
  });

  text=text
    .replace(/失效條件成立/g,'原本的想法可能不再適用')
    .replace(/invalid(?:ation)?/ig,'原本想法可能失效')
    .replace(/\bRVOL\s*([0-9.]+)×?/ig,(_m,n)=>volumeDescription(Number(n))||'成交量狀況')
    .replace(/\bVWAP\b/ig,'盤中平均價')
    .replace(/\bTrigger\b/ig,'提醒條件')
    .replace(/\bSetup\b/ig,'觀察設定')
    .replace(/待複判/g,'待確認')
    .replace(/GPT\s*複判/g,'重新確認')
    .replace(/複判/g,'重新確認');

  if(!/觀察價/.test(text)){
    text=text.replace(/突破\s*([0-9.]+)/g,'突破我設定的觀察價 $1 元');
  }
  if(!/重新確認價/.test(text)){
    text=text.replace(/跌破\s*([0-9.]+)/g,'跌到我設定的重新確認價 $1 元');
  }
  text=text.replace(/失效\s*([0-9.]+)/g,'跌到 $1 元要重新看');
  return text.replace(/\s{2,}/g,' ').trim();
}
