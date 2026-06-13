-- Crypto Price Alert Bot — persistence schema (production / SQLite).
-- See docs/details.md §2. The harness default is the in-memory repository in
-- repository.ts; this schema is the canonical shape a SQLite-backed adapter
-- implements.

CREATE TABLE IF NOT EXISTS users (
  telegram_id INTEGER PRIMARY KEY,
  created_at  TEXT NOT NULL
);

-- Seeded with the only two supported assets; never extended at runtime.
CREATE TABLE IF NOT EXISTS cryptos (
  symbol       TEXT PRIMARY KEY,           -- 'BTC' | 'TON'
  coingecko_id TEXT NOT NULL               -- 'bitcoin' | 'the-open-network'
);

CREATE TABLE IF NOT EXISTS user_alerts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_telegram_id     INTEGER NOT NULL REFERENCES users(telegram_id),
  crypto_symbol        TEXT    NOT NULL REFERENCES cryptos(symbol),
  threshold_pct        REAL    NOT NULL,
  last_monitored_price REAL,
  enabled              INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT    NOT NULL,
  UNIQUE (user_telegram_id, crypto_symbol)
);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  crypto_symbol  TEXT NOT NULL REFERENCES cryptos(symbol),
  price          REAL NOT NULL,
  change_24h_pct REAL NOT NULL,
  captured_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_alerts_user ON user_alerts (user_telegram_id);
CREATE INDEX IF NOT EXISTS idx_user_alerts_enabled ON user_alerts (enabled);
CREATE INDEX IF NOT EXISTS idx_snapshots_symbol ON price_snapshots (crypto_symbol, captured_at);

-- Seed rows (idempotent):
INSERT OR IGNORE INTO cryptos (symbol, coingecko_id) VALUES ('BTC', 'bitcoin');
INSERT OR IGNORE INTO cryptos (symbol, coingecko_id) VALUES ('TON', 'the-open-network');
