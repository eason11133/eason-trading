import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { seed } from './seed.mjs';
import { DEFAULT_BROKERAGE_SETTINGS, estimateTradeCosts, normalizeBrokerageSettings } from './transaction-costs.mjs';
import { normalizeSmartTriggerConfig } from '../../shared/smart-trigger.mjs';

const clone=x=>JSON.parse(JSON.stringify(x));
const TAIPEI='Asia/Taipei';
const dateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:TAIPEI,year:'numeric',month:'2-digit',day:'2-digit'});
const clockFmt=new Intl.DateTimeFormat('en-US',{timeZone:TAIPEI,hour12:false,hourCycle:'h23',weekday:'short',hour:'2-digit',minute:'2-digit'});
const taipeiDate=(date=new Date())=>dateFmt.format(date);
const taipeiDateFrom=iso=>taipeiDate(new Date(iso));
const here=path.dirname(fileURLToPath(import.meta.url));
const file=process.env.TRADING_DB_FILE || path.resolve(here,'../data/state.json');

const SETUP_STAGES=new Set(['NEW_DISCOVERY','WAIT_TRIGGER','TRIGGERED_NO_ENTRY','WAIT_PULLBACK','READY','RECONFIRM','LOW_PRIORITY','POSITION_MANAGEMENT','CLOSED_POSITION','INVALIDATED','EXPIRED','ARCHIVED']);
const SELECTION_VALIDITY=new Set(['UNREVIEWED','VALIDATED','PARTIAL','FAILED']);
const ENTRY_OPPORTUNITY=new Set(['WAITING','GOOD','MARGINAL','BAD','MISSED','NOT_APPLICABLE']);
const HYPOTHESIS_STATUS=new Set(['UNCONFIRMED','SUPPORTED','REJECTED','EXPIRED']);

function inferSetupStage(w){
 if(['POSITION','PARTIAL'].includes(w?.state))return 'POSITION_MANAGEMENT';
 if(w?.state==='CLOSED')return 'CLOSED_POSITION';
 if(w?.state==='TRIGGERED')return 'TRIGGERED_NO_ENTRY';
 if(w?.state==='DROP')return 'ARCHIVED';
 if(w?.state==='NEW')return 'NEW_DISCOVERY';
 return 'WAIT_TRIGGER';
}
function setupFromLegacy(x,w){
 const pb=x.playbooks?.[w.symbol]||{};
 const now=new Date().toISOString();
 return {symbol:w.symbol,name:w.name||w.symbol,discoveredAt:w.firstSeen||taipeiDate(),setupType:'UNCLASSIFIED',stage:inferSetupStage(w),originalThesis:pb.summary||'既有候選',selectionValidity:'UNREVIEWED',entryOpportunity:'WAITING',statusReason:'從舊版候選池保留',stageEnteredAt:now,updatedAt:now,removalReason:null,removalReasonCode:null};
}
const LEGACY_DEMO_SYMBOLS=new Set(['2303','2337','2356','3162','6147']);
function legacySymbolActivity(x,symbol){
 const replaced=(x.audit||[]).some(a=>a.action==='adjust_position'&&a.before?.symbol===symbol&&a.after?.symbol&&a.after.symbol!==symbol);
 if(replaced)return {active:false,replaced:true};
 const audit=(x.audit||[]).some(a=>a.symbol===symbol||a.before?.symbol===symbol||a.after?.symbol===symbol);
 const direct=(x.trades||[]).some(t=>t.symbol===symbol)||(x.reviews||[]).some(r=>r.symbol===symbol)||(x.hypotheses||[]).some(h=>h.symbol===symbol)||(x.setupEvents||[]).some(e=>e.symbol===symbol)||(x.reviewTriggers||[]).some(t=>t.symbol===symbol);
 return {active:audit||direct,replaced:false};
}
function purgeLegacyDemoArtifacts(x){
 if(process.env.TRADING_TEST_SEED==='1'||!x.metadata?.seededAt)return x;
 const globallyInitialized=(x.audit||[]).some(a=>a.action==='initialize_ledger');
 if(globallyInitialized){delete x.metadata.seededAt;delete x.metadata.legacyDemoSeed;return x;}
 for(const symbol of LEGACY_DEMO_SYMBOLS){
   const info=legacySymbolActivity(x,symbol);
   if(info.active&&!info.replaced)continue;
   x.positions=(x.positions||[]).filter(p=>p.symbol!==symbol);
   x.watchlist=(x.watchlist||[]).filter(w=>w.symbol!==symbol);
   delete x.playbooks?.[symbol];delete x.setups?.[symbol];delete x.market?.[symbol];
 }
 delete x.metadata.seededAt;delete x.metadata.legacyDemoSeed;
 x.metadata.legacyDemoPurgedAt=new Date().toISOString();
 if(x.metadata.ledgerMode==='demo')x.metadata.ledgerMode=(x.positions||[]).length?'manual':'uninitialized';
 return x;
}
function migrate(x){
 x.metadata=x.metadata||{ledgerMode:'uninitialized'};
 x.portfolio=x.portfolio||{totalAssets:null,cash:0,marketValue:null,pnl:null,pnlPct:null};
 if(x.portfolio.realizedPnl==null)x.portfolio.realizedPnl=0;
 if(x.portfolio.costBasis==null)x.portfolio.costBasis=0;
 if(x.portfolio.unrealizedPnl==null)x.portfolio.unrealizedPnl=null;
 x.reviews=x.reviews||[];x.devices=x.devices||[];x.disclosureSeen=x.disclosureSeen||[];x.volumeBaselines=x.volumeBaselines||{};
 x.reviewTriggers=x.reviewTriggers||[];x.triggerEvents=x.triggerEvents||[];x.triggerSnapshots=x.triggerSnapshots||[];x.audit=x.audit||[];
 // v0.3.18 smart-trigger migration: preserve valid legacy v0.3.16 triggers,
 // add deterministic policy/runtime defaults, and fail safe on malformed active triggers.
 for(const t of x.reviewTriggers){
  if(!t||typeof t!=='object')continue;
  try{
   const smart=normalizeSmartTriggerConfig(t);
   t.label=smart.label;t.purpose=smart.purpose;t.conditions=smart.conditions;t.policy=smart.policy;t.expiresAt=smart.expiresAt;
   t.runtime={streak:Number(t.runtime?.streak||0),lastEvaluatedAt:t.runtime?.lastEvaluatedAt||null,lastFiredAt:t.runtime?.lastFiredAt||t.firedAt||null,stable:t.runtime?.stable===true};
  }catch(e){
   if(['ARMED','FIRING'].includes(t.status)){
    t.status='CANCELLED';
    t.cancelReason='legacy_trigger_invalid_after_v0.3.18';
    t.migrationError=String(e?.message||e).slice(0,300);
    t.updatedAt=new Date().toISOString();
   }
  }
 }
 x.setups=x.setups||{};x.setupEvents=x.setupEvents||[];x.hypotheses=x.hypotheses||[];x.closePackages=x.closePackages||[];x.handoffs=x.handoffs||[];x.gptUpdateHistory=x.gptUpdateHistory||[];
 // v0.3.8: stock discovery belongs to GPT, not the deterministic app/backend. Remove v0.3.6 research-scanner residue during migration.
 delete x.discoveryRuns;delete x.marketSnapshots;delete x.metadata.discoveryCheckedCalendarDate;delete x.metadata.lastDiscoveryMarketDate;
 for(const cp of x.closePackages){if(!cp||typeof cp!=='object')continue;delete cp.marketDiscovery;if(cp.nightSelection?.mode==='ROLLING_POOL_PLUS_NEW_DISCOVERY')cp.nightSelection={horizonTradingDays:'5-10',mode:'GPT_RESEARCH_PLUS_ROLLING_POOL',instruction:'保留跨日 rolling Setup；由 GPT 自行查公開市場找新候選，再和舊候選比較。'};}
 x.settings=x.settings||{stockChatUrl:''};if(x.settings.stockChatUrl==null)x.settings.stockChatUrl='';
 x.settings.brokerage=normalizeBrokerageSettings(x.settings.brokerage||DEFAULT_BROKERAGE_SETTINGS);
 for(const p of x.positions||[]){if(p.feeBasis==null)p.feeBasis=0;if(p.feeBasisKnown==null)p.feeBasisKnown=false;}
 purgeLegacyDemoArtifacts(x);
 const explicitCash=(x.audit||[]).some(a=>['update_cash','initialize_ledger'].includes(a.action))||!!x.metadata?.lastManualCashEditAt;
 if(x.metadata.cashKnown==null)x.metadata.cashKnown=explicitCash||x.metadata?.ledgerMode==='live';
 if(process.env.TRADING_TEST_SEED==='1')x.metadata.cashKnown=true;
 // Never preserve the legacy demo cash amount as if it were user money.
 if(x.metadata.legacyDemoPurgedAt&&!explicitCash&&x.metadata?.ledgerMode!=='live'){x.portfolio.cash=0;x.metadata.cashKnown=false;}
 if(x.metadata?.ledgerMode==='demo'&&(x.audit||[]).some(a=>['adjust_position','record_trade','initialize_ledger','set_position','remove_position','update_cash'].includes(a.action)))x.metadata.ledgerMode='manual';
 for(const w of x.watchlist||[])if(!x.setups[w.symbol])x.setups[w.symbol]=setupFromLegacy(x,w);
 for(const s of Object.values(x.setups||{})) if(s&&'positionStatus' in s) delete s.positionStatus;
 for(const m of Object.values(x.market||{})) if(!m.source)m.source='unknown';
 if(process.env.TRADING_TEST_SEED!=='1'){
   // Production never serves legacy simulated market rows. Keep only provider-backed values.
   for(const [symbol,m] of Object.entries(x.market||{})) if(!String(m?.source||'').startsWith('fugle')) delete x.market[symbol];
   if(x.metadata?.ledgerMode==='demo') x.metadata.ledgerMode=(x.audit||[]).length?'manual':'uninitialized';
 }
 return x;
}
function parseStateFile(candidate){return migrate(JSON.parse(fs.readFileSync(candidate,'utf8')));}
function load(){
 if(!fs.existsSync(file))return migrate(clone(seed));
 try{return parseStateFile(file);}catch(primaryError){
  const backup=`${file}.bak`;
  if(fs.existsSync(backup)){
   try{
    const recovered=parseStateFile(backup);
    recovered.metadata={...(recovered.metadata||{}),recoveredFromBackupAt:new Date().toISOString(),recoveryReason:String(primaryError?.message||primaryError)};
    return recovered;
   }catch{}
  }
  throw new Error(`Trading state is unreadable and no valid backup exists: ${primaryError?.message||primaryError}`);
 }
}
export let db=load();
let marketPersistTimer=null;
function trimTail(rows,limit){return Array.isArray(rows)&&rows.length>limit?rows.slice(-limit):(rows||[]);}
function pruneDurableHistory(){
 // Trading ledger and user-authored reviews are never pruned here. High-volume operational history is bounded so state.json stays fast for months of use.
 db.alerts=trimTail(db.alerts,1000);
 db.audit=trimTail(db.audit,2500);
 db.setupEvents=trimTail(db.setupEvents,1500);
 db.handoffs=trimTail(db.handoffs,250);
 db.closePackages=trimTail(db.closePackages,180);
 db.gptUpdateHistory=trimTail(db.gptUpdateHistory,40);
 db.triggerEvents=trimTail(db.triggerEvents,500);
 const recentSnapshots=trimTail(db.triggerSnapshots,50);
 const keepSnapshots=new Set([...(db.triggerEvents||[]).map(x=>x.snapshotId).filter(Boolean),...recentSnapshots.map(x=>x.id)]);
 db.triggerSnapshots=(db.triggerSnapshots||[]).filter(x=>keepSnapshots.has(x.id)).slice(-550);
 const active=(db.reviewTriggers||[]).filter(x=>['ARMED','FIRING'].includes(x.status));
 const closed=(db.reviewTriggers||[]).filter(x=>!['ARMED','FIRING'].includes(x.status)).slice(-800);
 const seen=new Set();db.reviewTriggers=[...active,...closed].filter(x=>!seen.has(x.id)&&(seen.add(x.id),true));
}
export function persist(){
 pruneDurableHistory();
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const tmp=`${file}.tmp-${process.pid}`;
 const backup=`${file}.bak`;
 const json=JSON.stringify(db,null,2);
 try{
  fs.writeFileSync(tmp,json,{encoding:'utf8'});
  // Parse the just-written file before replacing the authoritative state.
  JSON.parse(fs.readFileSync(tmp,'utf8'));
  if(fs.existsSync(file))fs.copyFileSync(file,backup);
  fs.renameSync(tmp,file);
 }catch(e){
  try{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}catch{}
  throw e;
 }
}
export function scheduleMarketPersist(delayMs=15000){
 if(marketPersistTimer)return;
 marketPersistTimer=setTimeout(()=>{marketPersistTimer=null;try{persist();}catch(e){console.error('[state persist]',e.message||e)}},delayMs);
 marketPersistTimer.unref?.();
}
export function flushPendingPersist(){
 if(marketPersistTimer){clearTimeout(marketPersistTimer);marketPersistTimer=null;}
 persist();
}
export function reset(){db=migrate(clone(seed));persist();}

