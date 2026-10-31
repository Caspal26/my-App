-- Durable D1 state shared by short-lived HTTP and scheduled Worker invocations.
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reserve (
  id TEXT PRIMARY KEY, event_key TEXT NOT NULL UNIQUE,
  quote_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0, 1))
);
CREATE TABLE IF NOT EXISTS editions (
  id TEXT PRIMARY KEY, date TEXT NOT NULL UNIQUE, payload TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1))
);
CREATE TABLE IF NOT EXISTS ledger (
  event_key TEXT PRIMARY KEY, edition_id TEXT NOT NULL UNIQUE,
  quote_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint TEXT PRIMARY KEY, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY, edition_id TEXT NOT NULL,
  channel TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT, updated_at TEXT NOT NULL,
  UNIQUE (edition_id, channel, target)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, detail TEXT,
  updated_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (id, payload) VALUES
  (1, '{"deliveryTime":"08:00","timezone":"Africa/Nairobi","whatsappEnabled":false,"whatsappPhone":"","whatsappConsent":false}');
