import test from 'node:test';
import assert from 'node:assert/strict';
import { db, reset, recordTrade, previewTrade, updatePlaybook, radar, addWatch, dropWatch, recordReview, listReviews, initializeLedger, createReviewTrigger, listReviewTriggers, updateReviewTrigger, updateSetup, adjustPosition, setPosition, removePosition, updateCash } from './store.mjs';

test('trade ledger changes holdings only when an executed trade is recorded',()=>{
 reset();const before=db.positions.find(x=>x.symbol==='2303')?.quantity;const cash=db.portfolio.cash;
 recordTrade({symbol:'2303',name:'聯電',side:'BUY',quantity:10,price:130});
 assert.equal(db.positions.find(x=>x.symbol==='2303').quantity,before+10);
 assert.equal(db.portfolio.cash,cash-1302);
 assert.equal(db.trades.at(-1).brokerFee,2);assert.equal(db.trades.at(-1).transactionTax,0);
});

test('playbook update does not change position quantity',()=>{
 reset();const before=db.positions.find(x=>x.symbol==='2303').quantity;const result=updatePlaybook('2303',{maxEntry:132});
 assert.equal(db.positions.find(x=>x.symbol==='2303').quantity,before);
 assert.equal(result.playbook.maxEntry,132);
});

test('radar sorts high priority first',()=>{reset();assert.equal(radar()[0].symbol,'2303');});

test('partial sell changes state to PARTIAL and full sell closes position',()=>{
 reset();recordTrade({symbol:'2337',name:'旺宏',side:'SELL',quantity:50,price:133});
 assert.equal(db.positions.find(x=>x.symbol==='2337').quantity,50);
 assert.equal(db.watchlist.find(x=>x.symbol==='2337').state,'PARTIAL');
 recordTrade({symbol:'2337',name:'旺宏',side:'SELL',quantity:50,price:134});
 assert.equal(db.positions.find(x=>x.symbol==='2337'),undefined);
 assert.equal(db.watchlist.find(x=>x.symbol==='2337').state,'CLOSED');
});

test('watchlist can add and drop only when no open position exists',()=>{
 reset();addWatch({symbol:'9999',name:'測試股'});assert.equal(db.watchlist.find(x=>x.symbol==='9999').state,'WATCH');
 dropWatch('9999');assert.equal(db.watchlist.find(x=>x.symbol==='9999').state,'DROP');
 assert.throws(()=>dropWatch('2303'),/open position/);
});


test('review records real outcome without changing the trading ledger',()=>{
 reset();const before=db.positions.find(x=>x.symbol==='2303').quantity;
 recordReview({symbol:'2303',name:'聯電',thesis:'突破後回踩守住',result:'成功',pnlPct:8.2,mfe:10.4,mae:-1.7,followedPlan:true,lesson:'等待量能確認有效'},'chatgpt');
 assert.equal(listReviews()[0].symbol,'2303');
 assert.equal(listReviews()[0].pnlPct,8.2);
 assert.equal(db.positions.find(x=>x.symbol==='2303').quantity,before);
});


test('ledger can be explicitly initialized from real user holdings',()=>{
 reset();initializeLedger({cash:50000,positions:[{symbol:'2303',name:'聯電',quantity:20,averageCost:120}],clearTrades:true},'user');
 assert.equal(db.metadata.ledgerMode,'live');assert.equal(db.positions.length,1);assert.equal(db.positions[0].quantity,20);assert.equal(db.portfolio.cash,50000);
});

test('GPT review trigger has an explicit armed lifecycle',()=>{
 reset();const t=createReviewTrigger({symbol:'2303',label:'131+量能',conditions:{all:[{field:'price',op:'>=',value:131}]}},'chatgpt');
 assert.equal(t.status,'ARMED');assert.equal(listReviewTriggers({status:'ARMED',symbol:'2303'})[0].id,t.id);
 updateReviewTrigger(t.id,{status:'CANCELLED'},'user');assert.equal(listReviewTriggers({status:'ARMED',symbol:'2303'}).length,0);
});

