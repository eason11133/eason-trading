import fs from 'node:fs';

const [, , basePath, currentPath, outPath] = process.argv;
if (!basePath || !currentPath || !outPath) {
  console.error('Usage: node merge-rollback-state.mjs <old-base-state> <current-state> <output-state>');
  process.exit(2);
}

function readJson(p, label) {
  const x = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error(`${label} state is not an object`);
  if (!Array.isArray(x.positions) || !Array.isArray(x.trades) || !x.metadata || typeof x.metadata !== 'object') {
    throw new Error(`${label} state is missing ledger fields`);
  }
  return x;
}

const base = readJson(basePath, 'old-base');
const current = readJson(currentPath, 'current');

// Only carry durable/user-authored data that the old schema already knows about.
// Market quotes are intentionally excluded so the old runtime hydrates fresh data.
const durableKeys = [
  'settings', 'portfolio', 'positions', 'watchlist', 'playbooks', 'trades',
  'alerts', 'reviews', 'devices', 'disclosureSeen', 'volumeBaselines',
  'reviewTriggers', 'triggerEvents', 'triggerSnapshots', 'setups', 'setupEvents',
  'hypotheses', 'closePackages', 'handoffs', 'audit'
];
for (const key of durableKeys) {
  if (Object.prototype.hasOwnProperty.call(base, key) && Object.prototype.hasOwnProperty.call(current, key)) {
    base[key] = current[key];
  }
}
base.metadata = { ...base.metadata, ...current.metadata };
if (Object.prototype.hasOwnProperty.call(base, 'market')) base.market = {};

fs.writeFileSync(outPath, JSON.stringify(base, null, 2) + '\n');
console.log(JSON.stringify({
  ok: true,
  positions: base.positions.length,
  trades: base.trades.length,
  cash: base.portfolio?.cash ?? null,
  marketCleared: Object.keys(base.market || {}).length === 0,
  topLevelKeys: Object.keys(base).length
}));
