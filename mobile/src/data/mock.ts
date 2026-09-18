import type { Portfolio, StockSnapshot } from '../types/trading';

export const portfolio: Portfolio = {
  totalAssets: 82420,
  cash: 31420,
  marketValue: 51000,
  pnl: 980,
  pnlPct: 1.96,
};

export const stocks: StockSnapshot[] = [
  {
    symbol: '2303', name: '聯電', price: 131.5, changePct: 3.2, high: 132, low: 128.5, vwap: 130.2, rvol: 1.72,
    rating: 'A', state: 'TRIGGERED', nextStep: '觀察 131 是否守住，132.5 以上不追', tags: ['半導體', '成熟製程'],
    goodZone: [128, 130], breakout: 131, invalid: 126.5, target1: 138, target2: 140,
    position: { quantity: 100, averageCost: 131.5, day: 3 },
    spark: [126,127,128,128.5,129.8,129.2,130.5,131,130.8,131.5]
  },
  {
    symbol: '2337', name: '旺宏', price: 129.5, changePct: 7.0, high: 130.5, low: 124.5, vwap: 127.8, rvol: 1.41,
    rating: 'A-', state: 'POSITION', nextStep: '不用操作', tags: ['半導體', '記憶體'],
    breakout: 126.5, invalid: 123, target1: 133, target2: 140,
    position: { quantity: 100, averageCost: 121, day: 5 },
    spark: [121,122,123,123.5,124,126,127,128,129,129.5]
  },
  {
    symbol: '2356', name: '英業達', price: 55.2, changePct: -0.4, high: 55.8, low: 54.7, vwap: 55.1, rvol: 1.28,
    rating: 'A-', state: 'WATCH', nextStep: '等待突破確認', tags: ['伺服器', 'AI'], goodZone: [54.5,55.5], breakout: 55.8, invalid: 53.8,
    spark: [54.6,54.8,55,55.3,55.1,55.4,55.2]
  },
  {
    symbol: '3162', name: '精確', price: 68.2, changePct: 2.4, high: 69.1, low: 66.9, vwap: 67.8, rvol: 1.11,
    rating: 'B+', state: 'POSITION', nextStep: '等待型態確認', tags: ['汽車零組件'], invalid: 65, target1: 72, target2: 75,
    position: { quantity: 300, averageCost: 66.6, day: 4 }, spark: [66.6,67,67.3,66.9,67.8,68,68.2]
  },
  {
    symbol: '6147', name: '頎邦', price: 72.1, changePct: -0.3, high: 72.8, low: 71.4, vwap: 72.0, rvol: 0.94,
    rating: 'B+', state: 'WATCH', nextStep: '持續觀察反轉條件', tags: ['半導體'], spark: [72.6,72.4,72.2,72.5,72.1]
  }
];
