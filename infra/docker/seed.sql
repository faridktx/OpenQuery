CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS internal_audit_log (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

TRUNCATE TABLE orders, users, internal_audit_log RESTART IDENTITY CASCADE;

INSERT INTO users (email, full_name, is_active)
VALUES
  ('alice@example.com', 'Alice Nguyen', TRUE),
  ('bob@example.com', 'Bob Martinez', TRUE),
  ('carol@example.com', 'Carol Singh', FALSE),
  ('dana@example.com', 'Dana Brown', TRUE);

INSERT INTO orders (user_id, status, total_cents)
VALUES
  (1, 'paid', 1250),
  (1, 'paid', 2450),
  (2, 'pending', 990),
  (2, 'failed', 3150),
  (3, 'paid', 500),
  (4, 'paid', 10750);

INSERT INTO internal_audit_log (action, actor)
VALUES
  ('seed_loaded', 'system');
