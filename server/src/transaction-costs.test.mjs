import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateTradeCosts} from './transaction-costs.mjs';

const cfg={feeRate:0.001425,feeDiscount:1,regularMinFee:20,oddLotMinFee:1,stockSellTaxRate:0.003,dayTradeSellTaxRate:0.0015,oddLotThreshold:1000,configured:true};

test('regular buy applies broker minimum fee and no tax',()=>{
 const x=estimateTradeCosts({side:'BUY',quantity:1000,price:10},cfg);
 assert.equal(x.gross,10000);assert.equal(x.brokerFee,20);assert.equal(x.transactionTax,0);assert.equal(x.cashDelta,-10020);
});

test('odd lot has its own minimum fee instead of regular minimum',()=>{
 const x=estimateTradeCosts({side:'BUY',quantity:100,price:10},cfg);
 assert.equal(x.oddLot,true);assert.equal(x.brokerFee,1);assert.equal(x.cashDelta,-1001);
});

test('sell applies broker fee and stock transaction tax',()=>{
 const x=estimateTradeCosts({side:'SELL',quantity:1000,price:100},cfg);
 assert.equal(x.brokerFee,143);assert.equal(x.transactionTax,300);assert.equal(x.cashDelta,99557);
});

test('day trade sell uses reduced configured tax rate',()=>{
 const x=estimateTradeCosts({side:'SELL',quantity:1000,price:100,dayTrade:true},cfg);
 assert.equal(x.transactionTax,150);
});
