export function evaluate(snapshot, playbook, previous = {}) {
  const events=[];
  const base={symbol:snapshot.symbol,name:snapshot.name};
  if(playbook.breakout && snapshot.price>=playbook.breakout && snapshot.rvol>=1.5 && previous.breakout!==true) events.push({...base,level:'HOT',type:'BREAKOUT',title:`${snapshot.name} 突破 ${playbook.breakout}`,body:`現價 ${snapshot.price}・RVOL ${snapshot.rvol.toFixed(2)}×`,dedupeKey:`${snapshot.symbol}:breakout:${playbook.version}`});
  if(playbook.invalid && snapshot.price<=playbook.invalid && previous.invalid!==true) events.push({...base,level:'RISK',type:'INVALID',title:`${snapshot.name} 失效條件成立`,body:`現價 ${snapshot.price} ≤ ${playbook.invalid}`,dedupeKey:`${snapshot.symbol}:invalid:${playbook.version}`});
  if(playbook.goodZone && snapshot.price>=playbook.goodZone[0] && snapshot.price<=playbook.goodZone[1] && previous.goodZone!==true) events.push({...base,level:'WATCH',type:'GOOD_ZONE',title:`${snapshot.name} 進入好價區`,body:`${playbook.goodZone[0]}–${playbook.goodZone[1]}`,dedupeKey:`${snapshot.symbol}:goodzone:${playbook.version}`});
  return events;
}