function tradingDaysSince(iso){
 if(!iso)return 1;
 const start=new Date(iso); const now=new Date();
 let d=new Date(start.getFullYear(),start.getMonth(),start.getDate());
 const end=new Date(now.getFullYear(),now.getMonth(),now.getDate());
 let days=0;
 while(d<=end){const w=d.getDay();if(w!==0&&w!==6)days++;d.setDate(d.getDate()+1);}
 return Math.max(1,days);
}
function addAudit(action,{source='system',symbol,payload,before,after}={}){db.audit.push({id:`au_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,timestamp:new Date().toISOString(),source,action,...(symbol?{symbol}:{}),...(payload!==undefined?{payload}:{}),...(before!==undefined?{before}:{}),...(after!==undefined?{after}:{})});}
function markClosePackageDirty(date=taipeiDate()){db.metadata=db.metadata||{};db.metadata.closePackageDirtyDate=date;}
export function markClosePackageDirtyExternal(date=taipeiDate()){markClosePackageDirty(date);}

export function marketFreshness(m,date=new Date()){
 const trusted=String(m?.source||'').startsWith('fugle')&&Number.isFinite(Number(m?.price))&&Number(m.price)>0;
 const updatedMs=Date.parse(m?.updatedAt||'');
 const ageSeconds=Number.isFinite(updatedMs)?Math.max(0,Math.floor((date.getTime()-updatedMs)/1000)):null;
 const parts=Object.fromEntries(clockFmt.formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 const minutes=Number(parts.hour)*60+Number(parts.minute),weekday=parts.weekday;
 const isOpen=!['Sat','Sun'].includes(weekday)&&minutes>=9*60&&minutes<=13*60+30;
 // During the live session a quote older than 150s is stale. Outside the session the latest provider-backed close is still valid.
 const fresh=trusted&&(!isOpen||(ageSeconds!=null&&ageSeconds<=150));
 return {trusted,fresh,ageSeconds};
}

export function recomputePortfolio(){
 let pending=0;let trustedMarketValue=0;let estimatedExitCosts=0;let todayMarkChange=0;
 const brokerage=db.settings?.brokerage||DEFAULT_BROKERAGE_SETTINGS;
 for(const p of db.positions){
  const m=db.market[p.symbol];
  const {fresh}=marketFreshness(m);
  if(!fresh){pending++;continue;}
  const qty=Number(p.quantity),price=Number(m.price);trustedMarketValue+=qty*price;
  try{estimatedExitCosts+=estimateTradeCosts({side:'SELL',quantity:qty,price},brokerage).totalCosts}catch{}
  const changePct=Number(m.changePct);if(Number.isFinite(changePct)&&changePct!==-100){const prev=price/(1+changePct/100);if(Number.isFinite(prev))todayMarkChange+=qty*(price-prev);}
 }
 const grossCostBasis=db.positions.reduce((sum,p)=>sum+Number(p.quantity)*Number(p.averageCost),0);
 const remainingBuyFees=db.positions.reduce((sum,p)=>sum+Number(p.feeBasis||0),0);
 const openFeeBasisComplete=db.positions.every(p=>p.feeBasisKnown===true);
 const tradeCostHistoryComplete=db.trades.every(t=>t.costAccountingVersion==='v0.3.10');
 const netCostBasis=grossCostBasis+remainingBuyFees;
 const quotesReady=pending===0;
 const cashKnown=db.metadata?.cashKnown===true;
 const marketValue=quotesReady?Number(trustedMarketValue.toFixed(2)):null;
 const unrealizedPnl=quotesReady?Number((trustedMarketValue-netCostBasis).toFixed(2)):null;
 const unrealizedNetPnl=quotesReady?Number((trustedMarketValue-netCostBasis-estimatedExitCosts).toFixed(2)):null;
 const today=taipeiDate();const todayRealized=(db.trades||[]).filter(t=>taipeiDateFrom(t.timestamp||'')===today).reduce((sum,t)=>sum+Number(t.realizedPnl||0),0);
 const totalBrokerFees=(db.trades||[]).reduce((sum,t)=>sum+Number(t.brokerFee||0),0);const totalTransactionTax=(db.trades||[]).reduce((sum,t)=>sum+Number(t.transactionTax||0),0);
 db.portfolio.cash=Number(Number(db.portfolio.cash||0).toFixed(2));
 db.portfolio.cashKnown=cashKnown;
 db.portfolio.costBasis=Number(netCostBasis.toFixed(2));db.portfolio.grossCostBasis=Number(grossCostBasis.toFixed(2));db.portfolio.remainingBuyFees=Number(remainingBuyFees.toFixed(2));
 db.portfolio.marketValue=marketValue;
 db.portfolio.totalAssets=cashKnown&&quotesReady?Number((db.portfolio.cash+trustedMarketValue).toFixed(2)):null;
 db.portfolio.totalAssetsTrusted=cashKnown&&quotesReady;
 db.portfolio.unrealizedPnl=unrealizedPnl;db.portfolio.unrealizedNetPnl=unrealizedNetPnl;db.portfolio.estimatedExitCosts=quotesReady?Number(estimatedExitCosts.toFixed(2)):null;
 db.portfolio.pnl=unrealizedNetPnl;
 db.portfolio.pnlPct=quotesReady&&netCostBasis?Number((unrealizedNetPnl/netCostBasis*100).toFixed(2)):quotesReady?0:null;
 db.portfolio.todayRealizedPnl=Number(todayRealized.toFixed(2));db.portfolio.todayPnlEstimate=quotesReady?Number((todayMarkChange+todayRealized).toFixed(2)):null;
 db.portfolio.totalBrokerFees=Number(totalBrokerFees.toFixed(2));db.portfolio.totalTransactionTax=Number(totalTransactionTax.toFixed(2));db.portfolio.totalTradingCosts=Number((totalBrokerFees+totalTransactionTax).toFixed(2));
 db.portfolio.openFeeBasisComplete=openFeeBasisComplete;db.portfolio.tradeCostHistoryComplete=tradeCostHistoryComplete;db.portfolio.netPnlComplete=openFeeBasisComplete&&tradeCostHistoryComplete;
 db.portfolio.marketPending=pending;
 return db.portfolio;
}

function ensureSetup(symbol,name){
 let s=db.setups[symbol];
 if(!s){const w=db.watchlist.find(x=>x.symbol===symbol)||{symbol,name:name||symbol,state:'WATCH',firstSeen:taipeiDate()};s=setupFromLegacy(db,w);db.setups[symbol]=s;}
 if(name&&!s.name)s.name=name;
 return s;
}
function mutateSetup(symbol,patch,source='chatgpt',{requireReason=true}={}){
 const s=ensureSetup(symbol,patch.name);const before=clone(s);const now=new Date().toISOString();
 if(patch.stage&&!SETUP_STAGES.has(patch.stage))throw new Error('Invalid setup stage');
 if(patch.selectionValidity&&!SELECTION_VALIDITY.has(patch.selectionValidity))throw new Error('Invalid selection validity');
 if(patch.entryOpportunity&&!ENTRY_OPPORTUNITY.has(patch.entryOpportunity))throw new Error('Invalid entry opportunity');
 const stageChanged=patch.stage&&patch.stage!==s.stage;
 if(stageChanged&&requireReason&&!patch.statusReason&&!patch.removalReason)throw new Error('Setup stage change requires statusReason');
 if(stageChanged&&['INVALIDATED','EXPIRED','ARCHIVED'].includes(patch.stage)&&!patch.removalReason&&!patch.statusReason)throw new Error('Terminal setup stage requires a removal reason');
 Object.assign(s,patch,{symbol,updatedAt:now});
 if(stageChanged)s.stageEnteredAt=now;
 if(patch.removalReason)s.removalReason=patch.removalReason;
 if(patch.removalReasonCode)s.removalReasonCode=patch.removalReasonCode;
 if(stageChanged||patch.selectionValidity||patch.entryOpportunity||patch.statusReason||patch.originalThesis||patch.setupType){
   db.setupEvents.push({id:`se_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,timestamp:now,symbol,source,before,after:clone(s),reason:patch.statusReason||patch.removalReason||''});
   addAudit('update_setup',{source,symbol,before,after:clone(s)});markClosePackageDirty(taipeiDateFrom(now));
 }
 return s;
}
export function updateSetup(symbol,patch,source='chatgpt'){const s=mutateSetup(symbol,patch,source);persist();return s;}
export function listSetups({activeOnly=false}={}){
 const activeSymbols=new Set(db.watchlist.filter(x=>!['DROP','CLOSED'].includes(x.state)).map(x=>x.symbol));
 return Object.values(db.setups).filter(x=>!activeOnly||activeSymbols.has(x.symbol)).sort((a,b)=>{
  const wa=db.watchlist.find(w=>w.symbol===a.symbol)?.priority||0,wb=db.watchlist.find(w=>w.symbol===b.symbol)?.priority||0;return wb-wa;
 });
}
export function recordHypothesis(input,source='user'){
 if(!input.symbol||!input.text)throw new Error('symbol and text required');
 ensureSetup(String(input.symbol),input.name);
 const row={id:`hy_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,symbol:String(input.symbol),text:String(input.text),status:'UNCONFIRMED',source,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),evidence:[]};
 db.hypotheses.push(row);addAudit('record_hypothesis',{source,symbol:row.symbol,payload:row});markClosePackageDirty(taipeiDateFrom(row.createdAt));persist();return row;
}
export function updateHypothesis(id,patch,source='chatgpt'){
 const row=db.hypotheses.find(x=>x.id===id);if(!row)throw new Error('Hypothesis not found');
 if(patch.status&&!HYPOTHESIS_STATUS.has(patch.status))throw new Error('Invalid hypothesis status');
 Object.assign(row,patch,{updatedAt:new Date().toISOString()});addAudit('update_hypothesis',{source,symbol:row.symbol,payload:patch});markClosePackageDirty();persist();return row;
}

export function founderBrief(){
 recomputePortfolio();
 return {
  generatedAt:new Date().toISOString(),
  portfolio:db.portfolio,
  metadata:db.metadata||{ledgerMode:'uninitialized'},settings:{stockChatUrl:db.settings?.stockChatUrl||''},
  positions:db.positions.map(p=>({...p,day:tradingDaysSince(p.openedAt),market:db.market[p.symbol]||null,playbook:db.playbooks[p.symbol]||null,setup:ensureSetup(p.symbol,p.name)})),
  activeWatchlist:db.watchlist.filter(x=>!['DROP','CLOSED'].includes(x.state)).sort((a,b)=>b.priority-a.priority).map(w=>({...w,setup:ensureSetup(w.symbol,w.name)})),
  setups:listSetups({activeOnly:true}),
  playbooks:Object.values(db.playbooks),
  recentTrades:db.trades.slice(-10).reverse(),
  recentAlerts:db.alerts.slice(-10).reverse(),
  recentReviews:(db.reviews||[]).slice(-10).reverse(),
  latestClosePackage:db.closePackages.at(-1)||null,
  recentAudit:db.audit.slice(-10).reverse()
 };
}

export function radar(){
 recomputePortfolio();
 return db.watchlist.filter(x=>!['DROP','CLOSED'].includes(x.state)).sort((a,b)=>b.priority-a.priority).map(w=>({
  ...w,
  ...(db.market[w.symbol]||{}),
  dataTrusted:marketFreshness(db.market[w.symbol]).trusted,
  dataFresh:marketFreshness(db.market[w.symbol]).fresh,
  quoteAgeSeconds:marketFreshness(db.market[w.symbol]).ageSeconds,
  playbook:db.playbooks[w.symbol]||null,
  setup:ensureSetup(w.symbol,w.name),
  position:(()=>{const p=db.positions.find(p=>p.symbol===w.symbol);return p?{...p,day:tradingDaysSince(p.openedAt)}:null;})()
 }));
}

function ensureWatch(symbol,name){
 let w=db.watchlist.find(x=>x.symbol===symbol);
 if(!w){w={symbol,name:name||symbol,rating:'B',state:'WATCH',firstSeen:taipeiDate(),priority:50};db.watchlist.push(w);}
 ensureSetup(symbol,name||w.name);
 return w;
}

export function previewTrade(input){
 if(db.metadata?.cashKnown!==true)throw new Error('請先在持股頁設定目前現金，才能正確試算成交後現金');
 const side=String(input.side||'').toUpperCase();const symbol=String(input.symbol||'').trim();const quantity=Number(input.quantity),price=Number(input.price);
 if(!symbol||!['BUY','SELL'].includes(side)||!(quantity>0)||!(price>0))throw new Error('invalid trade');
 const costs=estimateTradeCosts({side,quantity,price,dayTrade:input.dayTrade===true},db.settings?.brokerage||DEFAULT_BROKERAGE_SETTINGS);
 const p=db.positions.find(x=>x.symbol===symbol);if(side==='SELL'&&(!p||Number(p.quantity)<quantity))throw new Error('Insufficient position');
 const afterCash=Number((Number(db.portfolio.cash||0)+costs.cashDelta).toFixed(2));
 if(side==='BUY'&&process.env.ALLOW_NEGATIVE_CASH!=='true'&&afterCash<0)throw new Error('Insufficient cash');
 let allocatedBuyFee=0,estimatedRealizedPnl=null;
 if(side==='SELL'&&p){allocatedBuyFee=Number((Number(p.feeBasis||0)*(quantity/Number(p.quantity))).toFixed(2));estimatedRealizedPnl=Number((costs.gross-costs.brokerFee-costs.transactionTax-(Number(p.averageCost)*quantity+allocatedBuyFee)).toFixed(2));}
 return {...costs,symbol,name:input.name||p?.name||db.watchlist.find(x=>x.symbol===symbol)?.name||symbol,beforeCash:Number(db.portfolio.cash||0),afterCash,allocatedBuyFee,estimatedRealizedPnl,brokerageConfigured:db.settings?.brokerage?.configured===true};
}

export function recordTrade(input,source='user'){
 const quote=previewTrade(input);if(!quote.brokerageConfigured)throw new Error('請先設定券商手續費折扣與整股／零股最低手續費，再記錄真實成交');const t={costAccountingVersion:'v0.3.10',id:`tr_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,timestamp:new Date().toISOString(),...input,side:quote.side,quantity:quote.quantity,price:quote.price,gross:quote.gross,brokerFee:quote.brokerFee,transactionTax:quote.transactionTax,totalCosts:quote.totalCosts,cashDelta:quote.cashDelta,dayTrade:input.dayTrade===true,brokerageConfigured:quote.brokerageConfigured};
 let p=db.positions.find(x=>x.symbol===input.symbol);const w=ensureWatch(input.symbol,input.name);db.portfolio.cash=quote.afterCash;
 if(quote.side==='BUY'){
  const gross=quote.gross;if(p){const oldQty=Number(p.quantity),newQty=oldQty+quote.quantity,totalGross=oldQty*Number(p.averageCost)+gross;p.quantity=newQty;p.averageCost=Number((totalGross/newQty).toFixed(4));p.feeBasis=Number((Number(p.feeBasis||0)+quote.brokerFee).toFixed(2));p.feeBasisKnown=p.feeBasisKnown===true;}
  else {p={symbol:input.symbol,name:input.name||w.name||input.symbol,quantity:quote.quantity,averageCost:quote.price,feeBasis:quote.brokerFee,feeBasisKnown:true,openedAt:t.timestamp};db.positions.push(p);}
  w.state='POSITION';w.priority=Math.max(w.priority||0,90);mutateSetup(input.symbol,{stage:'POSITION_MANAGEMENT',statusReason:`實際 BUY ${quote.quantity} 股 @ ${quote.price}`,entryOpportunity:'NOT_APPLICABLE'},source,{requireReason:false});
 } else {
  const preQty=Number(p.quantity),avgCost=Number(p.averageCost),allocatedBuyFee=Number((Number(p.feeBasis||0)*(quote.quantity/preQty)).toFixed(2));const acquisitionCost=avgCost*quote.quantity+allocatedBuyFee;const realized=quote.gross-quote.brokerFee-quote.transactionTax-acquisitionCost;
  t.allocatedBuyFee=allocatedBuyFee;t.acquisitionCost=Number(acquisitionCost.toFixed(2));t.realizedPnl=Number(realized.toFixed(2));t.realizedPnlComplete=p.feeBasisKnown===true;t.costBasis=avgCost;
  db.portfolio.realizedPnl=Number(((db.portfolio.realizedPnl||0)+realized).toFixed(2));p.quantity=preQty-quote.quantity;p.feeBasis=Number(Math.max(0,Number(p.feeBasis||0)-allocatedBuyFee).toFixed(2));
  if(p.quantity===0){db.positions=db.positions.filter(x=>x!==p);w.state='CLOSED';mutateSetup(input.symbol,{stage:'CLOSED_POSITION',statusReason:`實際 SELL 完成 ${quote.quantity} 股 @ ${quote.price}`,entryOpportunity:'WAITING'},source,{requireReason:false});}
  else {w.state='PARTIAL';mutateSetup(input.symbol,{stage:'POSITION_MANAGEMENT',statusReason:`實際 SELL ${quote.quantity} 股 @ ${quote.price}，仍有持股`},source,{requireReason:false});}
 }
 db.trades.push(t);if(db.metadata?.ledgerMode!=='live')db.metadata={...(db.metadata||{}),ledgerMode:'manual',lastManualTradeAt:new Date().toISOString()};recomputePortfolio();addAudit('record_trade',{source,symbol:input.symbol,payload:{...input,brokerFee:t.brokerFee,transactionTax:t.transactionTax,realizedPnl:t.realizedPnl??null}});markClosePackageDirty(taipeiDateFrom(t.timestamp));const currentClose=db.closePackages.find(x=>x.date===taipeiDateFrom(t.timestamp));if(currentClose)generateClosePackage({date:currentClose.date,force:true});persist();return {trade:t,position:db.positions.find(x=>x.symbol===input.symbol)||null,portfolio:db.portfolio,watch:w,setup:db.setups[input.symbol]};
}


