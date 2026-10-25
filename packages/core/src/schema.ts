// Idempotent schema. The worker runs this on boot (and `npm run migrate` runs it by hand).
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  wallet TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_terms_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  mint TEXT PRIMARY KEY,
  sym TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  decimals INT NOT NULL DEFAULT 6,
  quote_mint TEXT,
  quote_sym TEXT,
  logo TEXT,
  pool TEXT,
  mcap_usd DOUBLE PRECISION,
  vol24h_usd DOUBLE PRECISION,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_ticks (
  mint TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (mint, ts)
);
CREATE INDEX IF NOT EXISTS price_ticks_ts ON price_ticks (ts);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS pool TEXT;

CREATE TABLE IF NOT EXISTS agents (
  id SERIAL PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES users(wallet),
  name TEXT NOT NULL,
  strat TEXT NOT NULL,
  risk INT NOT NULL DEFAULT 5,
  cadence_mul REAL NOT NULL DEFAULT 1,
  uni TEXT[] NOT NULL,
  color INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'provisioning',
  wallet_id TEXT,
  address TEXT,
  deposited_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  withdrawn_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  equity_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  cash_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  sol_balance DOUBLE PRECISION NOT NULL DEFAULT 0,
  holdings JSONB NOT NULL DEFAULT '{}'::jsonb,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT,
  trades INT NOT NULL DEFAULT 0,
  volume_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  error TEXT,
  last_rebalance_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agents_owner ON agents (owner);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS sim BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS agents_status ON agents (status);
CREATE UNIQUE INDEX IF NOT EXISTS agents_live_name ON agents (upper(name)) WHERE status <> 'retired';

CREATE TABLE IF NOT EXISTS agent_events (
  id BIGSERIAL PRIMARY KEY,
  agent_id INT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  sig TEXT
);
CREATE INDEX IF NOT EXISTS agent_events_agent ON agent_events (agent_id, ts DESC);
CREATE INDEX IF NOT EXISTS agent_events_ts ON agent_events (ts DESC);

CREATE TABLE IF NOT EXISTS agent_equity (
  agent_id INT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  equity DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (agent_id, ts)
);

CREATE TABLE IF NOT EXISTS deposits (
  sig TEXT PRIMARY KEY,
  agent_id INT NOT NULL REFERENCES agents(id),
  wallet TEXT NOT NULL,
  usdc DOUBLE PRECISION NOT NULL DEFAULT 0,
  sol DOUBLE PRECISION NOT NULL DEFAULT 0,
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id SERIAL PRIMARY KEY,
  agent_id INT NOT NULL REFERENCES agents(id),
  to_wallet TEXT NOT NULL,
  usdc DOUBLE PRECISION NOT NULL DEFAULT 0,
  sol DOUBLE PRECISION NOT NULL DEFAULT 0,
  sigs TEXT[] NOT NULL DEFAULT '{}',
  ts TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
