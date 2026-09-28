CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at TEXT NOT NULL
);

CREATE TABLE login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL
);

CREATE TABLE auth_requests (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX auth_requests_email_time ON auth_requests(email, created_at);
CREATE INDEX auth_requests_ip_time ON auth_requests(ip_hash, created_at);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  product_name TEXT NOT NULL,
  amazon_url TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  fee INTEGER NOT NULL CHECK (fee >= 0),
  total INTEGER NOT NULL CHECK (total > 0),
  payment_due TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '依頼受付' CHECK (status IN ('依頼受付','支払い待ち','支払い済み','注文済み','発送待ち','発送済み','到着','受け渡し完了')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX orders_user_created ON orders(user_id, created_at DESC);
CREATE INDEX orders_created ON orders(created_at DESC);

CREATE TABLE status_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  changed_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX status_events_order_time ON status_events(order_id, created_at);
