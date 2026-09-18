import test from 'node:test';
import assert from 'node:assert/strict';
import {
  db, reset, listSetups, updateSetup, recordHypothesis, updateHypothesis,
  addWatch, dropWatch, recordTrade, generateClosePackage, createHandoff, getHandoff,
  updateSettings, maybeGenerateClosePackage
} from './store.mjs';

const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

test('legacy watchlist becomes a persistent rolling setup pool',()=>{
 reset();
 const setup=listSetups({activeOnly:true}).find(x=>x.symbol==='6147');
 assert.ok(setup);
 assert.equal(setup.stage,'WAIT_TRIGGER');
 assert.equal(setup.selectionValidity,'UNREVIEWED');
 updateSetup('6147',{stage:'WAIT_PULLBACK',statusReason:'第一段反轉已驗證，等第二段',selectionValidity:'VALIDATED',entryOpportunity:'WAITING'},'chatgpt');
 assert.equal(db.setups['6147'].stage,'WAIT_PULLBACK');
 assert.ok(db.setupEvents.some(x=>x.symbol==='6147'&&x.reason.includes('第二段')));
});

test('user hypothesis is stored separately from market evidence',()=>{
 reset();
 const h=recordHypothesis({symbol:'2337',text:'聯電退熱後資金可能輪回旺宏'},'user');
 assert.equal(h.status,'UNCONFIRMED');
 assert.equal(db.setups['2337'].selectionValidity,'UNREVIEWED');
 updateHypothesis(h.id,{status:'REJECTED',evidence:['尚無資金回流證據']},'chatgpt');
 assert.equal(db.hypotheses.find(x=>x.id===h.id).status,'REJECTED');
});

test('archiving a candidate keeps its setup card and explicit removal reason',()=>{
 reset();addWatch({symbol:'9999',name:'測試股'});
 dropWatch('9999',{reasonCode:'LOW_EFFICIENCY',reason:'連續多日沒有量價進展'},'chatgpt');
 assert.equal(db.watchlist.find(x=>x.symbol==='9999').state,'DROP');
 assert.equal(db.setups['9999'].stage,'ARCHIVED');
 assert.equal(db.setups['9999'].removalReasonCode,'LOW_EFFICIENCY');
 assert.equal(db.setups['9999'].removalReason,'連續多日沒有量價進展');
});

test('close package puts actual executed trades first and stays fresh after a later trade',()=>{
 reset();
 let cp=generateClosePackage({date:today(),force:true});
 assert.equal(cp.actualTrading.noTrade,true);
 recordTrade({symbol:'2337',name:'旺宏',side:'SELL',quantity:10,price:130},'user');
 cp=db.closePackages.find(x=>x.date===today());
 assert.equal(cp.actualTrading.noTrade,false);
 assert.equal(cp.actualTrading.sellCount,1);
 assert.equal(cp.actualTrading.bySymbol[0].symbol,'2337');
 assert.equal(cp.actualTrading.bySymbol[0].sellQty,10);
 assert.equal(cp.actualTrading.bySymbol[0].realizedPnl,84);
 assert.ok(Array.isArray(cp.rollingPool));
});

test('one-tap handoff carries a short prompt and expands authoritative context',()=>{
 reset();updateSettings({stockChatUrl:'https://chatgpt.com/c/example'},'app');
 const cp=generateClosePackage({date:today(),force:true});
 const h=createHandoff({type:'NIGHT_SELECTION',closePackageId:cp.id},'app');
 assert.ok(h.prompt.startsWith('今晚選股 #ho_'));
 assert.equal(h.stockChatUrl,'https://chatgpt.com/c/example');
 const expanded=getHandoff(h.id);
 assert.equal(expanded.closePackage.id,cp.id);
 assert.ok(expanded.rollingPool.length>0);
 assert.equal(expanded.contextMode,'GPT_RESEARCH_PLUS_ROLLING_POOL');
 assert.equal('marketDiscovery' in expanded,false);
 assert.equal('marketDiscovery' in expanded.closePackage,false);
 assert.equal(expanded.closePackage.nightSelection.mode,'GPT_RESEARCH_PLUS_ROLLING_POOL');
});

test('radar sync handoff carries current app state for the fixed stock GPT conversation',()=>{
 reset();
 const h=createHandoff({type:'RADAR_SYNC'},'app');
 assert.equal(h.type,'RADAR_SYNC');
 const x=getHandoff(h.id);
 assert.ok(Array.isArray(x.rollingPool));
 assert.ok(x.portfolio);
 assert.ok(Array.isArray(x.positions));
 assert.ok(x.positions.some(p=>p.symbol==='2303'&&p.playbook));
 assert.ok(Array.isArray(x.radarSnapshot));
 assert.ok(x.radarSnapshot.some(r=>r.symbol==='2303'&&r.playbook));
 assert.ok(Array.isArray(x.pendingReviewTriggers));
});


test('night selection package deliberately leaves new-stock discovery to GPT',()=>{
 reset();
 const cp=generateClosePackage({date:today(),force:true});
 assert.equal('marketDiscovery' in cp,false);
 assert.equal(cp.nightSelection.mode,'GPT_RESEARCH_PLUS_ROLLING_POOL');
 assert.match(cp.nightSelection.instruction,/GPT/);
});


test('after-close notification only says data is ready for GPT, without app-side stock picking',()=>{
 reset();
 const cp=maybeGenerateClosePackage(new Date('2026-09-07T06:05:00Z'));
 assert.ok(cp);
 const alert=db.alerts.find(x=>x.type==='NIGHT_READY'&&x.closePackageId===cp.id);
 assert.ok(alert);
 assert.match(alert.body,/GPT/);
 assert.equal('marketDiscovery' in cp,false);
});
