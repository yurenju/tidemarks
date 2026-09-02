-- The account is free and the quota is paid (ADR-0011): each account may hold three synced
-- books unless it has no limit at all, and a lapsed subscription freezes the books past the
-- limit rather than deleting them (ADR-0016).
--
-- `book_limit` is the number of live books this account may keep on the server; NULL means no
-- limit. New accounts start at three. Everyone who was let in through the allowlist keeps no
-- limit for good — they came in knowing their data may be wiped before launch, and that trust
-- is worth more than a subscription.
ALTER TABLE users ADD COLUMN book_limit INTEGER DEFAULT 3;
UPDATE users SET book_limit = NULL
  WHERE lower(email) IN (SELECT lower(email) FROM signup_allowlist);

-- When the book was frozen, or NULL while it is live. Nothing writes it yet; the sync push and
-- `/auth/me` already read it so that a frozen book neither takes a slot nor accepts changes.
ALTER TABLE books ADD COLUMN frozen_at INTEGER;
