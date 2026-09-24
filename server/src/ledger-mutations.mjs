import crypto from 'node:crypto';
import {db,persist,runAtomicLedgerMutation,recordTrade,adjustPosition,setPosition,removePosition,updateCash} from './store.mjs';

const TYPES=new Set(['POSITION_ADD','POSITION_ADJUST','POSITION_REMOVE','CASH_SET','TRADE_RECORD']);
const clone=x=>JSON.parse(JSON.stringify(x));

export function ensureLedgerDevice(){
 db.settings=db.settings||{};
 if(!db.settings.ledgerDevice){db.settings.ledgerDevice={deviceId:`dev_${crypto.randomUUID()}`,token:crypto.randomBytes(32).toString('hex'),createdAt:new Date().toISOString()};persist();}
 return clone(db.settings.ledgerDevice);
}

export function validateLedgerMutation(row){
 if(!row||row.schemaVersion!==1||!TYPES.has(row.mutationType)||!row.mutationId)throw new Error('malformed mutation');
 const p=row.payload;if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('malformed payload');
 if(['POSITION_ADD','POSITION_ADJUST'].includes(row.mutationType)&&(!/^\d{4,6}$/.test(String(p.symbol||''))||!(Number(p.quantity)>0)||!(Number(p.averageCost)>=0)))throw new Error('invalid position');
 if(row.mutationType==='POSITION_REMOVE'&&!/^\d{4,6}$/.test(String(p.symbol||'')))throw new Error('invalid position');
 if(row.mutationType==='CASH_SET'&&!(Number(p.cash)>=0))throw new Error('invalid cash');
 if(row.mutationType==='TRADE_RECORD'&&(!['BUY','SELL'].includes(p.side)||!/^\d{4,6}$/.test(String(p.symbol||''))||!(Number(p.quantity)>0)||!(Number(p.price)>0)))throw new Error('invalid trade');
 return p;
}

function samePosition(a,b){return !!a&&Number(a.quantity)===Number(b.quantity)&&Number(a.averageCost)===Number(b.averageCost)}
export function applyLedgerMutation(row){
 db.appliedLedgerMutations=db.appliedLedgerMutations||{};
 if(db.appliedLedgerMutations[row.mutationId])return {alreadyApplied:true,...clone(db.appliedLedgerMutations[row.mutationId])};
 const p=validateLedgerMutation(row),existing=db.positions.find(x=>x.symbol===p.expectedSymbol||x.symbol===p.symbol);
 if(p.expectedPosition!==undefined){
  if(p.expectedPosition===null&&existing)throw new Error('conflict: position now exists');
  if(p.expectedPosition!==null&&!samePosition(existing,p.expectedPosition))throw new Error('conflict: position changed');
 }
 if(p.expectedCash!==undefined&&Number(db.portfolio.cash)!==Number(p.expectedCash))throw new Error('conflict: cash changed');
 return runAtomicLedgerMutation(()=>{
  let result;
  if(row.mutationType==='POSITION_ADD')result=setPosition(p,'cloud-ledger-queue');
  else if(row.mutationType==='POSITION_ADJUST')result=adjustPosition(p.expectedSymbol||p.symbol,p,'cloud-ledger-queue');
  else if(row.mutationType==='POSITION_REMOVE')result=removePosition(p.symbol,'cloud-ledger-queue');
  else if(row.mutationType==='CASH_SET')result=updateCash(p.cash,'cloud-ledger-queue');
  else result=recordTrade(p,'cloud-ledger-queue');
  const appliedAt=new Date().toISOString();
  db.appliedLedgerMutations[row.mutationId]={mutationId:row.mutationId,appliedAt,result:clone(result)};
  return {alreadyApplied:false,mutationId:row.mutationId,appliedAt,result};
 });
}
