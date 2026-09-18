import test from 'node:test';
import assert from 'node:assert/strict';
import {createPairingManager} from './pairing.mjs';

const KEY='a'.repeat(64);

test('pairing code is one-time and returns the configured API key',()=>{
 let t=1_000;const m=createPairingManager({getApiKey:()=>KEY,now:()=>t,randomInt:()=>123456});
 const start=m.start();assert.equal(start.code,'123456');
 assert.equal(m.claim('123456','phone').apiKey,KEY);
 assert.throws(()=>m.claim('123456','phone'),/PAIRING_NOT_ACTIVE/);
});

test('pairing code expires',()=>{
 let t=1_000;const m=createPairingManager({getApiKey:()=>KEY,now:()=>t,randomInt:()=>42,ttlMs:100});
 assert.equal(m.start().code,'000042');t+=101;
 assert.throws(()=>m.claim('000042','phone'),/PAIRING_NOT_ACTIVE/);
});

test('pairing throttles repeated wrong guesses',()=>{
 const m=createPairingManager({getApiKey:()=>KEY,randomInt:()=>654321,maxAttemptsPerClient:2,maxAttemptsTotal:10});m.start();
 assert.throws(()=>m.claim('000000','same'),/PAIRING_CODE_INVALID/);
 assert.throws(()=>m.claim('000001','same'),/PAIRING_CODE_INVALID/);
 assert.throws(()=>m.claim('654321','same'),/PAIRING_RATE_LIMITED/);
});
