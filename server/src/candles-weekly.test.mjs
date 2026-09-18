import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateWeekly, historicalVolumeScale, mergeLiveBar } from './candles.mjs';
test('weekly candles are aggregated locally from daily rows',()=>{
 const rows=[
  {date:'2026-09-07T00:00:00Z',open:10,high:12,low:9,close:11,volume:100,average:11},
  {date:'2026-09-08T00:00:00Z',open:11,high:13,low:10,close:12,volume:200,average:12},
  {date:'2026-09-14T00:00:00Z',open:12,high:14,low:11,close:13,volume:300,average:13}
 ];
 const x=aggregateWeekly(rows);assert.equal(x.length,2);assert.deepEqual([x[0].open,x[0].high,x[0].low,x[0].close,x[0].volume],[10,13,9,12,300]);
});

test('listed/OTC historical daily volume is normalized from shares to lots',()=>{
 assert.equal(historicalVolumeScale({market:'TSE',type:'EQUITY'}),0.001);
 assert.equal(historicalVolumeScale({market:'OTC',type:'EQUITY'}),0.001);
 assert.equal(historicalVolumeScale({market:'ESB',type:'EQUITY'}),1);
 assert.equal(historicalVolumeScale({market:'TSE',type:'INDEX'}),1);
});

test('live weekly volume adds today to prior days instead of replacing the whole week',()=>{
 const monday={date:'2026-09-07',open:120,high:126,low:119,close:124,volume:10_000,average:123};
 const rows=aggregateWeekly([monday]);
 const merged=mergeLiveBar(rows,'weekly',{price:125,high:127,low:123,volume:28_389,vwap:124.3},{historicalIncludesToday:false,now:new Date('2026-09-08T13:30:00+08:00')});
 assert.equal(merged.at(-1).volume,38_389);
});
