import test from 'node:test';
import assert from 'node:assert/strict';
import { db, reset, initializeLedger, updateMarket, recomputePortfolio, updateCash } from './store.mjs';

test('total assets equals known cash plus live Fugle market value exactly once',()=>{
 reset();initializeLedger({cash:50000,realizedPnl:5000,positions:[{symbol:'1714',name:'和桐',quantity:1000,averageCost:16.65}]},'user');
 updateMarket({symbol:'1714',name:'和桐',price:16.5,high:16.65,low:16.3,vwap:16.48,source:'fugle-rest'});
 const p=recomputePortfolio();
 assert.equal(p.cash,50000);assert.equal(p.marketValue,16500);assert.equal(p.costBasis,16650);assert.equal(p.unrealizedPnl,-150);assert.equal(p.totalAssets,66500);assert.equal(p.totalAssetsTrusted,true);assert.equal(p.realizedPnl,5000);
});

test('total assets is not guessed when a holding has no trusted quote',()=>{
 reset();initializeLedger({cash:50000,positions:[{symbol:'1714',name:'和桐',quantity:1000,averageCost:16.65}]},'user');
 delete db.market['1714'];const p=recomputePortfolio();
 assert.equal(p.marketValue,null);assert.equal(p.totalAssets,null);assert.equal(p.marketPending,1);assert.equal(p.totalAssetsTrusted,false);
});

test('cash must be explicitly known before total assets is shown',()=>{
 reset();db.positions=[{symbol:'1714',name:'和桐',quantity:1000,averageCost:16.65,openedAt:new Date().toISOString()}];db.metadata.cashKnown=false;db.portfolio.cash=0;updateMarket({symbol:'1714',name:'和桐',price:16.5,source:'fugle-rest'});let p=recomputePortfolio();assert.equal(p.marketValue,16500);assert.equal(p.totalAssets,null);updateCash(20000,'app');p=recomputePortfolio();assert.equal(p.totalAssets,36500);assert.equal(p.totalAssetsTrusted,true);
});
