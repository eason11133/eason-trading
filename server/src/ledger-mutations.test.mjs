import test from 'node:test';
import assert from 'node:assert/strict';
import {db,reset,setPosition,updateCash} from './store.mjs';
import {applyLedgerMutation,validateLedgerMutation} from './ledger-mutations.mjs';

const row=(id,type,payload)=>({mutationId:id,schemaVersion:1,mutationType:type,payload});
test('offline holding mutation applies exactly once',()=>{reset();const m=row('lm_create_1','POSITION_ADD',{symbol:'1714',quantity:1000,averageCost:16.65,expectedPosition:null});const a=applyLedgerMutation(m),b=applyLedgerMutation(m);assert.equal(a.alreadyApplied,false);assert.equal(b.alreadyApplied,true);assert.equal(db.positions.filter(x=>x.symbol==='1714').length,1);assert.equal(db.positions.find(x=>x.symbol==='1714').quantity,1000)});
test('durable applied mutation index survives module-level state persistence',()=>{assert.ok(db.appliedLedgerMutations.lm_create_1);assert.equal(applyLedgerMutation(row('lm_create_1','POSITION_ADD',{symbol:'1714',quantity:1000,averageCost:16.65})).alreadyApplied,true)});
test('stale position correction is rejected explicitly',()=>{reset();setPosition({symbol:'1714',quantity:100,averageCost:10});assert.throws(()=>applyLedgerMutation(row('lm_conflict_1','POSITION_ADJUST',{expectedSymbol:'1714',symbol:'1714',quantity:200,averageCost:11,expectedPosition:{quantity:50,averageCost:10}})),/conflict/);assert.equal(db.positions[0].quantity,100)});
test('malformed queued mutation is rejected without changing ledger',()=>{reset();assert.throws(()=>validateLedgerMutation(row('lm_bad_1','TRADE_RECORD',{symbol:'1714',side:'SELL',quantity:-1,price:10})),/invalid trade/);assert.equal(db.trades.length,0)});
test('ordered mutations produce deterministic ledger state',()=>{reset();applyLedgerMutation(row('lm_order_1','POSITION_ADD',{symbol:'1714',quantity:1000,averageCost:16.65,expectedPosition:null}));applyLedgerMutation(row('lm_order_2','POSITION_ADJUST',{expectedSymbol:'1714',symbol:'1714',quantity:800,averageCost:16.7,expectedPosition:{quantity:1000,averageCost:16.65}}));const p=db.positions.find(x=>x.symbol==='1714');assert.equal(p.quantity,800);assert.equal(p.averageCost,16.7)});
test('cash precondition rejects a stale correction',()=>{reset();updateCash(1000);assert.throws(()=>applyLedgerMutation(row('lm_cash_1','CASH_SET',{cash:2000,expectedCash:900})),/conflict: cash changed/);assert.equal(db.portfolio.cash,1000)});
