-- Login becomes two parallel keys: the passkey it already had, and a magic code sent to an
-- email address. See docs/adr/0015-an-account-is-only-as-strong-as-its-inbox.md.
--
-- `credentials` is untouched on purpose: user ids do not change, so every passkey already
-- registered keeps working.

-- SQLite cannot add a NOT NULL column without a default, so the table is rebuilt. The existing
-- row is carried over with its own id standing in for the address, and the real one is filled
-- in by hand after the deploy (`wrangler d1 execute`) — an address is a person, and this file
-- goes public the day the repo does.
--
-- A user id is not a valid email, so the placeholder is inert: /auth/code/request rejects the
-- shape before it ever reaches a lookup. Whoever is holding that row cannot log in until the
-- UPDATE is run, which is the loud failure rather than the quiet one.
CREATE TABLE users_with_email (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
INSERT INTO users_with_email (id, email, created_at) SELECT id, id, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_with_email RENAME TO users;

-- Recovery codes are gone; the magic code carries all three jobs they had.
DROP TABLE IF EXISTS recovery_codes;

-- Issued magic codes. Server-side state, not a cookie: "single use" and "how many tries left"
-- are the whole security of a six-digit number, and a cookie is the attacker's to replay.
--
-- Rows are kept after they are spent because they are also the send-rate record: `created_at`
-- is what "one per minute, five per hour" counts.
CREATE TABLE magic_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER
);
CREATE INDEX idx_magic_codes_email ON magic_codes(email);

-- Who may create an account while signup is closed. Maintained by hand
-- (`wrangler d1 execute`); adding a friend should not need a deploy.
CREATE TABLE signup_allowlist (
  email TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
);
