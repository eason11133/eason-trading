import test from 'node:test';
import assert from 'node:assert/strict';
import { marketSession } from './market-session.mjs';
test('market session reports Taipei open and weekend correctly',()=>{
  assert.equal(marketSession(new Date('2026-09-07T02:00:00Z')).session,'OPEN');
  assert.equal(marketSession(new Date('2026-09-06T02:00:00Z')).session,'WEEKEND');
});
