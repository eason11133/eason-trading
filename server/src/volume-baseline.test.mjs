import test from 'node:test';
import assert from 'node:assert/strict';
import { relativeVolume, sessionFraction, isTradingWindow, historicalBaselineVolumeScale } from './volume-baseline.mjs';

test('RVOL compares cumulative volume against time-adjusted expected daily volume',()=>{
 const noon=new Date('2026-09-07T12:00:00+08:00');
 const fraction=sessionFraction(noon);
 assert.ok(fraction>0.65&&fraction<0.68);
 assert.equal(relativeVolume(1_000_000,1_000_000,noon),1.5);
});

test('Taipei market window excludes midnight and weekends',()=>{
 assert.equal(isTradingWindow(new Date('2026-09-07T10:00:00+08:00')),true);
 assert.equal(isTradingWindow(new Date('2026-09-07T00:10:00+08:00')),false);
 assert.equal(isTradingWindow(new Date('2026-09-06T10:00:00+08:00')),false);
});

test('RVOL baseline uses the same lots unit as Fugle listed/OTC intraday quote volume',()=>{
 const scale=historicalBaselineVolumeScale({market:'TSE',type:'EQUITY'});
 const historicalDailyShares=28_389_000;
 const avgDailyLots=historicalDailyShares*scale;
 assert.equal(avgDailyLots,28_389);
 assert.equal(relativeVolume(28_389,avgDailyLots,new Date('2026-09-07T13:30:00+08:00')),1);
});
