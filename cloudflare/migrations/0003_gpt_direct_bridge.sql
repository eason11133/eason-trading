-- Direct GPT bridge: disposable read replica + strategy-only command queue.
-- This is NOT a second trading ledger. No cash or executed trades are stored here.
CREATE TABLE IF NOT EXISTS gpt_bridge_state (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  source_version TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gpt_strategy_commands (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  requested_at TEXT NOT NULL,
  applied_at TEXT,
  failed_at TEXT,
  error TEXT,
  result TEXT
);
CREATE INDEX IF NOT EXISTS idx_gpt_strategy_commands_status_requested
  ON gpt_strategy_commands(status, requested_at);
