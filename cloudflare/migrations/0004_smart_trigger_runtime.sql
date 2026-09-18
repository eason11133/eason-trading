-- Runtime state for deterministic smart-trigger parity with the local backend.
-- This is monitor-only state; it contains no cash, positions, trades, or Ledger data.
ALTER TABLE monitor_targets ADD COLUMN runtime TEXT NOT NULL DEFAULT '{}';
