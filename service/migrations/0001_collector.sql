-- Public collector data only. No user profiles, credentials or signing keys.
CREATE TABLE IF NOT EXISTS nil_seen (id TEXT PRIMARY KEY NOT NULL CHECK(length(id) = 64));
CREATE TABLE IF NOT EXISTS nil_totals (singleton INTEGER PRIMARY KEY CHECK(singleton=1), total INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO nil_totals(singleton,total) SELECT 1,count(*) FROM nil_seen;
CREATE TRIGGER IF NOT EXISTS nil_seen_count AFTER INSERT ON nil_seen BEGIN UPDATE nil_totals SET total=total+1 WHERE singleton=1; END;
CREATE TABLE IF NOT EXISTS nil_configs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  record TEXT NOT NULL CHECK(json_valid(record)),
  first_seen TEXT NOT NULL,
  run_id TEXT
);
CREATE INDEX IF NOT EXISTS nil_configs_recent ON nil_configs(first_seen DESC, seq DESC);
CREATE INDEX IF NOT EXISTS nil_configs_run ON nil_configs(run_id);
CREATE TABLE IF NOT EXISTS nil_runs (
  id TEXT PRIMARY KEY NOT NULL,
  report TEXT NOT NULL CHECK(json_valid(report)),
  started_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS nil_runs_recent ON nil_runs(started_at DESC);
CREATE TABLE IF NOT EXISTS nil_state (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL CHECK(json_valid(value))
);
CREATE TABLE IF NOT EXISTS nil_locks (
  name TEXT PRIMARY KEY NOT NULL,
  owner TEXT,
  expires_at INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO nil_locks(name) VALUES ('bootstrap'), ('collect');
