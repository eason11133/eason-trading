import test from 'node:test';
import assert from 'node:assert/strict';
import { marketFreshness } from './store.mjs';

test('provider quote becomes stale during open session but remains usable after close',()=>{
 const market={symbol:'1714',price:16.5,source:'fugle-rest',updatedAt:'2026-09-08T02:00:00.000Z'}; // 10:00 Taipei
 const fresh=marketFreshness(market,new Date('2026-09-08T02:01:30.000Z'));
 assert.equal(fresh.trusted,true);assert.equal(fresh.fresh,true);assert.equal(fresh.ageSeconds,90);
 const stale=marketFreshness(market,new Date('2026-09-08T02:03:00.000Z'));
 assert.equal(stale.trusted,true);assert.equal(stale.fresh,false);
 const closed=marketFreshness(market,new Date('2026-09-08T07:00:00.000Z'));
 assert.equal(closed.trusted,true);assert.equal(closed.fresh,true);
 const fake=marketFreshness({price:16.5,source:'mock',updatedAt:'2026-09-08T02:00:00.000Z'},new Date('2026-09-08T02:01:00.000Z'));
 assert.equal(fake.trusted,false);assert.equal(fake.fresh,false);
});
