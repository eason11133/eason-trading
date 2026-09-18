export type RadarState = 'NEW' | 'WATCH' | 'TRIGGERED' | 'POSITION' | 'PARTIAL' | 'CLOSED' | 'DROP' | 'INVALID';
export type Rating = 'A' | 'A-' | 'B+' | 'B' | 'B-';
export type ChartMode = 'timeline' | '1m' | '5m' | 'daily' | 'weekly';
export type SetupStage = 'NEW_DISCOVERY'|'WAIT_TRIGGER'|'TRIGGERED_NO_ENTRY'|'WAIT_PULLBACK'|'READY'|'RECONFIRM'|'LOW_PRIORITY'|'POSITION_MANAGEMENT'|'CLOSED_POSITION'|'INVALIDATED'|'EXPIRED'|'ARCHIVED';
export type SelectionValidity = 'UNREVIEWED'|'VALIDATED'|'PARTIAL'|'FAILED';
export type EntryOpportunity = 'WAITING'|'GOOD'|'MARGINAL'|'BAD'|'MISSED'|'NOT_APPLICABLE';

export type SetupCard = {
  symbol:string; name?:string; discoveredAt?:string; setupType?:string; stage:SetupStage;
  originalThesis?:string; selectionValidity?:SelectionValidity; entryOpportunity?:EntryOpportunity;
  statusReason?:string; removalReason?:string|null; removalReasonCode?:string|null; updatedAt?:string;
};

export type StockSnapshot = {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  high: number;
  low: number;
  vwap: number;
  rvol: number;
  dataSource?: string;
  dataTrusted?: boolean;
  dataFresh?: boolean;
  quoteAgeSeconds?: number|null;
  updatedAt?: string;
  rating?: Rating;
  state: RadarState;
  priority?: number;
  nextStep: string;
  summary?: string;
  tags?: string[];
  goodZone?: [number, number];
  breakout?: number;
  invalid?: number;
  target1?: number;
  target2?: number;
  maxEntry?: number;
  reviewTriggerPrice?: number;
  reviewTriggerLabel?: string;
  position?: { quantity: number; averageCost: number; day: number; openedAt?: string };
  spark?: number[];
  setup?:SetupCard;
  setupStage?:SetupStage;
  selectionValidity?:SelectionValidity;
  entryOpportunity?:EntryOpportunity;
  discoveredAt?:string;
  setupReason?:string;
};

export type Portfolio = { totalAssets: number|null; totalAssetsTrusted?:boolean; cash: number; cashKnown?:boolean; marketValue: number|null; costBasis?:number; grossCostBasis?:number; remainingBuyFees?:number; unrealizedPnl?:number|null; unrealizedNetPnl?:number|null; estimatedExitCosts?:number|null; pnl: number|null; pnlPct: number|null; marketPending?:number; realizedPnl?:number; todayRealizedPnl?:number; todayPnlEstimate?:number|null; totalBrokerFees?:number; totalTransactionTax?:number; totalTradingCosts?:number; openFeeBasisComplete?:boolean; tradeCostHistoryComplete?:boolean; netPnlComplete?:boolean };
export type Candle = { date:string; open:number; high:number; low:number; close:number; volume:number; average?:number };
export type ChartSeries = { source:string; mode:ChartMode; updatedAt?:string; data:Candle[] };
export type RadarAlert = { id:string; createdAt:string; symbol?:string; name?:string; level:'HOT'|'RISK'|'WATCH'|string; type:string; title:string; body:string; triggerEventId?:string; snapshotId?:string };
export type TradeSide = 'BUY'|'SELL';
export type TradeMarker = { id?:string; side:TradeSide; price:number; quantity:number; executedAt?:string; createdAt?:string; timestamp?:string; realizedPnl?:number };
export type Hypothesis = {id:string;symbol:string;text:string;status:string;createdAt:string;updatedAt?:string;evidence?:string[]};
export type StockContext = { symbol:string; trades?:TradeMarker[]; playbook?:Record<string,any>; position?:any; market?:any; reviewTriggers?:ReviewTrigger[]; triggerEvents?:TriggerEvent[]; setup?:SetupCard; hypotheses?:Hypothesis[]; setupEvents?:any[] };

