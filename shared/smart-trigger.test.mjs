import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceSmartTrigger,evaluateSmartTrigger} from './smart-trigger.mjs';

test('smart trigger needs its structured qualification logic',()=>{
 const t={conditions:{all:[{field:'price',op:'>=',value:100},{field:'rvol',op:'>=',value:1.2}]}};
 assert.equal(evaluateSmartTrigger(t,{price:101,rvol:1.3}).matched,true);
 assert.equal(evaluateSmartTrigger(t,{price:101,rvol:0.9}).matched,false);
});

test('playbook invalidation has precedence over review-zone qualification',()=>{
 const t={purpose:'REVIEW',conditions:{all:[{field:'price',op:'<=',value:60}]}};
 const x=evaluateSmartTrigger(t,{price:56.8},{playbook:{invalid:57}});
 assert.equal(x.matched,false);assert.equal(x.blockedByInvalidation,true);assert.match(x.summary,/失效價/);
});

test('explicit invalidation suppresses otherwise qualifying trigger',()=>{
 const t={conditions:{all:[{field:'price',op:'<=',value:60}],invalidation:{any:[{field:'rvol',op:'>=',value:2.5}]}}};
 assert.equal(evaluateSmartTrigger(t,{price:59,rvol:2.8}).matched,false);
 assert.equal(evaluateSmartTrigger(t,{price:59,rvol:1.1}).matched,true);
});

test('stale playbook version cannot trigger',()=>{
 const t={playbookVersion:2,conditions:{all:[{field:'price',op:'>=',value:50}]}};
 const x=evaluateSmartTrigger(t,{price:51},{playbook:{version:3}});assert.equal(x.matched,false);assert.equal(x.staleVersion,true);
});

test('minConsecutive requires persistence and only fires on the stable transition',()=>{
 const t={policy:{minConsecutive:2,oneShot:false},conditions:{all:[{field:'price',op:'>=',value:50}]},runtime:{}};
 const a=advanceSmartTrigger(t,{price:51},{},new Date('2026-09-14T01:00:00Z'));assert.equal(a.matched,false);assert.equal(a.runtime.streak,1);
 const b=advanceSmartTrigger({...t,runtime:a.runtime},{price:51},{},new Date('2026-09-14T01:01:00Z'));assert.equal(b.matched,true);assert.equal(b.runtime.streak,2);
 const c=advanceSmartTrigger({...t,runtime:b.runtime},{price:52},{},new Date('2026-09-14T01:02:00Z'));assert.equal(c.matched,false);assert.match(c.summary,/避免重複/);
});

test('reusable trigger must leave and re-enter before a second fire',()=>{
 const t={policy:{oneShot:false},conditions:{all:[{field:'price',op:'>=',value:50}]},runtime:{}};
 const a=advanceSmartTrigger(t,{price:51},{},new Date('2026-09-14T01:00:00Z'));assert.equal(a.matched,true);
 const b=advanceSmartTrigger({...t,runtime:a.runtime},{price:52},{},new Date('2026-09-14T01:01:00Z'));assert.equal(b.matched,false);
 const c=advanceSmartTrigger({...t,runtime:b.runtime},{price:49},{},new Date('2026-09-14T01:02:00Z'));assert.equal(c.matched,false);
 const d=advanceSmartTrigger({...t,runtime:c.runtime},{price:51},{},new Date('2026-09-14T01:03:00Z'));assert.equal(d.matched,true);
});

test('one-shot trigger cannot fire twice even after leaving and re-entering',()=>{
 const t={policy:{oneShot:true},conditions:{all:[{field:'price',op:'>=',value:50}]},runtime:{}};
 const a=advanceSmartTrigger(t,{price:51},{},new Date('2026-09-14T01:00:00Z'));assert.equal(a.matched,true);
 const b=advanceSmartTrigger({...t,runtime:a.runtime},{price:49},{},new Date('2026-09-14T01:01:00Z'));
 const c=advanceSmartTrigger({...t,runtime:b.runtime},{price:51},{},new Date('2026-09-14T01:02:00Z'));assert.equal(c.matched,false);assert.equal(c.oneShotBlocked,true);
});

test('cooldown suppression can fire later if the condition stays valid',()=>{
 const t={policy:{oneShot:false,cooldownMinutes:10},conditions:{all:[{field:'price',op:'>=',value:50}]},runtime:{lastFiredAt:'2026-09-14T01:00:00Z',stable:false}};
 const a=advanceSmartTrigger(t,{price:51},{},new Date('2026-09-14T01:05:00Z'));assert.equal(a.matched,false);assert.equal(a.runtime.cooldownSuppressed,true);
 const b=advanceSmartTrigger({...t,runtime:a.runtime},{price:51},{},new Date('2026-09-14T01:11:00Z'));assert.equal(b.matched,true);
});
