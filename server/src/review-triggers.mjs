import { addAlerts, db, listReviewTriggers, recordTriggerEvent, recordTriggerSnapshot, updateReviewTrigger, updateSetup } from './store.mjs';
import { getCandles } from './candles.mjs';

import { advanceSmartTrigger, evaluateSmartTrigger } from '../../shared/smart-trigger.mjs';

export function evaluateReviewTrigger(trigger,snapshot,context={}){return evaluateSmartTrigger(trigger,snapshot,context);}

function compactSeries(result,limit){
 const data=(result?.data||[]).slice(-limit).map(r=>({
  time:r.date,
  open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume:Number(r.volume||0)
 }));
 return {source:result?.source||'unknown',updatedAt:result?.updatedAt||null,error:result?.error||null,unit:{price:'TWD',volume:'lots'},data};
}
function qualityOf(...series){
 const sources=series.map(x=>String(x?.source||''));
 if(sources.every(x=>x.startsWith('fugle-live')))return 'LIVE';
 if(sources.some(x=>x.startsWith('fugle-error')))return 'ERROR';
 if(sources.some(x=>x.startsWith('fugle-stale')))return 'STALE';
 return 'UNAVAILABLE';
}

export async function processReviewTriggers(snapshot){
 const active=listReviewTriggers({status:'ARMED',symbol:snapshot.symbol}).filter(x=>!x.expiresAt||Date.parse(x.expiresAt)>Date.now());
 const alerts=[];
 for(const trigger of active){
  const playbook=db.playbooks[snapshot.symbol]||null;const setup=db.setups?.[snapshot.symbol]||null;const result=advanceSmartTrigger(trigger,snapshot,{playbook,setup});
  if(JSON.stringify(trigger.runtime||{})!==JSON.stringify(result.runtime||{}))updateReviewTrigger(trigger.id,{runtime:result.runtime},'system');
  if(!result.matched)continue;
  // Claim before async capture so REST polling and WebSocket cannot fire the same trigger twice.
  const matchedAt=new Date().toISOString();
  updateReviewTrigger(trigger.id,{status:'FIRING',matchedAt},'system');
  const [oneMinute,fiveMinute,daily]=await Promise.all([
   getCandles(snapshot.symbol,'1m',60).catch(e=>({source:'fugle-error',error:e.message,data:[]})),
   getCandles(snapshot.symbol,'5m',36).catch(e=>({source:'fugle-error',error:e.message,data:[]})),
   getCandles(snapshot.symbol,'daily',60).catch(e=>({source:'fugle-error',error:e.message,data:[]}))
  ]);
  const series={oneMinute:compactSeries(oneMinute,60),fiveMinute:compactSeries(fiveMinute,36),daily:compactSeries(daily,60)};
  const position=db.positions.find(x=>x.symbol===snapshot.symbol)||null;
  const watch=db.watchlist.find(x=>x.symbol===snapshot.symbol)||null;
  // playbook/setup were already loaded for the smart decision above.
  const hypotheses=(db.hypotheses||[]).filter(x=>x.symbol===snapshot.symbol).slice(-10);
  const snapshotRow=recordTriggerSnapshot({
   schemaVersion:'2.0-data-only',
   transferMode:'STRUCTURED_DATA_ONLY',
   generatedImage:false,
   symbol:snapshot.symbol,
   triggerId:trigger.id,
   trigger:{id:trigger.id,label:trigger.label,purpose:trigger.purpose||'REVIEW',conditions:trigger.conditions,policy:trigger.policy||null,reasons:result.reasons,evidence:result.evidence,decisionSummary:result.summary,matchedAt},
   marketAtTrigger:{...snapshot},
   units:{price:'TWD',volume:'lots',rvol:'multiple'},
   dataQuality:qualityOf(series.oneMinute,series.fiveMinute,series.daily),
   seriesAtTrigger:series,
   position,watch,playbook,setup,hypotheses,
   recentAlerts:db.alerts.filter(x=>x.symbol===snapshot.symbol).slice(-10)
  });
  const event=recordTriggerEvent({triggerId:trigger.id,symbol:snapshot.symbol,label:trigger.label,reasons:result.reasons,evidence:result.evidence,decisionSummary:result.summary,snapshotId:snapshotRow.id,market:{...snapshot},reviewStatus:'PENDING'});
  if(!position){try{updateSetup(snapshot.symbol,{stage:'TRIGGERED_NO_ENTRY',statusReason:`GPT Review Trigger 已觸發：${trigger.label}`,entryOpportunity:'WAITING'},'system');}catch{}}
  const oneShot=result.policy?.oneShot!==false;
  updateReviewTrigger(trigger.id,{status:oneShot?'FIRED':'ARMED',firedAt:event.triggeredAt,eventId:event.id,runtime:result.runtime},'system');
  alerts.push({symbol:snapshot.symbol,name:snapshot.name,level:'GPT_REVIEW',type:'GPT_REVIEW',title:`${snapshot.name} 值得重新判斷`,body:`${result.summary}・現價 ${snapshot.price}${snapshot.rvol!=null?`・RVOL ${Number(snapshot.rvol).toFixed(2)}×`:''}`,dedupeKey:`${snapshot.symbol}:gptreview:${trigger.id}:${event.id}`,triggerEventId:event.id,snapshotId:snapshotRow.id});
 }
 return alerts;
}
