import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySeed, legacyDemoSeed } from './seed.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function saveEnv(keys){return Object.fromEntries(keys.map(k=>[k,process.env[k]]));}
function restoreEnv(saved){for(const [k,v] of Object.entries(saved)){if(v==null)delete process.env[k];else process.env[k]=v;}}
async function loadStoreForFile(file,tag){
 const saved=saveEnv(['TRADING_TEST_SEED','TRADING_DB_FILE','FUGLE_API_KEY']);
 process.env.TRADING_TEST_SEED='0';process.env.TRADING_DB_FILE=file;process.env.FUGLE_API_KEY='x';
 try{return await import(`./store.mjs?${tag}=${Date.now()}-${Math.random()}`);}finally{restoreEnv(saved);}
}

test('production seed contains no simulated holdings, watchlist or market prices',()=>{
 assert.equal(emptySeed.metadata.ledgerMode,'uninitialized');
 assert.deepEqual(emptySeed.positions,[]);assert.deepEqual(emptySeed.watchlist,[]);assert.deepEqual(emptySeed.market,{});assert.deepEqual(emptySeed.playbooks,{});
});

test('production candle path never falls back to generated demo data',async()=>{
 const saved=saveEnv(['FUGLE_API_KEY','TRADING_TEST_SEED']);delete process.env.FUGLE_API_KEY;process.env.TRADING_TEST_SEED='0';
 try{const {getCandles}=await import(`./candles.mjs?production=${Date.now()}`);const x=await getCandles('1714','timeline',30);assert.equal(x.source,'market-data-unavailable');assert.equal(x.data.length,0);}finally{restoreEnv(saved);}
});

test('legacy simulated rows and demo cash are purged while a corrected holding and GPT URL are preserved',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'eason-prod-migrate-'));const file=join(dir,'state.json');const state=JSON.parse(JSON.stringify(legacyDemoSeed));
 state.positions=state.positions.filter(x=>x.symbol!=='2337');state.positions.push({symbol:'1714',name:'1714',quantity:1000,averageCost:16.65,openedAt:new Date().toISOString()});
 state.settings={...(state.settings||{}),stockChatUrl:'https://chatgpt.com/c/my-stock-chat'};
 state.audit.push({id:'a1',timestamp:new Date().toISOString(),action:'adjust_position',symbol:'1714',before:{symbol:'2337',quantity:100,averageCost:121},after:{symbol:'1714',quantity:1000,averageCost:16.65}});
 state.metadata.ledgerMode='manual';writeFileSync(file,JSON.stringify(state));
 try{const {db,recomputePortfolio}=await loadStoreForFile(file,'migration');const p=recomputePortfolio();assert.deepEqual(db.positions.map(x=>x.symbol),['1714']);assert.ok(!db.watchlist.some(x=>x.symbol==='2303'));assert.ok(!db.watchlist.some(x=>x.symbol==='2337'));assert.deepEqual(Object.keys(db.market),[]);assert.equal(db.metadata.seededAt,undefined);assert.equal(db.settings.stockChatUrl,'https://chatgpt.com/c/my-stock-chat');assert.equal(db.portfolio.cash,0);assert.equal(db.metadata.cashKnown,false);assert.equal(p.totalAssets,null);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('legacy sample symbol is preserved when the user explicitly corrected its real quantity or cost',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'eason-prod-keep-edited-'));const file=join(dir,'state.json');const state=JSON.parse(JSON.stringify(legacyDemoSeed));const p=state.positions.find(x=>x.symbol==='2303');p.quantity=300;p.averageCost=126.8;
 state.audit.push({id:'a2',timestamp:new Date().toISOString(),action:'adjust_position',symbol:'2303',before:{symbol:'2303',quantity:100,averageCost:131.5},after:{symbol:'2303',quantity:300,averageCost:126.8}});state.metadata.ledgerMode='manual';writeFileSync(file,JSON.stringify(state));
 try{const {db}=await loadStoreForFile(file,'keepEdited');const position=db.positions.find(x=>x.symbol==='2303')||null;assert.equal(position?.quantity,300);assert.equal(position?.averageCost,126.8);assert.equal(db.metadata.cashKnown,false);assert.equal(db.portfolio.cash,0);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('explicitly edited cash survives production migration',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'eason-prod-cash-'));const file=join(dir,'state.json');const state=JSON.parse(JSON.stringify(legacyDemoSeed));state.portfolio.cash=88888;state.metadata.ledgerMode='manual';state.metadata.lastManualCashEditAt=new Date().toISOString();state.audit.push({id:'cash1',timestamp:new Date().toISOString(),action:'update_cash',before:31420,after:88888});writeFileSync(file,JSON.stringify(state));
 try{const {db}=await loadStoreForFile(file,'keepCash');assert.equal(db.portfolio.cash,88888);assert.equal(db.metadata.cashKnown,true);}finally{rmSync(dir,{recursive:true,force:true});}
});


test('v0.3.6 mechanical discovery residue is removed during migration',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'eason-prod-no-discovery-'));const file=join(dir,'state.json');
 const state=JSON.parse(JSON.stringify(emptySeed));
 state.discoveryRuns=[{date:'2026-09-07',candidates:[{symbol:'2409'}]}];
 state.marketSnapshots=[{date:'2026-09-07',rows:[{symbol:'2409'}]}];
 state.metadata.discoveryCheckedCalendarDate='2026-09-07';
 state.closePackages=[{id:'cp_old',date:'2026-09-07',marketDiscovery:{candidates:[{symbol:'2409'}]},nightSelection:{horizonTradingDays:'5-10',mode:'ROLLING_POOL_PLUS_NEW_DISCOVERY',instruction:'old'}}];
 writeFileSync(file,JSON.stringify(state));
 try{const {db}=await loadStoreForFile(file,'removeDiscovery');assert.equal('discoveryRuns' in db,false);assert.equal('marketSnapshots' in db,false);assert.equal(db.metadata.discoveryCheckedCalendarDate,undefined);assert.equal('marketDiscovery' in db.closePackages[0],false);assert.equal(db.closePackages[0].nightSelection.mode,'GPT_RESEARCH_PLUS_ROLLING_POOL');}finally{rmSync(dir,{recursive:true,force:true});}
});
