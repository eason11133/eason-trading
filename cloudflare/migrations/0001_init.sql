-- Eason Trading cloud monitor: monitor-only state.
-- No portfolio, cash, positions, trades or demo market data belong here.
CREATE TABLE IF NOT EXISTS monitor_targets (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  name TEXT,
  label TEXT NOT NULL,
  conditions TEXT NOT NULL,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'ARMED',
  playbook_version INTEGER,
  expires_at TEXT,
  synced_at TEXT NOT NULL,
  fired_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_monitor_targets_symbol_status ON monitor_targets(symbol,status);

CREATE TABLE IF NOT EXISTS monitor_events (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  label TEXT NOT NULL,
  reasons TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  context TEXT,
  access_token TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_monitor_events_status ON monitor_events(review_status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_monitor_events_access_token ON monitor_events(access_token);

CREATE TABLE IF NOT EXISTS devices (
  token TEXT PRIMARY KEY,
  platform TEXT,
  stock_chat_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