export function adjustPosition(symbol,input,source='app'){
 const current=db.positions.find(x=>x.symbol===symbol);
 if(!current)throw new Error('Position not found');
 const nextSymbol=String(input.symbol||symbol).trim();
 const quantity=Number(input.quantity);
 const averageCost=Number(input.averageCost);
 if(!nextSymbol)throw new Error('symbol required');
 if(!Number.isFinite(quantity)||quantity<=0)throw new Error('quantity must be > 0');
 if(!Number.isFinite(averageCost)||averageCost<=0)throw new Error('averageCost must be > 0');
 if(nextSymbol!==symbol&&db.positions.some(x=>x.symbol===nextSymbol))throw new Error('Target symbol already has an open position');
 const before=clone(current);
 const oldWatch=db.watchlist.find(x=>x.symbol===symbol)||null;
 current.symbol=nextSymbol;
 current.quantity=quantity;
 current.averageCost=Number(averageCost.toFixed(4));
 const feeBasisExplicit=Number.isFinite(Number(input.feeBasis));
 const economicTermsChanged=quantity!==Number(before.quantity)||current.averageCost!==Number(before.averageCost);
 if(feeBasisExplicit){current.feeBasis=Number(Number(input.feeBasis).toFixed(2));current.feeBasisKnown=true;}
 else if(economicTermsChanged){current.feeBasis=0;current.feeBasisKnown=false;}
 current.name=input.name||db.market[nextSymbol]?.name||(nextSymbol===symbol?current.name:nextSymbol);
 if(nextSymbol!==symbol){
  if(oldWatch&&['POSITION','PARTIAL'].includes(oldWatch.state))oldWatch.state='WATCH';
  const newWatch=ensureWatch(nextSymbol,current.name);newWatch.state='POSITION';newWatch.priority=Math.max(newWatch.priority||0,90);
  const oldSetup=db.setups[symbol];
  if(oldSetup?.stage==='POSITION_MANAGEMENT')mutateSetup(symbol,{stage:'WAIT_TRIGGER',statusReason:`持股資料修正：部位代碼由 ${symbol} 改為 ${nextSymbol}`},source,{requireReason:false});
  mutateSetup(nextSymbol,{stage:'POSITION_MANAGEMENT',statusReason:`持股資料修正：代碼 ${symbol} → ${nextSymbol}，${quantity} 股 @ ${current.averageCost}`,entryOpportunity:'NOT_APPLICABLE'},source,{requireReason:false});
 } else {
  const w=ensureWatch(symbol,current.name);w.state='POSITION';w.priority=Math.max(w.priority||0,90);
  mutateSetup(symbol,{stage:'POSITION_MANAGEMENT',statusReason:`持股資料修正：${quantity} 股 @ ${current.averageCost}`},source,{requireReason:false});
 }
 const after=clone(current);
 recomputePortfolio();
 db.metadata={...(db.metadata||{}),ledgerMode:db.metadata?.ledgerMode==='live'?'live':'manual',lastManualPositionEditAt:new Date().toISOString()};
 addAudit('adjust_position',{source,symbol:nextSymbol,before,after,payload:{correctionOnly:true,cashUnchanged:true,feeBasisKnown:after.feeBasisKnown===true}});
 markClosePackageDirty();
 persist();
 return {position:after,portfolio:db.portfolio,previousSymbol:symbol};
}

