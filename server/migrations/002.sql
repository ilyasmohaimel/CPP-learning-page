-- Preserve legacy IDs, sessions and child-table references while allowing accounts.
-- Store runs this table rebuild with foreign keys disabled before its transaction,
-- and validates all foreign keys before commit, following SQLite's documented
-- generalized ALTER TABLE procedure.
CREATE TABLE owner_next (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'learner' CHECK(role IN ('admin','learner'))
);
INSERT INTO owner_next(id,username,password_hash,created_at,role)
  SELECT id,username,password_hash,created_at,'admin' FROM owner;
DROP TABLE owner;
ALTER TABLE owner_next RENAME TO owner;
CREATE TABLE auth_rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_rate_expiry ON auth_rate_limits(expires_at);
CREATE INDEX account_jobs ON jobs(owner_id,created_at,state);
CREATE TABLE import_receipts (
  owner_id TEXT NOT NULL REFERENCES owner(id),
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  stored_id TEXT NOT NULL,
  PRIMARY KEY(owner_id,kind,source_id)
);
