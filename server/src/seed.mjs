const emptyPortfolio={totalAssets:null,totalAssetsTrusted:false,cash:0,cashKnown:false,marketValue:null,costBasis:0,grossCostBasis:0,remainingBuyFees:0,unrealizedPnl:null,unrealizedNetPnl:null,estimatedExitCosts:null,pnl:null,pnlPct:null,marketPending:0,realizedPnl:0,todayRealizedPnl:0,todayPnlEstimate:null,totalBrokerFees:0,totalTransactionTax:0,totalTradingCosts:0,openFeeBasisComplete:true,tradeCostHistoryComplete:true,netPnlComplete:true};

export const emptySeed = {
  metadata: { ledgerMode:'uninitialized', productionSeed:true },
  settings: { stockChatUrl:'', brokerage:{feeRate:0.001425,feeDiscount:1,regularMinFee:20,oddLotMinFee:1,stockSellTaxRate:0.003,dayTradeSellTaxRate:0.0015,oddLotThreshold:1000,configured:false} },
  portfolio: { ...emptyPortfolio },
  positions: [], watchlist: [], market: {}, playbooks: {},
  trades: [], alerts: [], reviews: [], devices: [], disclosureSeen: [], volumeBaselines: {},
  reviewTriggers: [], triggerEvents: [], triggerSnapshots: [], setups: {}, setupEvents: [], hypotheses: [], closePackages: [], handoffs: [], gptUpdateHistory: [], audit: []
};

// Legacy fixture only. Production runtime must never start from these values.
export const legacyDemoSeed = {
  metadata: { ledgerMode:'demo', seededAt:'2026-09-07T00:00:00+08:00', legacyDemoSeed:true },
  settings: { stockChatUrl:'', brokerage:{feeRate:0.001425,feeDiscount:1,regularMinFee:20,oddLotMinFee:1,stockSellTaxRate:0.003,dayTradeSellTaxRate:0.0015,oddLotThreshold:1000,configured:true} },
  portfolio: { totalAssets: 82420, cash: 31420, marketValue: 51000, pnl: 980, pnlPct: 1.96, realizedPnl:0 },
  positions: [
    { symbol:'2337', name:'旺宏', quantity:100, averageCost:121, openedAt:'2026-09-03T09:42:00+08:00' },
    { symbol:'2303', name:'聯電', quantity:100, averageCost:131.5, openedAt:'2026-09-07T10:21:00+08:00' },
    { symbol:'3162', name:'精確', quantity:300, averageCost:66.6, openedAt:'2026-09-03T09:00:00+08:00' }
  ],
  watchlist: [
    { symbol:'2303', name:'聯電', rating:'A', state:'TRIGGERED', firstSeen:'2026-09-04', priority:98 },
    { symbol:'2356', name:'英業達', rating:'A-', state:'WATCH', firstSeen:'2026-09-06', priority:84 },
    { symbol:'6147', name:'頎邦', rating:'B+', state:'WATCH', firstSeen:'2026-09-05', priority:71 },
    { symbol:'3162', name:'精確', rating:'B+', state:'POSITION', firstSeen:'2026-09-03', priority:75 },
    { symbol:'2337', name:'旺宏', rating:'A-', state:'POSITION', firstSeen:'2026-09-03', priority:91 }
  ],
  market: {
    '2303': { symbol:'2303', name:'聯電', price:131.5, changePct:3.2, high:132, low:128.5, vwap:130.2, rvol:1.72, updatedAt:'2026-09-07T13:24:00+08:00', source:'demo-seed' },
    '2337': { symbol:'2337', name:'旺宏', price:129.5, changePct:7.0, high:130.5, low:124.5, vwap:127.8, rvol:1.41, updatedAt:'2026-09-07T13:24:00+08:00', source:'demo-seed' },
    '2356': { symbol:'2356', name:'英業達', price:55.2, changePct:-0.4, high:55.8, low:54.7, vwap:55.1, rvol:1.28, updatedAt:'2026-09-07T13:24:00+08:00', source:'demo-seed' },
    '3162': { symbol:'3162', name:'精確', price:68.2, changePct:2.4, high:69.1, low:66.9, vwap:67.8, rvol:1.11, updatedAt:'2026-09-07T13:24:00+08:00', source:'demo-seed' },
    '6147': { symbol:'6147', name:'頎邦', price:72.1, changePct:-0.3, high:72.8, low:71.4, vwap:72.0, rvol:0.94, updatedAt:'2026-09-07T13:24:00+08:00', source:'demo-seed' }
  },
  playbooks: {
    '2303': { symbol:'2303', version:3, goodZone:[128,130], breakout:131, invalid:126.5, target1:138, target2:140, maxEntry:132.5, summary:'突破成立，等待回踩確認', nextStep:'觀察 131 是否守住，132.5 以上不追', updatedAt:'2026-09-07T00:00:00+08:00' },
    '2337': { symbol:'2337', version:2, breakout:126.5, invalid:123, target1:133, target2:140, summary:'持倉趨勢正常', nextStep:'不用操作', updatedAt:'2026-09-06T22:00:00+08:00' },
    '2356': { symbol:'2356', version:1, goodZone:[54.5,55.5], breakout:55.8, invalid:53.8, target1:59, target2:61, summary:'接近觸發', nextStep:'等待突破確認', updatedAt:'2026-09-06T22:00:00+08:00' },
    '3162': { symbol:'3162', version:2, invalid:65, target1:72, target2:75, summary:'等待下一波', nextStep:'等待型態確認', updatedAt:'2026-09-06T22:00:00+08:00' },
    '6147': { symbol:'6147', version:1, summary:'反轉雷達', nextStep:'持續觀察反轉條件', updatedAt:'2026-09-06T22:00:00+08:00' }
  },
  trades: [], alerts: [], reviews: [], devices: [], disclosureSeen: [], volumeBaselines: {}, reviewTriggers: [], triggerEvents: [], triggerSnapshots: [], setups: {}, setupEvents: [], hypotheses: [], closePackages: [], handoffs: [], gptUpdateHistory: [], audit: []
};

export const seed = process.env.TRADING_TEST_SEED==='1' ? legacyDemoSeed : emptySeed;