export function setPosition(input,source='app'){
 const symbol=String(input.symbol||'').trim();const quantity=Number(input.quantity);const averageCost=Number(input.averageCost);
 if(!symbol)throw new Error('symbol required');if(!Number.isFinite(quantity)||quantity<=0)throw new Error('quantity must be > 0');if(!Number.isFinite(averageCost)||averageCost<=0)throw new Error('averageCost must be > 0');
 const existing=db.positions.find(x=>x.symbol===symbol);if(existing)return adjustPosition(symbol,{...input,symbol},source);
 const row={symbol,name:input.name||db.market[symbol]?.name||symbol,quantity,averageCost:Number(averageCost.toFixed(4)),feeBasis:Number(input.feeBasis||0),feeBasisKnown:Number.isFinite(Number(input.feeBasis)),openedAt:input.openedAt||new Date().toISOString()};
 db.positions.push(row);const w=ensureWatch(symbol,row.name);w.state='POSITION';w.priority=Math.max(w.priority||0,90);
 mutateSetup(symbol,{stage:'POSITION_MANAGEMENT',statusReason:`手動加入目前持股：${quantity} 股 @ ${row.averageCost}`,entryOpportunity:'NOT_APPLICABLE'},source,{requireReason:false});
 db.metadata={...(db.metadata||{}),ledgerMode:db.metadata?.ledgerMode==='live'?'live':'manual',lastManualPositionEditAt:new Date().toISOString()};
 recomputePortfolio();addAudit('set_position',{source,symbol,after:clone(row),payload:{correctionOnly:true,cashUnchanged:true}});markClosePackageDirty();persist();return {position:clone(row),portfolio:clone(db.portfolio)};
}

export function removePosition(symbol,source='app'){
 const current=db.positions.find(x=>x.symbol===symbol);if(!current)throw new Error('Position not found');const before=clone(current);
 db.positions=db.positions.filter(x=>x.symbol!==symbol);const w=db.watchlist.find(x=>x.symbol===symbol);if(w&&['POSITION','PARTIAL'].includes(w.state))w.state='WATCH';
 const setup=db.setups[symbol];if(setup?.stage==='POSITION_MANAGEMENT')mutateSetup(symbol,{stage:'WAIT_TRIGGER',statusReason:'手動修正持股：目前未持有',entryOpportunity:'WAITING'},source,{requireReason:false});
 db.metadata={...(db.metadata||{}),ledgerMode:db.metadata?.ledgerMode==='live'?'live':'manual',lastManualPositionEditAt:new Date().toISOString()};
 recomputePortfolio();addAudit('remove_position',{source,symbol,before,payload:{correctionOnly:true,cashUnchanged:true}});markClosePackageDirty();persist();return {removed:before,portfolio:clone(db.portfolio)};
}

export function updateCash(cash,source='app'){
 const value=Number(cash);if(!Number.isFinite(value)||value<0)throw new Error('cash must be >= 0');const before=db.portfolio.cash;db.portfolio.cash=Number(value.toFixed(2));
 db.metadata={...(db.metadata||{}),ledgerMode:db.metadata?.ledgerMode==='live'?'live':'manual',cashKnown:true,lastManualCashEditAt:new Date().toISOString()};
 recomputePortfolio();addAudit('update_cash',{source,before,after:db.portfolio.cash,payload:{correctionOnly:true}});markClosePackageDirty();persist();return clone(db.portfolio);
}

