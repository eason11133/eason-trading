import test from 'node:test'; import assert from 'node:assert/strict'; import { evaluate } from './alerts.mjs';
test('breakout requires price and RVOL',()=>{assert.equal(evaluate({symbol:'2303',name:'聯電',price:131.2,rvol:1.2},{version:1,breakout:131},{}).length,0);assert.equal(evaluate({symbol:'2303',name:'聯電',price:131.2,rvol:1.7},{version:1,breakout:131},{}).at(0).type,'BREAKOUT');});
test('does not repeat already armed breakout',()=>{assert.equal(evaluate({symbol:'2303',name:'聯電',price:132,rvol:2},{version:1,breakout:131},{breakout:true}).length,0);});