test('portfolio never uses demo-seed prices when a live Fugle key is configured',()=>{
 const old=process.env.FUGLE_API_KEY;process.env.FUGLE_API_KEY='dummy';
 try{reset();const x=radar();assert.equal(x.find(r=>r.symbol==='2337').dataTrusted,false);assert.ok(db.portfolio.marketPending>=1);assert.equal(db.portfolio.marketValue,null);assert.equal(db.portfolio.totalAssets,null);}finally{if(old)process.env.FUGLE_API_KEY=old;else delete process.env.FUGLE_API_KEY;}
});

test('playbook cannot fake a sell/drop state for an open position',()=>{
 reset();assert.throws(()=>updatePlaybook('2303',{state:'DROP'}),/open-position ledger state/);assert.equal(db.positions.find(x=>x.symbol==='2303').quantity,100);
});

test('ledger initialization clears stale POSITION labels for stocks not actually held',()=>{
 reset();initializeLedger({cash:10000,positions:[{symbol:'2337',name:'旺宏',quantity:10,averageCost:120}]},'user');
 assert.equal(db.watchlist.find(x=>x.symbol==='3162').state,'WATCH');assert.equal(db.watchlist.find(x=>x.symbol==='2337').state,'POSITION');
});



test('manual position correction edits symbol quantity and cost without creating a trade or changing cash',()=>{
 reset();
 const cash=db.portfolio.cash;const trades=db.trades.length;
 const x=adjustPosition('2337',{symbol:'2337',quantity:120,averageCost:119.5},'app');
 assert.equal(x.position.quantity,120);assert.equal(x.position.averageCost,119.5);
 assert.equal(db.portfolio.cash,cash);assert.equal(db.trades.length,trades);
 assert.equal(db.metadata.ledgerMode,'manual');
});

test('manual position correction can fix a stock symbol while preserving it as a correction, not a trade',()=>{
 reset();
 const cash=db.portfolio.cash;const trades=db.trades.length;
 adjustPosition('2337',{symbol:'9999',quantity:100,averageCost:121},'app');
 assert.equal(db.positions.find(x=>x.symbol==='2337'),undefined);
 assert.equal(db.positions.find(x=>x.symbol==='9999')?.quantity,100);
 assert.equal(db.watchlist.find(x=>x.symbol==='9999')?.state,'POSITION');
 assert.equal(db.portfolio.cash,cash);assert.equal(db.trades.length,trades);
});


test('manual portfolio correction can add/remove holdings and edit cash without fake trades',()=>{
 reset();
 const trades=db.trades.length;
 const added=setPosition({symbol:'1714',name:'和桐',quantity:1000,averageCost:16.65},'app');
 assert.equal(added.position.symbol,'1714');assert.equal(db.positions.find(x=>x.symbol==='1714')?.quantity,1000);
 updateCash(25000,'app');assert.equal(db.portfolio.cash,25000);
 removePosition('1714','app');assert.equal(db.positions.find(x=>x.symbol==='1714'),undefined);
 assert.equal(db.trades.length,trades);
});


test('trade preview shows fees tax and cash impact without mutating ledger',()=>{
 reset();const cash=db.portfolio.cash,trades=db.trades.length,qty=db.positions.find(x=>x.symbol==='2337').quantity;
 const x=previewTrade({symbol:'2337',name:'旺宏',side:'SELL',quantity:10,price:130});
 assert.equal(x.brokerFee,2);assert.equal(x.transactionTax,4);assert.equal(x.afterCash,cash+1294);assert.equal(x.estimatedRealizedPnl,84);
 assert.equal(db.portfolio.cash,cash);assert.equal(db.trades.length,trades);assert.equal(db.positions.find(x=>x.symbol==='2337').quantity,qty);
});

test('sell realized pnl is net of allocated buy fee sell fee and tax',()=>{
 reset();const p=db.positions.find(x=>x.symbol==='2337');p.feeBasis=20;
 const x=recordTrade({symbol:'2337',name:'旺宏',side:'SELL',quantity:50,price:133},'user');
 assert.equal(x.trade.allocatedBuyFee,10);assert.equal(x.trade.brokerFee,9);assert.equal(x.trade.transactionTax,20);assert.equal(x.trade.realizedPnl,561);
 assert.equal(db.positions.find(x=>x.symbol==='2337').feeBasis,10);
});