export function updatePlaybook(symbol,patch,source='chatgpt'){
 const watch=ensureWatch(symbol,patch.name);
 const {rating,state,priority,...strategyPatch}=patch;
 if(rating!=null)watch.rating=rating;
 if(state!=null){
  const held=db.positions.some(p=>p.symbol===symbol);
  if(held&&!['POSITION','PARTIAL'].includes(state))throw new Error('Cannot change an open-position ledger state via playbook');
  if(!held&&['POSITION','PARTIAL','CLOSED','DROP'].includes(state))throw new Error('Position/closed/drop state must come from trade ledger or drop-watch action');
  watch.state=state;
 }
 if(priority!=null)watch.priority=priority;
 const prev=db.playbooks[symbol]||{symbol,version:0};
 const next={...prev,...strategyPatch,symbol,version:(prev.version||0)+1,updatedAt:new Date().toISOString()};
 db.playbooks[symbol]=next;
 addAudit('update_playbook',{source,symbol,before:prev,after:next,payload:{watch:{rating:watch.rating,state:watch.state,priority:watch.priority}}});
 persist();return {playbook:next,watch,setup:ensureSetup(symbol,watch.name)};
}

export function addWatch(input,source='user'){
 let w=db.watchlist.find(x=>x.symbol===input.symbol);
 if(w){Object.assign(w,{name:input.name||w.name,rating:input.rating||w.rating,...(input.state?{state:input.state}:{}),priority:input.priority??w.priority??50});}
 else {w={symbol:input.symbol,name:input.name||input.symbol,rating:input.rating||'B',state:input.state||'WATCH',firstSeen:taipeiDate(),priority:input.priority??50};db.watchlist.push(w);}
 const setup=ensureSetup(input.symbol,w.name);
 if(['INVALIDATED','EXPIRED','ARCHIVED','CLOSED_POSITION'].includes(setup.stage))mutateSetup(input.symbol,{stage:'WAIT_TRIGGER',statusReason:input.reactivationReason||'重新加入滾動候選池',removalReason:null,removalReasonCode:null},source,{requireReason:false});
 if(input.setupType||input.originalThesis)mutateSetup(input.symbol,{...(input.setupType?{setupType:input.setupType}:{}),...(input.originalThesis?{originalThesis:input.originalThesis}:{}),statusReason:input.statusReason||'更新交易卡'},source,{requireReason:false});
 if(!db.playbooks[input.symbol])db.playbooks[input.symbol]={symbol:input.symbol,version:1,summary:'新加入雷達',nextStep:'等待第一個有效訊號',updatedAt:new Date().toISOString()};
 addAudit('add_watch',{source,symbol:input.symbol,after:w});markClosePackageDirty();
 persist();return {...w,setup:db.setups[input.symbol]};
}

export function dropWatch(symbol,input={},source='user'){
 if(typeof input==='string'){source=input;input={reasonCode:'MANUAL',reason:'舊版呼叫：手動移出雷達'};}
 const w=db.watchlist.find(x=>x.symbol===symbol);if(!w)throw new Error('Watch item not found');
 if(db.positions.some(p=>p.symbol===symbol))throw new Error('Cannot drop a stock with an open position');
 const reasonCode=input.reasonCode||'MANUAL';const reason=input.reason||'使用者手動封存候選';
 const before={...w};w.state='DROP';w.priority=0;
 const stage=reasonCode==='INVALIDATED'||reasonCode==='THESIS_BROKEN'?'INVALIDATED':reasonCode==='EXPIRED'?'EXPIRED':'ARCHIVED';
 mutateSetup(symbol,{stage,statusReason:reason,removalReason:reason,removalReasonCode:reasonCode},source,{requireReason:false});
 for(const t of (db.reviewTriggers||[]).filter(t=>t.symbol===symbol&&t.status==='ARMED')){t.status='CANCELLED';t.cancelReason='candidate_archived';t.updatedAt=new Date().toISOString();}
 addAudit('drop_watch',{source,symbol,before,after:w,payload:{reasonCode,reason}});markClosePackageDirty();persist();return {...w,setup:db.setups[symbol]};
}

export function updateMarket(snapshot){db.market[snapshot.symbol]={...(db.market[snapshot.symbol]||{}),...snapshot,updatedAt:new Date().toISOString()};if(snapshot.name){const p=db.positions.find(x=>x.symbol===snapshot.symbol);if(p)p.name=snapshot.name;const w=db.watchlist.find(x=>x.symbol===snapshot.symbol);if(w)w.name=snapshot.name;const setup=db.setups?.[snapshot.symbol];if(setup)setup.name=snapshot.name;}recomputePortfolio();scheduleMarketPersist();return db.market[snapshot.symbol];}
export function addAlerts(events){const keys=new Set(db.alerts.map(x=>x.dedupeKey));const added=[];for(const e of events){if(keys.has(e.dedupeKey))continue;const row={id:`al_${Date.now()}_${added.length}`,createdAt:new Date().toISOString(),...e};db.alerts.push(row);added.push(row);keys.add(e.dedupeKey);}if(added.length)persist();return added;}
export function alertsSince(since){if(!since)return db.alerts.slice().reverse();const t=Date.parse(since);return db.alerts.filter(x=>Date.parse(x.createdAt)>t).reverse();}
export function registerDevice(input){db.devices=db.devices||[];const found=db.devices.find(x=>x.token===input.token);if(found){Object.assign(found,input,{updatedAt:new Date().toISOString()});}else db.devices.push({...input,id:`dev_${Date.now()}`,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});persist();return db.devices.find(x=>x.token===input.token);}

export function listReviews(){return (db.reviews||[]).slice().reverse();}
export function recordReview(input,source='chatgpt'){
 db.reviews=db.reviews||[];
 const row={id:`rv_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,createdAt:new Date().toISOString(),symbol:input.symbol,name:input.name||db.watchlist.find(x=>x.symbol===input.symbol)?.name||input.symbol,thesis:input.thesis||'',result:input.result||'',pnlPct:input.pnlPct??null,mfe:input.mfe??null,mae:input.mae??null,followedPlan:input.followedPlan??null,lesson:input.lesson||'',tags:input.tags||[]};
 db.reviews.push(row);addAudit('record_review',{source,symbol:input.symbol,payload:row});markClosePackageDirty(taipeiDateFrom(row.createdAt));persist();return row;
}

export function initializeLedger(input,source='user'){
 const positions=(input.positions||[]).map(p=>({symbol:String(p.symbol),name:p.name||String(p.symbol),quantity:Number(p.quantity),averageCost:Number(p.averageCost),feeBasis:Number(p.feeBasis||0),feeBasisKnown:Number.isFinite(Number(p.feeBasis)),openedAt:p.openedAt||new Date().toISOString()})).filter(p=>p.quantity>0&&p.averageCost>0);
 db.positions=positions;
 const heldSymbols=new Set(positions.map(p=>p.symbol));
 for(const w of db.watchlist)if(['POSITION','PARTIAL'].includes(w.state)&&!heldSymbols.has(w.symbol)){w.state='WATCH';const s=ensureSetup(w.symbol,w.name);if(s.stage==='POSITION_MANAGEMENT')mutateSetup(w.symbol,{stage:'WAIT_TRIGGER',statusReason:'初始化真實帳本後確認目前未持有'},source,{requireReason:false});}
 db.portfolio.cash=Number(input.cash||0);db.portfolio.realizedPnl=Number(input.realizedPnl||0);
 if(input.clearTrades!==false)db.trades=[];
 db.metadata={...(db.metadata||{}),ledgerMode:'live',cashKnown:true,initializedAt:new Date().toISOString()};
 for(const p of positions){const w=ensureWatch(p.symbol,p.name);w.state='POSITION';w.priority=Math.max(w.priority||0,90);mutateSetup(p.symbol,{stage:'POSITION_MANAGEMENT',statusReason:'真實帳本初始化：目前持有',entryOpportunity:'NOT_APPLICABLE'},source,{requireReason:false});}
 recomputePortfolio();
 addAudit('initialize_ledger',{source,payload:{cash:db.portfolio.cash,positions:positions.map(p=>({...p}))}});
 persist();return founderBrief();
}

function ensureTriggerCollections(){db.reviewTriggers=db.reviewTriggers||[];db.triggerEvents=db.triggerEvents||[];db.triggerSnapshots=db.triggerSnapshots||[];}
export function listReviewTriggers({status,symbol}={}){ensureTriggerCollections();return db.reviewTriggers.filter(x=>(!status||x.status===status)&&(!symbol||x.symbol===symbol)).slice().reverse();}
export function createReviewTrigger(input,source='chatgpt'){
 ensureTriggerCollections();const symbol=String(input.symbol);ensureSetup(symbol);
 const smart=normalizeSmartTriggerConfig(input);
 const row={id:`rt_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,symbol,label:smart.label,purpose:smart.purpose,status:'ARMED',conditions:smart.conditions,policy:smart.policy,runtime:{streak:0,lastEvaluatedAt:null,lastFiredAt:null},capture:input.capture||['1m','5m','daily','market','playbook','position'],playbookVersion:db.playbooks[symbol]?.version||null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),expiresAt:smart.expiresAt,source};
 db.reviewTriggers.push(row);addAudit('create_review_trigger',{source,symbol:row.symbol,payload:row});markClosePackageDirty();persist();return row;
}
export function updateReviewTrigger(id,patch,source='chatgpt'){ensureTriggerCollections();const row=db.reviewTriggers.find(x=>x.id===id);if(!row)throw new Error('Review trigger not found');Object.assign(row,patch,{updatedAt:new Date().toISOString()});addAudit('update_review_trigger',{source,symbol:row.symbol,payload:patch});markClosePackageDirty();persist();return row;}
export function recordTriggerSnapshot(input){ensureTriggerCollections();const row={id:`ts_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,capturedAt:new Date().toISOString(),...input};db.triggerSnapshots.push(row);persist();return row;}
export function recordTriggerEvent(input){ensureTriggerCollections();const row={id:`te_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,triggeredAt:new Date().toISOString(),reviewStatus:'PENDING',reviewUpdatedAt:new Date().toISOString(),...input};db.triggerEvents.push(row);markClosePackageDirty(taipeiDateFrom(row.triggeredAt));persist();return row;}
export function listReviewInbox({status,limit=100}={}){ensureTriggerCollections();const valid=new Set(['PENDING','GPT_SENT','COMPLETED']);return db.triggerEvents.filter(x=>!status||x.reviewStatus===status).slice(-Math.max(1,Math.min(300,Number(limit)||100))).reverse().map(x=>({...x,reviewStatus:valid.has(x.reviewStatus)?x.reviewStatus:'PENDING',snapshot:getTriggerSnapshot(x.snapshotId)}));}
export function updateReviewInboxEvent(id,status,source='app'){ensureTriggerCollections();if(!['PENDING','GPT_SENT','COMPLETED'].includes(status))throw new Error('Invalid review inbox status');const row=db.triggerEvents.find(x=>x.id===id);if(!row)throw new Error('Trigger event not found');row.reviewStatus=status;row.reviewUpdatedAt=new Date().toISOString();addAudit('update_review_inbox',{source,symbol:row.symbol,payload:{eventId:id,status}});persist();return row;}
export function importCloudReviewEvent(input,source='cloud-monitor'){
 ensureTriggerCollections();
 const cloudEventId=String(input?.id||input?.cloudEventId||'').trim();if(!cloudEventId)throw new Error('cloud event id required');
 let row=db.triggerEvents.find(x=>x.cloudEventId===cloudEventId);
 const status=['PENDING','GPT_SENT','COMPLETED'].includes(input?.reviewStatus)?input.reviewStatus:'PENDING';
 if(row){
  const rank={PENDING:0,GPT_SENT:1,COMPLETED:2};
  if((rank[status]??0)>(rank[row.reviewStatus]??0))row.reviewStatus=status;
  row.reviewUpdatedAt=input.updatedAt||row.reviewUpdatedAt||new Date().toISOString();row.cloudContext=input.context||row.cloudContext||null;
  persist();return row;
 }
 const snapshot={id:`ts_cloud_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,capturedAt:input.createdAt||new Date().toISOString(),symbol:String(input.symbol||''),triggerId:input.targetId||null,marketAtTrigger:input.snapshot||null,cloudContext:input.context||null,source:'cloud-monitor',cloudEventId};
 db.triggerSnapshots.push(snapshot);
 row={id:`te_cloud_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,triggeredAt:input.createdAt||new Date().toISOString(),reviewStatus:status,reviewUpdatedAt:input.updatedAt||new Date().toISOString(),symbol:String(input.symbol||''),name:input.name||input.symbol,label:input.label||'GPT 複判',triggerId:input.targetId||null,snapshotId:snapshot.id,reasons:input.reasons||[],cloudContext:input.context||null,cloudEventId,source:'cloud-monitor'};
 db.triggerEvents.push(row);
 const trigger=db.reviewTriggers.find(x=>x.id===input.targetId);if(trigger&&trigger.status==='ARMED'){trigger.status=trigger.policy?.oneShot===false?'ARMED':'FIRED';trigger.firedAt=row.triggeredAt;trigger.updatedAt=row.reviewUpdatedAt;trigger.cloudEventId=cloudEventId;}
 addAudit('import_cloud_review_event',{source,symbol:row.symbol,payload:{cloudEventId,status,targetId:input.targetId||null}});markClosePackageDirty(taipeiDateFrom(row.triggeredAt));persist();return row;
}
export function listTriggerEvents({symbol,limit=50}={}){ensureTriggerCollections();return db.triggerEvents.filter(x=>!symbol||x.symbol===symbol).slice(-Math.max(1,Math.min(200,Number(limit)||50))).reverse();}
export function getTriggerSnapshot(id){ensureTriggerCollections();return db.triggerSnapshots.find(x=>x.id===id)||null;}

