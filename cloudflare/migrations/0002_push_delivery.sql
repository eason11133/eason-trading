-- Reliable push delivery metadata for monitor-only cloud events.
ALTER TABLE monitor_events ADD COLUMN push_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE monitor_events ADD COLUMN push_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE monitor_events ADD COLUMN last_push_error TEXT;
ALTER TABLE monitor_events ADD COLUMN last_push_at TEXT;
CREATE INDEX IF NOT EXISTS idx_monitor_events_push_status ON monitor_events(push_status,created_at);
