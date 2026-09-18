import test from 'node:test';import assert from 'node:assert/strict';import {parseQuickTrade} from './quick-trade.mjs';
test('quick trade parses symbol price and signed quantity',()=>{assert.deepEqual(parseQuickTrade('2303 140 +100'),{symbol:'2303',name:undefined,side:'BUY',quantity:100,price:140});assert.equal(parseQuickTrade('2303 133 -100').side,'SELL');});
test('quick trade can resolve a known stock name deterministically',()=>{const x=parseQuickTrade('旺宏 133 -100',{resolveName:n=>n==='旺宏'?{symbol:'2337',name:'旺宏'}:null});assert.equal(x.symbol,'2337');assert.equal(x.quantity,100);});
