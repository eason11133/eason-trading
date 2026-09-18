export type StrategyLevel = {
  id: string;
  price: number;
  label: string;
  color: string;
  kind?: 'target'|'breakout'|'invalid'|'cost'|'maxEntry'|'review'|'current'|'other';
};

export function finiteNumbers(values: Array<number | undefined | null>) {
  return values.filter((v): v is number => Number.isFinite(v as number));
}

export function buildStrategyViewport(opts: {
  marketValues: number[];
  coreValues?: number[];
  optionalValues?: number[];
  referencePrice: number;
  optionalReachFactor?: number;
  optionalReachPct?: number;
  minOptionalReach?: number;
  paddingFactor?: number;
  minPaddingPct?: number;
  minPadding?: number;
}) {
  const market = finiteNumbers(opts.marketValues);
  const core = finiteNumbers(opts.coreValues || []);
  const optional = finiteNumbers(opts.optionalValues || []);
  const reference = Number.isFinite(opts.referencePrice) && opts.referencePrice > 0 ? opts.referencePrice : (market[market.length - 1] || 1);

  const marketMin = market.length ? Math.min(...market) : reference;
  const marketMax = market.length ? Math.max(...market) : reference;
  const marketSpan = Math.max(marketMax - marketMin, reference * 0.004, 0.5);

  const seed = market.concat(core, [reference]);
  let baseMin = Math.min(...seed);
  let baseMax = Math.max(...seed);

  const reach = Math.max(
    marketSpan * (opts.optionalReachFactor ?? 0.75),
    reference * (opts.optionalReachPct ?? 0.018),
    opts.minOptionalReach ?? 1.5,
  );
  const includedOptional = optional.filter(v => v >= baseMin - reach && v <= baseMax + reach);
  const all = seed.concat(includedOptional);
  baseMin = Math.min(...all);
  baseMax = Math.max(...all);
  const span = Math.max(baseMax - baseMin, marketSpan);
  const pad = Math.max(
    span * (opts.paddingFactor ?? 0.10),
    reference * (opts.minPaddingPct ?? 0.0035),
    opts.minPadding ?? 0.35,
  );

  return {
    lo: baseMin - pad,
    hi: baseMax + pad,
    includedOptional,
    excludedOptional: optional.filter(v => !includedOptional.includes(v)),
  };
}

export function splitVisibleLevels<T extends { price: number }>(levels: T[], lo: number, hi: number) {
  return {
    visible: levels.filter(l => l.price >= lo && l.price <= hi),
    above: levels.filter(l => l.price > hi).sort((a,b) => a.price - b.price),
    below: levels.filter(l => l.price < lo).sort((a,b) => b.price - a.price),
  };
}

/**
 * Places right-side price labels in a collision-free vertical lane while
 * keeping their order. The actual horizontal strategy line remains at rawY;
 * callers can draw a short leader line from rawY to the returned labelY.
 */
export function layoutLaneLabels(rawYs: number[], height: number, preferredGap = 21, padding = 10) {
  if (!rawYs.length) return [];
  const n = rawYs.length;
  const available = Math.max(1, height - padding * 2);
  const gap = n <= 1 ? preferredGap : Math.min(preferredGap, available / Math.max(1, n - 1));
  const indexed = rawYs.map((y, i) => ({ i, y: Math.max(padding, Math.min(height - padding, y)) })).sort((a,b) => a.y - b.y);
  const placed = indexed.map(x => ({ ...x, placed: x.y }));

  for (let i = 1; i < placed.length; i++) {
    placed[i].placed = Math.max(placed[i].placed, placed[i - 1].placed + gap);
  }
  const overflow = placed[placed.length - 1].placed - (height - padding);
  if (overflow > 0) {
    for (const item of placed) item.placed -= overflow;
  }
  for (let i = placed.length - 2; i >= 0; i--) {
    placed[i].placed = Math.min(placed[i].placed, placed[i + 1].placed - gap);
  }
  const underflow = padding - placed[0].placed;
  if (underflow > 0) {
    for (const item of placed) item.placed += underflow;
  }

  const out = new Array<number>(n);
  for (const item of placed) out[item.i] = Math.max(padding, Math.min(height - padding, item.placed));
  return out;
}

export function formatEdgeSummary(levels: StrategyLevel[], direction: 'above'|'below', maxItems = 3) {
  if (!levels.length) return '';
  const chosen = direction === 'above' ? levels.slice(0, maxItems) : levels.slice(0, maxItems);
  const prefix = direction === 'above' ? '↑' : '↓';
  const body = chosen.map(l => l.label).join(' · ');
  const more = levels.length > chosen.length ? ` · +${levels.length - chosen.length}` : '';
  return `${prefix} ${body}${more}`;
}
