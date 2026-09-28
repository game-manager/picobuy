CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  issuer_name TEXT NOT NULL,
  issuer_address TEXT NOT NULL,
  issuer_contact TEXT NOT NULL,
  issuer_tax_details TEXT NOT NULL,
  payment_instructions TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  product_name TEXT NOT NULL,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  payment_due TEXT NOT NULL,
  notes TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  issued_by TEXT NOT NULL REFERENCES users(id)
);
