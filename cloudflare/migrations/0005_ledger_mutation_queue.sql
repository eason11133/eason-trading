-- Durable transport queue only. Authoritative Ledger data never belongs in D1.
CREATE TABLE IF NOT EXISTS ledger_devices (
  device_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_mutations (
  mutation_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  client_sequence INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  mutation_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','rejected')),
  created_at TEXT NOT NULL,
  applied_at TEXT,
  apply_result TEXT,
  rejection_reason TEXT,
  UNIQUE(device_id,idempotency_key),
  UNIQUE(device_id,client_sequence)
);
CREATE INDEX IF NOT EXISTS idx_ledger_mutations_pending
  ON ledger_mutations(status,created_at,device_id,client_sequence,mutation_id);
CREATE INDEX IF NOT EXISTS idx_ledger_mutations_device
  ON ledger_mutations(device_id,created_at DESC);
