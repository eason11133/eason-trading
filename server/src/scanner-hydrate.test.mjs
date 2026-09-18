import test from 'node:test';
import assert from 'node:assert/strict';

process.env.FUGLE_API_KEY='test-key';
global.fetch=async url=>{
  const u=String(url);
  if(u.includes('/intraday/quote/1714')){
    return new Response(JSON.stringify({
      symbol:'1714',name:'和桐',lastPrice:16.5,previousClose:16.35,openPrice:16.35,
      highPrice:16.65,lowPrice:16.3,avgPrice:16.48,changePercent:0.92,total:{tradeVolume:5284}
    }),{status:200,headers:{'content-type':'application/json'}});
  }
  return new Response(JSON.stringify({message:'not mocked'}),{status:404});
};

const {hydrateQuote}=await import('./scanner.mjs?hydrate-test');
const {reset}=await import('./store.mjs');

test('on-demand Fugle hydration fills a newly edited symbol even outside scanner rotation',async()=>{
  reset();
  const x=await hydrateQuote('1714',{date:new Date('2026-09-07T23:00:00+08:00')});
  assert.equal(x.ok,true);
  assert.equal(x.market.name,'和桐');
  assert.equal(x.market.price,16.5);
  assert.equal(x.market.source,'fugle-rest');
});
