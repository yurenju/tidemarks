#!/usr/bin/env bash
# Seed local D1 with a fixed test account and a live magic code, so preview verification can
# log in without a passkey and without a mailbox. See docs/agents/verify.md.
#
# It plants a row in `magic_codes` and then lets the real /auth/code/verify spend it — the same
# path a reader walks, minus the inbox. There is no dev-only bypass endpoint.
#
# Re-run any time: each run voids whatever was there and issues a fresh code, which is needed
# because the real endpoint spends a code exactly once.
set -euo pipefail

# Both wrangler calls below need the app's configuration, and it lives in packages/app rather
# than at the root — so this runs from the root wherever it was invoked from, and names the
# config explicitly. Without that, wrangler finds no configuration at all and answers
# "Couldn't find a D1 DB with the name or binding", which reads like the database is missing
# rather than the config.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

USER_ID="preview-user"
EMAIL="preview@tidemarks.test"
# Six digits, like every code the Worker issues. Stored as sha256 of the digits — must match
# worker/auth.ts sha256hex().
CODE="424242"
HASH=$(printf '%s' "$CODE" | sha256sum | cut -d' ' -f1)
# Ten minutes from now, in ms, matching CODE_TTL_MS.
EXPIRES_AT=$(( ($(date +%s) + 600) * 1000 ))

# Ensure the local D1 has tables (idempotent; a fresh worktree's local D1 is empty). Through
# the npm script rather than a second copy of the wrangler command: it already says how a local
# migration is run, and a copy here would be the one that goes stale.
npm run db:migrate:local >/dev/null

# The account is seeded directly rather than created through the code, so that verification
# starts from a shelf that is already there. The allowlist row is what would let the code
# create it, and is seeded too so the same script works against an empty database.
SQL="
INSERT OR IGNORE INTO users (id, email, created_at) VALUES ('$USER_ID', '$EMAIL', 0);
INSERT OR IGNORE INTO signup_allowlist (email, added_at) VALUES ('$EMAIL', 0);
DELETE FROM magic_codes WHERE email = '$EMAIL';
INSERT INTO magic_codes (id, email, code_hash, created_at, expires_at, attempts, consumed_at)
  VALUES ('preview-code', '$EMAIL', '$HASH', 0, $EXPIRES_AT, 0, NULL);
"

# `DB` is the binding, not the database's name. wrangler takes either, but the name is a
# per-deployment value that arrives from a build variable (#8), so naming it here would be one
# more place to remember on the day it changes.
npx wrangler d1 execute DB --local --config packages/app/wrangler.jsonc --command="$SQL"

echo ""
echo "Seeded test account. In the preview browser console, log in with:"
echo "  await fetch('/auth/code/verify', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({email:'$EMAIL', code:'$CODE'})})"