export type TradeReview = { id:string; createdAt?:string; created_at?:string; symbol:string; name?:string; thesis?:string; result?:string; pnlPct?:number|null; pnl_pct?:number|null; mfe?:number|null; mae?:number|null; followedPlan?:boolean|null; followed_plan?:number|null; lesson?:string; tags?:string[]|string };

export type HealthStatus = { ok:boolean; version:string; marketDataConfigured:boolean; marketData:string; marketDataVerified?:boolean; marketDataError?:string|null; activeSymbols?:number; hydratedSymbols?:number; freshSymbols?:number; quotesReady?:boolean; session?:{session:string;isOpen:boolean;timeZone:string}; ledgerMode?:'uninitialized'|'manual'|'live'|string; cloudMonitorConfigured?:boolean; cloudMonitor?:{configured:boolean;armed:number;ready:number;notReady:Array<{symbol:string;missing:string[]}>}; gptDirect?:{bridgeConfigured:boolean;pollIntervalSeconds:number;lastStateSyncAt?:string|null;lastCommandPollAt?:string|null;lastAppliedAt?:string|null;lastError?:string|null} };
export type TriggerPredicate={field:string;op:string;value:number};
export type ReviewTrigger = { id:string; symbol:string; label:string; purpose?:'REVIEW'|'INVALIDATION'|'TARGET'|string; status:string; conditions:{all?:TriggerPredicate[];any?:TriggerPredicate[];invalidation?:{all?:TriggerPredicate[];any?:TriggerPredicate[]}}; policy?:{oneShot?:boolean;minConsecutive?:number;cooldownMinutes?:number}; playbookVersion?:number|null; createdAt:string; firedAt?:string; eventId?:string };

export type TriggerEvent = { id:string; triggerId:string; symbol:string; label?:string; triggeredAt:string; snapshotId:string; reasons?:string[]; decisionSummary?:string; evidence?:Record<string,any>; market?:Record<string,any> };

export type ClosePackage = {
  id:string;date:string;generatedAt:string;
  actualTrading:{noTrade:boolean;totalTrades:number;buyCount:number;sellCount:number;symbolsTouched:number;realizedPnl:number;trades:any[];bySymbol:Array<{symbol:string;name?:string;buyQty:number;sellQty:number;buyValue:number;sellValue:number;realizedPnl:number;trades:any[]}>};
  closingPortfolio:Portfolio;closingPositions:any[];setupChanges:any[];triggerEvents:any[];newDiscoveries:SetupCard[];
  rollingPool:Array<{rank:number;symbol:string;name:string;rating?:string;priority:number;ledgerState:string;setupStage?:SetupStage;selectionValidity?:SelectionValidity;entryOpportunity?:EntryOpportunity;statusReason?:string;nextStep?:string}>;
  pendingReviewTriggers?:ReviewTrigger[];nightSelection?:{horizonTradingDays:string;mode:string;instruction:string};learningCandidates?:any[];
};
export type AppSettings={stockChatUrl:string;brokerage?:{feeRate:number;feeDiscount:number;regularMinFee:number;oddLotMinFee:number;stockSellTaxRate:number;dayTradeSellTaxRate:number;oddLotThreshold:number;configured:boolean}};
export type Handoff={id:string;type:string;status:string;prompt:string;stockChatUrl?:string;symbol?:string;eventId?:string;snapshotId?:string;closePackageId?:string;contextMode?:string;copyText?:string;transferMode?:string;[key:string]:any};

export type ReviewInboxEvent={id:string;triggerId:string;symbol:string;name?:string;label?:string;triggeredAt:string;snapshotId:string;reasons?:string[];decisionSummary?:string;evidence?:Record<string,any>;market?:Record<string,any>;reviewStatus:'PENDING'|'GPT_SENT'|'COMPLETED';reviewUpdatedAt?:string;handoffId?:string;cloudEventId?:string};
