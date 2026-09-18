import { db } from './store.mjs';
const EXPO='https://exp.host/--/api/v2/push/send';
export async function notifyAlerts(alerts){
 if(!alerts?.length||!db.devices?.length)return {sent:0};
 const messages=[];
 for(const d of db.devices){if(!d.enabled||!d.token?.startsWith('ExponentPushToken[')&&!d.token?.startsWith('ExpoPushToken['))continue;for(const a of alerts)messages.push({to:d.token,title:a.title,body:a.body,sound:a.level==='HOT'||a.level==='RISK'?'default':null,data:{alertId:a.id,symbol:a.symbol,type:a.type,level:a.level,triggerEventId:a.triggerEventId||null,snapshotId:a.snapshotId||null,closePackageId:a.closePackageId||null},channelId:a.level==='RISK'?'risk':'radar'});}
 if(!messages.length)return {sent:0};
 const chunks=[];for(let i=0;i<messages.length;i+=100)chunks.push(messages.slice(i,i+100));
 let sent=0;for(const chunk of chunks){try{const r=await fetch(EXPO,{method:'POST',headers:{'content-type':'application/json','accept':'application/json','accept-encoding':'gzip, deflate'},body:JSON.stringify(chunk)});if(!r.ok)console.error('[push]',r.status,await r.text());else sent+=chunk.length;}catch(e){console.error('[push]',e.message)}}return {sent};
}
