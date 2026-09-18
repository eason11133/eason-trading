import test from 'node:test';
import assert from 'node:assert/strict';
import { getCandles } from './candles.mjs';

test('chart API keeps timeline and candle modes separate', async()=>{
  for (const mode of ['timeline','1m','5m','daily','weekly']) {
    const x=await getCandles('2303',mode,20);
    assert.equal(x.mode,mode);
    assert.ok(Array.isArray(x.data));
    assert.ok(x.data.length>=10);
    const last=x.data.at(-1);
    for (const k of ['open','high','low','close','volume']) assert.equal(typeof last[k],'number');
  }
});

test('timeline carries an average/VWAP line', async()=>{
  const x=await getCandles('2303','timeline',30);
  assert.ok(x.data.every(r=>Number.isFinite(r.average)));
});
