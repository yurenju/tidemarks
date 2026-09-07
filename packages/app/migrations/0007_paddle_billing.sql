-- Paddle becomes the source of truth for the quota, and D1 keeps a mirror (CONTEXT.md, on
-- subscriptions). Two columns for the two things a webhook needs to remember between calls.
--
-- `provider_customer_id` is Paddle's id for this account's customer record. Its only use is
-- opening the customer portal, which is where cancelling and the invoices live; it is written
-- by the webhook rather than by checkout, because that is the first message that carries it.
ALTER TABLE users ADD COLUMN provider_customer_id TEXT;

-- When the newest subscription event this account has acted on happened, as Paddle stamped it.
-- Paddle does not promise webhooks arrive in order, so an event older than this one is dropped:
-- without it a `canceled` delivered late would undo an `active` that already went through.
ALTER TABLE users ADD COLUMN billing_event_at INTEGER;

-- Everybody goes back to three books, and the maintainer subscribes like anybody else.
--
-- Until now "no limit" had two sources: an account made before signups opened, and a hand-edited
-- row. Both were stand-ins for a checkout that did not exist. It exists now, so the stand-ins go
-- — including the allowlist rule migration 0006 wrote, which stops being a launch-time exception
-- and becomes the self-hosting switch instead: a deployment with no Paddle configured hands every
-- new account no limit at all (worker/auth.ts).
UPDATE users SET book_limit = 3;

-- And the books past three are frozen here, in the same migration, so that an account at three
-- books looks the same however it got there. Setting the number alone would leave an account
-- holding fifty synced books against a limit of three: nothing broken, but a state no other path
-- can produce, and one the account pane would report as "50 of 3 books sync".
--
-- ⚠️ **This is worker/quota.ts's `booksToFreeze` written again in SQL, and the two have to agree**:
-- of the live books, keep the three most recently read — a book nobody opened counts as read when
-- it was added — and freeze the rest, ties broken by id. Nothing is deleted; the server keeps a
-- frozen book and subscribing thaws it (ADR-0016).
UPDATE books SET frozen_at = unixepoch() * 1000
WHERE deleted_at IS NULL
  AND frozen_at IS NULL
  AND id NOT IN (
    SELECT keeper.id FROM books keeper
    LEFT JOIN progress ON progress.user_id = keeper.user_id AND progress.book_id = keeper.id
    WHERE keeper.user_id = books.user_id AND keeper.deleted_at IS NULL
    ORDER BY COALESCE(progress.last_read_at, keeper.added_at) DESC, keeper.id ASC
    LIMIT 3
  );