export function getSettings(){return {...db.settings};}
export function updateSettings(patch,source='app'){
 if(patch.stockChatUrl!=null){const v=String(patch.stockChatUrl).trim();if(v&& !/^https?:\/\//i.test(v))throw new Error('stockChatUrl must be an http(s) URL');db.settings.stockChatUrl=v;}
 if(patch.brokerage!=null)db.settings.brokerage=normalizeBrokerageSettings({...db.settings.brokerage,...patch.brokerage});
 addAudit('update_settings',{source,payload:{stockChatUrl:db.settings.stockChatUrl?'configured':'',brokerage:patch.brokerage?{...db.settings.brokerage}:undefined}});recomputePortfolio();persist();return getSettings();
}

function groupTrades(rows){
 const groups={};
 for(const t of rows){const g=groups[t.symbol]||(groups[t.symbol]={symbol:t.symbol,name:t.name||db.watchlist.find(w=>w.symbol===t.symbol)?.name||t.symbol,buyQty:0,sellQty:0,buyValue:0,sellValue:0,realizedPnl:0,trades:[]});g.trades.push(t);if(t.side==='BUY'){g.buyQty+=Number(t.quantity);g.buyValue+=Number(t.quantity)*Number(t.price);}else{g.sellQty+=Number(t.quantity);g.sellValue+=Number(t.quantity)*Number(t.price);g.realizedPnl+=Number(t.realizedPnl||0);}}
 return Object.values(groups).map(g=>({...g,buyValue:Number(g.buyValue.toFixed(2)),sellValue:Number(g.sellValue.toFixed(2)),realizedPnl:Number(g.realizedPnl.toFixed(2))}));
}
export function generateClosePackage({date=taipeiDate(),force=false}={}){
 const existing=db.closePackages.find(x=>x.date===date);if(existing&&!force)return existing;
 const trades=db.trades.filter(t=>taipeiDateFrom(t.timestamp)===date);
 const setupEvents=db.setupEvents.filter(e=>taipeiDateFrom(e.timestamp)===date);
 const triggerEvents=db.triggerEvents.filter(e=>taipeiDateFrom(e.triggeredAt)===date);
 const reviews=db.reviews.filter(e=>taipeiDateFrom(e.createdAt)===date);
 recomputePortfolio();
 const groups=groupTrades(trades);
 const ranking=radar().map((x,i)=>({rank:i+1,symbol:x.symbol,name:x.name,rating:x.rating,priority:x.priority||0,ledgerState:x.state,setupStage:x.setup?.stage,selectionValidity:x.setup?.selectionValidity,entryOpportunity:x.setup?.entryOpportunity,statusReason:x.setup?.statusReason||'',nextStep:x.playbook?.nextStep||''}));
 const row={
  id:existing?.id||`cp_${date.replaceAll('-','')}_${Math.random().toString(36).slice(2,6)}`,date,generatedAt:new Date().toISOString(),
  actualTrading:{noTrade:trades.length===0,totalTrades:trades.length,buyCount:trades.filter(x=>x.side==='BUY').length,sellCount:trades.filter(x=>x.side==='SELL').length,symbolsTouched:groups.length,realizedPnl:Number(trades.reduce((a,t)=>a+Number(t.realizedPnl||0),0).toFixed(2)),trades:clone(trades),bySymbol:groups},
  closingPortfolio:clone(db.portfolio),closingPositions:db.positions.map(p=>({...p,market:db.market[p.symbol]||null,setup:ensureSetup(p.symbol,p.name)})),
  setupChanges:clone(setupEvents),triggerEvents:clone(triggerEvents),reviews:clone(reviews),
  newDiscoveries:Object.values(db.setups).filter(s=>String(s.discoveredAt).slice(0,10)===date).map(clone),
  rollingPool:ranking,
  pendingReviewTriggers:listReviewTriggers({status:'ARMED'}),
  nightSelection:{horizonTradingDays:'5-10',mode:'GPT_RESEARCH_PLUS_ROLLING_POOL',instruction:'先更新既有 rolling Setup，再由 GPT 自行查公開市場/新聞/籌碼/題材找新候選，最後綜合排名；App 不做新股預選。'},
  learningCandidates:reviews.filter(x=>x.lesson).map(x=>({symbol:x.symbol,lesson:x.lesson,tags:x.tags||[]}))
 };
 if(existing){const i=db.closePackages.indexOf(existing);db.closePackages[i]=row;}else db.closePackages.push(row);
 if(db.metadata?.closePackageDirtyDate===date)delete db.metadata.closePackageDirtyDate;
 addAudit('generate_close_package',{source:'system',payload:{date,totalTrades:trades.length,poolSize:ranking.length}});persist();return row;
}
export function latestClosePackage(){return db.closePackages.at(-1)||null;}
export function maybeGenerateClosePackage(date=new Date()){
 const parts=Object.fromEntries(clockFmt.formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 if(['Sat','Sun'].includes(parts.weekday))return null;
 const minutes=Number(parts.hour)*60+Number(parts.minute);if(minutes<13*60+40)return null;
 const d=taipeiDate(date);const existing=db.closePackages.find(x=>x.date===d);const cp=existing&&db.metadata?.closePackageDirtyDate===d?generateClosePackage({date:d,force:true}):existing||generateClosePackage({date:d});
 addAlerts([{dedupeKey:`night-ready:${d}`,level:'WATCH',type:'NIGHT_READY',title:'收盤資料已整理',body:'今天持股、行情、Trigger 與策略狀態已整理；打開 Eason Trading 可直接交給 GPT 復盤。',closePackageId:cp.id}]);
 return cp;
}

export function createHandoff(input,source='app'){
 const type=input.type||'STOCK_REVIEW';const now=new Date().toISOString();let closePackageId=input.closePackageId||null,eventId=input.eventId||null,snapshotId=input.snapshotId||null,symbol=input.symbol||null;
 if(['CLOSE_REVIEW','NIGHT_SELECTION'].includes(type)){let cp=closePackageId?db.closePackages.find(x=>x.id===closePackageId)||null:null;if(cp&&db.metadata?.closePackageDirtyDate===cp.date)cp=generateClosePackage({date:cp.date,force:true});if(!cp)cp=maybeGenerateClosePackage()||latestClosePackage()||generateClosePackage();closePackageId=cp.id;}
 if(type==='TRIGGER_REVIEW'&&eventId){const ev=db.triggerEvents.find(x=>x.id===eventId);if(ev){symbol=symbol||ev.symbol;snapshotId=snapshotId||ev.snapshotId;}}
 const id=`ho_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
 const stockName=symbol?db.watchlist.find(w=>w.symbol===symbol)?.name||symbol:null;
 const prompt=type==='TRIGGER_REVIEW'?`${stockName||symbol||'這支'}值得重新判斷 #${id}`:type==='CLOSE_REVIEW'?`收盤復盤 #${id}`:type==='NIGHT_SELECTION'?`今晚選股 #${id}`:type==='RADAR_SYNC'?`同步目前 App 資料 #${id}`:`${stockName||symbol||'股票'}複判 #${id}`;
 const row={id,type,status:'READY',createdAt:now,updatedAt:now,source,symbol,eventId,snapshotId,closePackageId,prompt,contextMode:type==='NIGHT_SELECTION'?'GPT_RESEARCH_PLUS_ROLLING_POOL':'STRUCTURED_DATA_ONLY'};
 if(type==='TRIGGER_REVIEW'&&eventId){const ev=db.triggerEvents.find(x=>x.id===eventId);if(ev){ev.reviewStatus='GPT_SENT';ev.reviewUpdatedAt=now;ev.handoffId=id;}}
 db.handoffs.push(row);addAudit('create_handoff',{source,symbol,payload:{id,type,eventId,snapshotId,closePackageId}});persist();return {...row,stockChatUrl:db.settings.stockChatUrl||''};
}
export function getHandoff(id){
 const row=db.handoffs.find(x=>x.id===id);if(!row)return null;
 const event=row.eventId?db.triggerEvents.find(x=>x.id===row.eventId)||null:null;
 const snapshot=row.snapshotId?db.triggerSnapshots.find(x=>x.id===row.snapshotId)||null:event?.snapshotId?db.triggerSnapshots.find(x=>x.id===event.snapshotId)||null:null;
 const closePackage=row.closePackageId?db.closePackages.find(x=>x.id===row.closePackageId)||null:null;
 const symbol=row.symbol||event?.symbol||null;
 const brief=founderBrief();
 return {...row,stockChatUrl:db.settings.stockChatUrl||'',event,snapshot,closePackage,stockContext:symbol?{symbol,position:db.positions.find(x=>x.symbol===symbol)||null,watch:db.watchlist.find(x=>x.symbol===symbol)||null,market:db.market[symbol]||null,playbook:db.playbooks[symbol]||null,setup:db.setups[symbol]||null,hypotheses:db.hypotheses.filter(x=>x.symbol===symbol).slice().reverse(),recentTrades:db.trades.filter(x=>x.symbol===symbol).slice(-20).reverse()}:null,rollingPool:listSetups({activeOnly:true}),portfolio:clone(brief.portfolio),positions:clone(brief.positions),radarSnapshot:radar(),pendingReviewTriggers:listReviewTriggers({status:'ARMED'})};
}
export function listHandoffs({status='READY',limit=50}={}){return db.handoffs.filter(x=>!status||x.status===status).slice(-Math.max(1,Math.min(200,Number(limit)||50))).reverse();}
export function acknowledgeHandoff(id,source='chatgpt'){const row=db.handoffs.find(x=>x.id===id);if(!row)throw new Error('Handoff not found');row.status='ACKNOWLEDGED';row.updatedAt=new Date().toISOString();addAudit('acknowledge_handoff',{source,symbol:row.symbol,payload:{id}});persist();return row;}


const GPT_UPDATE_START='--- EASON_TRADING_UPDATE_V1 ---';
const GPT_UPDATE_END='--- END_EASON_TRADING_UPDATE ---';
const GPT_ACTIONS=new Set(['UPSERT','KEEP','ARCHIVE','NO_CHANGE']);
const GPT_RATINGS=new Set(['A','A-','B+','B','B-']);
const GPT_TRIGGER_FIELDS=new Set(['price','rvol','vwap','high','low','changePct']);
const GPT_TRIGGER_OPS=new Set(['>=','>','<=','<','==']);
const FORBIDDEN_GPT_KEYS=new Set(['positions','position','portfolio','cash','trades','trade','ledger','actualTrading','realizedPnl']);
function cleanSymbol(x){const z=String(x||'').trim();if(!/^\d{4,6}$/.test(z))throw new Error(`GPT update has invalid symbol: ${z||'(empty)'}`);return z;}
function finiteOrNull(x,name){if(x==null||x==='')return null;const n=Number(x);if(!Number.isFinite(n))throw new Error(`${name} must be a number`);return n;}
function extractGptUpdateObject(text){
 const raw=String(text||'').trim();if(!raw)throw new Error('剪貼簿是空的');if(raw.includes('[EASON TRADING APP HANDOFF]'))throw new Error('這是 App → GPT 的資料包，不是 GPT 回寫結果');let jsonText=raw;
 const a=raw.indexOf(GPT_UPDATE_START),b=raw.indexOf(GPT_UPDATE_END);
 if(a>=0){if(b<a)throw new Error('找得到 GPT update 開頭，但沒有正確結尾');jsonText=raw.slice(a+GPT_UPDATE_START.length,b).trim();}
 else {const first=raw.indexOf('{'),last=raw.lastIndexOf('}');if(first>=0&&last>first)jsonText=raw.slice(first,last+1);}
 let obj;try{obj=JSON.parse(jsonText)}catch{throw new Error('找不到可讀的 EASON_TRADING_UPDATE_V1 JSON');}
 if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error('GPT update 必須是 JSON object');
 for(const k of Object.keys(obj))if(FORBIDDEN_GPT_KEYS.has(k))throw new Error(`GPT update 禁止修改 ${k}`);
 if(Number(obj.version||1)!==1)throw new Error('不支援的 GPT update version');
 const items=Array.isArray(obj.setups)?obj.setups:[];if(!items.length)throw new Error('GPT update 沒有 setups');return {...obj,version:1,setups:items};
}
function normalizeGptUpdate(text){
 const obj=extractGptUpdateObject(text);const setups=[];let triggerCount=0;
 for(const raw of obj.setups){
  if(!raw||typeof raw!=='object')throw new Error('setups 每一筆都必須是 object');for(const k of Object.keys(raw))if(FORBIDDEN_GPT_KEYS.has(k))throw new Error(`GPT setup 禁止修改 ${k}`);
  const symbol=cleanSymbol(raw.symbol),action=String(raw.action||'UPSERT').toUpperCase();if(!GPT_ACTIONS.has(action))throw new Error(`${symbol}: invalid action ${action}`);
  const priority=raw.priority==null?null:Number(raw.priority);if(priority!=null&&(!Number.isFinite(priority)||priority<0||priority>100))throw new Error(`${symbol}: priority must be 0-100`);
  const rating=raw.rating==null?null:String(raw.rating);if(rating&&!GPT_RATINGS.has(rating))throw new Error(`${symbol}: invalid rating`);
  const stage=raw.stage==null?null:String(raw.stage);if(stage&&!SETUP_STAGES.has(stage))throw new Error(`${symbol}: invalid stage`);
  const selectionValidity=raw.selectionValidity==null?null:String(raw.selectionValidity);if(selectionValidity&&!SELECTION_VALIDITY.has(selectionValidity))throw new Error(`${symbol}: invalid selectionValidity`);
  const entryOpportunity=raw.entryOpportunity==null?null:String(raw.entryOpportunity);if(entryOpportunity&&!ENTRY_OPPORTUNITY.has(entryOpportunity))throw new Error(`${symbol}: invalid entryOpportunity`);
  const pb=raw.playbook&&typeof raw.playbook==='object'?raw.playbook:{};let goodZone=null;
  if(pb.goodZone!=null){if(!Array.isArray(pb.goodZone)||pb.goodZone.length!==2)throw new Error(`${symbol}: goodZone must be [low, high]`);goodZone=[finiteOrNull(pb.goodZone[0],`${symbol}.goodZone[0]`),finiteOrNull(pb.goodZone[1],`${symbol}.goodZone[1]`)];if(goodZone[0]>goodZone[1])goodZone.reverse();}
  const reviewTriggersProvided=Array.isArray(raw.reviewTriggers);const reviewTriggers=reviewTriggersProvided?raw.reviewTriggers.map((t,i)=>{try{return normalizeSmartTriggerConfig(t)}catch(e){throw new Error(`${symbol}: trigger ${i+1}: ${e.message}`)}}):[];
  triggerCount+=reviewTriggers.length;
  const numericPlaybook={};for(const k of ['breakout','invalid','target1','target2','maxEntry']){const n=finiteOrNull(pb[k],`${symbol}.${k}`);if(n!=null)numericPlaybook[k]=n;}
  setups.push({symbol,name:raw.name?String(raw.name):undefined,action,priority,rating,stage,setupType:raw.setupType?String(raw.setupType):undefined,originalThesis:raw.originalThesis?String(raw.originalThesis):undefined,statusReason:raw.statusReason?String(raw.statusReason):undefined,selectionValidity,entryOpportunity,removalReason:raw.removalReason?String(raw.removalReason):undefined,removalReasonCode:raw.removalReasonCode?String(raw.removalReasonCode):undefined,reviewTriggersProvided,replaceReviewTriggers:reviewTriggersProvided&&raw.replaceReviewTriggers!==false,playbook:{...(goodZone?{goodZone}:{}),...numericPlaybook,...(pb.summary!=null?{summary:String(pb.summary)}:{}),...(pb.nextStep!=null?{nextStep:String(pb.nextStep)}:{})},reviewTriggers});
 }
 return {version:1,generatedAt:obj.generatedAt||null,marketDate:obj.marketDate||null,handoffId:obj.handoffId?String(obj.handoffId):null,triggerEventId:obj.triggerEventId?String(obj.triggerEventId):null,cloudEventId:obj.cloudEventId?String(obj.cloudEventId):null,reviewEventId:obj.reviewEventId?String(obj.reviewEventId):null,summary:obj.summary?String(obj.summary):'',setups,triggerCount};
}
function gptUpdateHashNormalized(x){return crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');}
function strategySnapshotForSymbols(symbols){const set=new Set(symbols);return {watchlist:clone((db.watchlist||[]).filter(x=>set.has(x.symbol))),playbooks:clone(Object.fromEntries(Object.entries(db.playbooks||{}).filter(([k])=>set.has(k)))),setups:clone(Object.fromEntries(Object.entries(db.setups||{}).filter(([k])=>set.has(k)))),reviewTriggers:clone((db.reviewTriggers||[]).filter(x=>set.has(x.symbol)))};}
function diffOneGptItem(item){const w=db.watchlist.find(x=>x.symbol===item.symbol)||null,pb=db.playbooks[item.symbol]||null,setup=db.setups[item.symbol]||null,armed=(db.reviewTriggers||[]).filter(x=>x.symbol===item.symbol&&x.status==='ARMED').length;const changes=[];const add=(label,before,after)=>{if(after!=null&&JSON.stringify(before)!==JSON.stringify(after))changes.push({field:label,before:before??null,after});};if(item.action==='ARCHIVE')changes.push({field:'action',before:w?.state||null,after:'ARCHIVE'});else if(item.action!=='NO_CHANGE'){add('priority',w?.priority,item.priority);add('rating',w?.rating,item.rating);add('stage',setup?.stage,item.stage);for(const k of ['goodZone','breakout','invalid','target1','target2','maxEntry','summary','nextStep'])if(Object.prototype.hasOwnProperty.call(item.playbook||{},k))add(k,pb?.[k],item.playbook[k]);if(item.reviewTriggersProvided)add('reviewTriggers',armed,item.reviewTriggers.length);}return {symbol:item.symbol,name:item.name||w?.name||item.symbol,action:item.action,priority:item.priority,rating:item.rating,stage:item.stage,reviewTriggers:item.reviewTriggers.length,changes};}
export function previewGptUpdate(text){const x=normalizeGptUpdate(text),hash=gptUpdateHashNormalized(x),duplicate=db.metadata?.lastGptUpdateHash===hash;const rows=x.setups.map(diffOneGptItem);return {version:x.version,summary:x.summary,total:x.setups.length,triggerCount:x.triggerCount,duplicate,changeCount:rows.reduce((n,r)=>n+r.changes.length,0),rows};}
export function applyGptUpdate(text,source='gpt-clipboard'){
 const x=normalizeGptUpdate(text),hash=gptUpdateHashNormalized(x);
 if(db.metadata?.lastGptUpdateHash===hash)return {ok:true,duplicate:true,summary:'這份 GPT 更新已經套用過',total:0,triggerCount:0,touched:[],results:[],portfolio:clone(recomputePortfolio())};
 const before=clone(db),results=[],touched=[];const symbols=x.setups.map(i=>i.symbol);const strategyBefore=strategySnapshotForSymbols(symbols);const previousHash=db.metadata?.lastGptUpdateHash||null;try{
  for(const item of x.setups){const held=db.positions.some(p=>p.symbol===item.symbol);if(item.action==='NO_CHANGE'){results.push({symbol:item.symbol,action:'NO_CHANGE'});continue;}
   if(item.action==='ARCHIVE'){if(held){results.push({symbol:item.symbol,action:'SKIPPED_HELD',warning:'持股不能被 GPT 從雷達封存'});continue;}const existing=db.watchlist.find(w=>w.symbol===item.symbol);if(existing)dropWatch(item.symbol,{reasonCode:item.removalReasonCode||'GPT_ARCHIVE',reason:item.removalReason||item.statusReason||'GPT 晚間選股封存'},source);results.push({symbol:item.symbol,action:'ARCHIVE'});touched.push(item.symbol);continue;}
   addWatch({symbol:item.symbol,name:item.name,rating:item.rating||undefined,priority:item.priority??undefined,setupType:item.setupType,originalThesis:item.originalThesis,statusReason:item.statusReason||'GPT 更新滾動候選'},source);
   const setupPatch={};for(const k of ['stage','setupType','originalThesis','statusReason','selectionValidity','entryOpportunity'])if(item[k]!=null)setupPatch[k]=item[k];if(held&&setupPatch.stage&&setupPatch.stage!=='POSITION_MANAGEMENT')delete setupPatch.stage;if(Object.keys(setupPatch).length)mutateSetup(item.symbol,setupPatch,source,{requireReason:false});
   const playbookPatch={};if(item.rating!=null)playbookPatch.rating=item.rating;if(item.priority!=null)playbookPatch.priority=item.priority;Object.assign(playbookPatch,item.playbook||{});if(Object.keys(playbookPatch).length)updatePlaybook(item.symbol,playbookPatch,source);
   if(item.reviewTriggersProvided&&item.replaceReviewTriggers){for(const t of db.reviewTriggers.filter(t=>t.symbol===item.symbol&&t.status==='ARMED'))updateReviewTrigger(t.id,{status:'CANCELLED',cancelReason:'replaced_by_gpt_update'},source);}if(item.reviewTriggers.length){for(const t of item.reviewTriggers)createReviewTrigger({symbol:item.symbol,...t},source);}
   results.push({symbol:item.symbol,action:item.action,rating:item.rating,priority:item.priority,stage:item.stage,triggers:item.reviewTriggers.length});touched.push(item.symbol);
  }
  const appliedAt=new Date().toISOString();const handoffEventId=(x.handoffId&&db.handoffs.find(h=>h.id===x.handoffId)?.eventId)||null;const reviewRef=x.reviewEventId||x.triggerEventId||handoffEventId||x.cloudEventId||null;const inboxEvent=reviewRef?db.triggerEvents.find(e=>e.id===reviewRef||e.cloudEventId===reviewRef):null;if(inboxEvent){inboxEvent.reviewStatus='COMPLETED';inboxEvent.reviewUpdatedAt=appliedAt;inboxEvent.completedByGptUpdateHash=hash;}const completedCloudEventId=inboxEvent?.cloudEventId||x.cloudEventId||null;db.metadata={...(db.metadata||{}),lastGptUpdateHash:hash,lastGptUpdateAppliedAt:appliedAt};db.gptUpdateHistory=db.gptUpdateHistory||[];db.gptUpdateHistory.push({id:`gu_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,appliedAt,source,hash,previousHash,summary:x.summary,symbols:[...new Set(symbols)],before:strategyBefore,undoneAt:null});addAudit('apply_gpt_update',{source,payload:{summary:x.summary,total:x.setups.length,triggerCount:x.triggerCount,results,hash}});markClosePackageDirty();persist();return {ok:true,duplicate:false,summary:x.summary,total:x.setups.length,triggerCount:x.triggerCount,touched:[...new Set(touched)],results,canUndo:true,cloudEventId:completedCloudEventId,reviewEventId:x.reviewEventId||null,portfolio:clone(recomputePortfolio())};
 }catch(e){db=before;persist();throw e;}
}

export function undoLastGptUpdate(source='app'){
 db.gptUpdateHistory=db.gptUpdateHistory||[];const h=[...db.gptUpdateHistory].reverse().find(x=>!x.undoneAt);if(!h)throw new Error('沒有可復原的 GPT 更新');
 const symbols=new Set(h.symbols||[]);const snap=h.before||{};
 db.watchlist=(db.watchlist||[]).filter(x=>!symbols.has(x.symbol));for(const row of snap.watchlist||[])db.watchlist.push(clone(row));
 for(const symbol of symbols){delete db.playbooks[symbol];delete db.setups[symbol];}Object.assign(db.playbooks,clone(snap.playbooks||{}));Object.assign(db.setups,clone(snap.setups||{}));
 db.reviewTriggers=(db.reviewTriggers||[]).filter(x=>!symbols.has(x.symbol)).concat(clone(snap.reviewTriggers||[]));
 for(const p of db.positions||[]){if(!symbols.has(p.symbol))continue;const w=ensureWatch(p.symbol,p.name);w.state=(w.state==='PARTIAL')?'PARTIAL':'POSITION';w.priority=Math.max(w.priority||0,90);const setup=ensureSetup(p.symbol,p.name);setup.stage='POSITION_MANAGEMENT';setup.entryOpportunity='NOT_APPLICABLE';setup.updatedAt=new Date().toISOString();}
 h.undoneAt=new Date().toISOString();h.undoneBy=source;db.metadata={...(db.metadata||{}),lastGptUpdateHash:h.previousHash||null,lastGptUpdateAppliedAt:h.undoneAt};addAudit('undo_gpt_update',{source,payload:{id:h.id,hash:h.hash,symbols:[...symbols]}});markClosePackageDirty();recomputePortfolio();persist();return {ok:true,undoneId:h.id,summary:h.summary,symbols:[...symbols],portfolio:clone(db.portfolio)};
}

export const runtimeState={focusSymbol:null};
export function setFocusSymbol(symbol=null){runtimeState.focusSymbol=symbol||null;return {focusSymbol:runtimeState.focusSymbol};}
