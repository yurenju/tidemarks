# Deploying Folis to Cloudflare

Folis is a monorepo (ADR-0018) and the deployable half is `packages/app`. Every
command below is run from the **root**, which is where the npm scripts that
delegate into that package live; the only paths that change if you go looking
are `wrangler.jsonc` and `migrations/`, both of which sit in `packages/app/`.

Folis runs as a single Cloudflare Worker that serves the PWA (static assets),
the auth endpoints (`/auth/*`), and the sync API (`/api/*`). Storage is
**D1** (structured data) and **R2** (epub files and covers), plus a small **KV**
namespace holding OAuth grants for the read-only MCP server.

An account is an email address with two ways in: a passkey, and a six-digit code
mailed to that address. Mail needs a provider, or it goes to the log — see
step 4.

Everything lives under one hostname. Pick it carefully: the WebAuthn **RP ID is
permanently locked to that hostname** once the first passkey is registered.
Changing it later invalidates every passkey. A dedicated subdomain
(e.g. `folis.example.com`) is recommended over an apex domain so passkeys are
scoped to this app only.

## Prerequisites

- A Cloudflare account
- Your domain's zone active on that Cloudflare account (needed for the custom domain)
- Node.js and `npm install` done at the root of the repo (one lockfile covers every package)
- `npx wrangler login` (or an API token) for the one-time provisioning steps

## 1. Configure `packages/app/wrangler.jsonc`

**That file ships with none of these values filled in**, and that is deliberate:
it is the self-hosting default, and this repository is public. An id belonging to
somebody else's account would make the file useless to you and would put your
edits on the same lines upstream keeps changing, so every `git pull` would
conflict. See *The official deployment* at the end of this document for where
the official instance's own values live instead.

So there is nothing to overwrite here — only blanks to fill:

| Field | Value |
|---|---|
| `d1_databases[0].database_id` | from step 2 |
| `kv_namespaces[0].id` | from step 2 |
| `vars.RP_ID` | your hostname, e.g. `folis.example.com`. **Permanently locked once the first passkey is registered** — changing it invalidates every passkey |
| `vars.ORIGIN` | `https://` + the same hostname |
| `vars.MAIL_FROM` | the sender of magic-code mail, on a domain Resend has verified — **not necessarily the hostname above**. See step 4. Leave it out to keep the zero-vendor path |
| `routes` | absent, and fine to leave absent — see step 6 |

The `vars` block does not exist in the file at all; add one. A placeholder would
be worse than a blank, because two of those three fail silently: a deployment
carrying somebody else's `RP_ID` deploys cleanly and cannot be logged into, and
one with an unverified `MAIL_FROM` deploys cleanly and mails nothing.

`vars.OPEN_SIGNUP` is deliberately absent. Without it, only addresses listed in the
`signup_allowlist` table can create an account; adding `"OPEN_SIGNUP": "true"` lets
anyone. See step 5.

## 2. Create the storage resources (one-time)

```sh
# D1 database — copy the returned database_id into wrangler.jsonc
npx wrangler d1 create tidemarks   # any name; this is wrangler.jsonc's default

# R2 bucket (never public; the Worker streams objects after an auth check)
npx wrangler r2 bucket create tidemarks

# KV namespace for the MCP server's OAuth grants — copy the returned id into wrangler.jsonc
npx wrangler kv namespace create OAUTH_KV

# create the tables
npm run db:migrate     # = wrangler d1 migrations apply DB --remote
```

The KV namespace belongs on this list even though wrangler offers to provision it
for you. Leaving its binding without an `id` makes wrangler create the namespace
on the first deploy and write the id back into `wrangler.jsonc` — which works from
a laptop and does not work from Workers Builds, because the build environment
cannot commit to the repo. The id is then lost and every later deploy tries to
create the namespace again, failing with "already exists" (code 10014). The full
account is in the comment above that binding.

`DB` there is the binding name rather than the database's name — `d1 migrations
apply` accepts either, and a binding means renaming your database does not mean
editing a script.

`db:migrate` runs everything in `packages/app/migrations/` that this database
has not seen,
and records what it applied in a `d1_migrations` table. It is safe to re-run —
that is the point of the record — and `npm run deploy` runs it for you before
uploading the Worker. Adding a column means adding a file there; editing an
existing migration means editing something the database already believes it has
run.

## 3. Set secrets (one-time)

```sh
# nobody needs to know this one, so generate it rather than choosing it
openssl rand -hex 32 | npx wrangler secret put COOKIE_SECRET
```

Secrets attach to the Worker, so the Worker must exist first: either run the
first deploy (step 6) before this, or pass `--name <your worker>` and let
wrangler create a draft.

- `COOKIE_SECRET`: any long random string. Rotating it only invalidates
  in-flight login ceremonies, not sessions. **It is required**: a Worker without
  it deploys successfully and then nobody can log in, so this is not a step to
  come back to later.
- `RESEND_API_KEY`: optional, and covered in step 4.

## 4. Sending magic codes

An account is named by an email address, and a six-digit code mailed to that
address is one of the two ways in (the other is a passkey). So something has to
send mail.

**Without a key nothing is sent and the code goes to the log**, where
`npx wrangler tail` shows it. That is the whole self-hosting path: a Folis you
run for yourself needs no vendor, no verified domain and no DNS. It is also how
login gets tested by hand — see `docs/agents/verify.md`.

For a Folis other people log into, that is not good enough, and the vendor is
[Resend](https://resend.com):

1. Add your domain in the Resend dashboard and publish the DNS records it asks
   for (SPF, DKIM, and the return-path CNAME). Cloudflare-hosted zones can do
   this from the same dashboard.
2. Wait for the domain to verify. Until it does, Resend refuses every message
   and **nobody can log in**.
3. Set `vars.MAIL_FROM` (step 1) to an address **on the domain you just
   verified**. This is the step that gets skipped, because nothing complains
   until a reader tries to log in. The
   sending domain has nothing to do with the hostname Folis is served from —
   they are two independent choices, and Resend only knows about the one you
   verified with it. Send from a domain it has not verified and every request
   for a code fails with 403, which reads to the reader as「寄不出登入碼」.
4. Set the key:

   ```sh
   npx wrangler secret put RESEND_API_KEY
   ```

Setting the key with no `MAIL_FROM` is refused loudly rather than falling back
to the log — a deployment that believes it is sending mail must not quietly
print magic codes where its logs can be read.

When a send does fail, the reason is in the Worker's log, spelled out: the
status Resend answered with and the body it sent back. Read that before
guessing; the two failures that look identical from the browser (unverified
domain, bad key) are one line apart there.

Resend is the only vendor Folis talks to, and if it is down nobody who has lost
their session can get in. Sessions last 90 days, which is the whole of the
cushion; there is no second provider (see
[ADR-0015](adr/0015-an-account-is-only-as-strong-as-its-inbox.md)).

## 5. Who may create an account

While `vars.OPEN_SIGNUP` is absent, an address can only create an account if it
is in the `signup_allowlist` table. Existing accounts are unaffected: the gate
stands at account creation, so removing a row does not lock anybody out of data
that is already theirs.

```sh
npx wrangler d1 execute DB --remote \
  --command "INSERT INTO signup_allowlist (email, added_at) VALUES ('reader@example.com', unixepoch() * 1000)"
```

Opening signup to everyone is a change to `wrangler.jsonc` and a deploy, on
purpose — for Folis itself that edit *is* the launch line
([ADR-0004](adr/0004-development-phase-and-launch-line.md)), and it should leave
a commit behind. Adding one person should not need a deploy, which is why the
list is in the database and the switch is not.

## 6. First deploy

```sh
npm run deploy          # = build, then apply migrations, then wrangler deploy
```

**Without a `routes` entry the Worker is served from
`<name>.workers.dev`**, which is the point: a fresh deployment works before you
have bought a domain. If you do add one — `{"pattern": "…", "custom_domain":
true}` — `wrangler deploy` provisions the DNS record and certificate for you, as
long as that zone is on your account.

⚠️ Decide this before the first passkey, not after. `vars.RP_ID` has to match
whichever hostname you settle on, and it cannot be changed later without
invalidating every passkey already registered.

Then put your own address in `signup_allowlist` (step 5), open the site, ask for
a magic code, and read it from `npx wrangler tail` if you have not set up Resend.
Once you are in, add a passkey from the account panel — it is the fast door, and
the mailed code stays as the one that always works.

If you are upgrading a Folis that predates migration `0003`, that migration
parks each existing user's own id in their new `email` column, because a real
address does not belong in a file that goes public. Nobody can log in to such an
account until you put the address in:

```sh
npx wrangler d1 execute DB --remote \
  --command "UPDATE users SET email = 'you@example.com' WHERE id = '<the id it is holding>'"
```

## 7. Continuous deploys (Workers Builds)

Day-to-day deploys should come from CI, not a laptop. Folis uses
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/):
Cloudflare watches the GitHub repo and builds/deploys on push.

Setup is a dashboard flow (Cloudflare dashboard → Workers & Pages → your
worker → Settings → Builds → Connect). The Builds API exists, but creating a
build configuration requires a *build token* (an API token the build runner
deploys with), and minting that token needs user-level API permissions that
dashboard sessions have and most scoped tokens don't — so in practice the
dashboard is the way. It's a one-time step:

1. Connect your GitHub account/repo (installs Cloudflare's GitHub App if you
   haven't already).
2. Build configuration:
   - Build command: `npm run build`
   - Deploy command: `npm run deploy:ci`
   - Root directory: `/`

   **Every command in this form has to be an npm script at the root, never a
   tool invoked directly.** The root's `package.json` forwards them into
   `packages/app` (building the renderer first), so moving a package between
   directories does not require somebody to remember to edit a form in a
   dashboard. A command that names `wrangler` instead resolves against the
   repository root, where there is no `wrangler.jsonc` — and it announces that
   only as a failed deploy after the merge. That is exactly how the preview
   command below broke when the app moved into `packages/`.
3. Recommended triggers (mirrors the default dashboard setup):
   - `main` branch → build + `npm run deploy:ci` (production)
   - all other branches → build + `npm run versions:upload` (preview versions,
     no production traffic). **Not `npx wrangler versions upload`**, for the
     reason above.

The build token Cloudflare mints for this already covers everything a deploy
here does, D1 included — see below if a build ever fails on permissions.

Secrets set in step 3 live on the Worker and survive deploys; the build
environment does not need them.

### Migrations run from the deploy command, and only on `main`

`wrangler deploy` does not apply migrations, so something else has to.
`deploy:ci` is `node scripts/deploy.ts production`, which applies migrations and
then deploys. Leave the migration out and a push that adds a column deploys a
Worker reading a column the database has not got — which fails on the first
request, not at deploy time.

**It is an npm script, not a command typed into the dashboard**, so the steps and
their order live in this repo where they can be read and reviewed. The dashboard
holds `npm run deploy:ci` and never needs editing again.
[Cloudflare's configuration docs](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
give `npm run deploy` as an example deploy command; whether the dashboard
accepts a chained `a && b` is not documented, which is a second reason not to put
one there.

**Only the production trigger runs migrations.** A branch build must not: it
would apply that branch's migration to the production database before anyone
merged it, and there is no undo. Preview versions share production's D1 and are
therefore one migration behind until their branch lands — which is the right way
round. `scripts/deploy.ts` is one file covering both modes so that this rule is
an `if` somebody can read, rather than a line the other script happens to lack.

`npm run deploy` is the same thing with a build in front, for a laptop.

### What the build token has to be able to do

Workers Builds mints its own API token, and a deploy here needs it to cover:

| Step | Permission |
| --- | --- |
| `d1 migrations apply --remote` | D1 Edit |
| upload the Worker and its assets | Workers Scripts Edit |
| create `OAUTH_KV` on the first deploy | Workers KV Storage Edit |
| bind the R2 bucket | Workers R2 Storage Edit |
| keep the custom domain and its certificate | Workers Routes Edit, SSL and Certificates Edit (zone) |

**A token minted by Workers Builds already carries all of these** — checked
against a real one in August 2026, which also held a long tail of scopes for
products this Worker does not use (Vectorize, Hyperdrive, Cloudchamber, Browser
Run…), the signature of an automatically generated token rather than a
hand-picked one. So nothing normally needs adding.

Do not take that from
[the documented list](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/),
which is shorter than what the dashboard actually mints and omits D1 entirely.
Read the token if a build fails on permissions.

The failure mode is at least the safe one: the migration step errors and the
Worker is never uploaded. Recognise it by sight, because
[migrations in CI have a history of failing with little output](https://github.com/cloudflare/wrangler-action/issues/221).

`wrangler d1 migrations apply` prompts for confirmation; in a non-interactive
runner it answers itself with yes.

### Why not a GitHub Actions job

Cloudflare's own answer for external CI is
[`cloudflare/wrangler-action`](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/),
and running `d1 migrations apply --remote` as a step of it is the usual
community shape. It would be more visible than a dashboard setting.

It is not used here because Workers Builds is already connected: both fire on
the same push with no ordering between them, so a migration could land after the
Worker it was for — the failure this whole section exists to prevent. One deploy
path, or none. If Workers Builds is ever dropped, that action is the way back.

Cloudflare documents neither shape: the
[D1 migrations reference](https://developers.cloudflare.com/d1/reference/migrations/)
covers mechanics and says nothing about deployment order, and the GitHub Actions
example deploys a Worker without touching a database. This section is a decision,
not a recipe being followed.

## Local development

Two processes: the Vite dev server (frontend) and `wrangler dev` (API).
Vite proxies `/api` and `/auth` to wrangler on port 5002.

```sh
# one-time: local D1 tables (re-run after pulling new migrations)
npm run db:migrate:local

# one-time: local secrets/vars
cat > .dev.vars <<'EOF'
RP_ID=localhost
ORIGIN=http://localhost:5001
COOKIE_SECRET=dev-cookie-secret
EOF

npm run worker:dev      # terminal 1: API on :5002
npm run dev             # terminal 2: app on :5001
```

`RP_ID=localhost` lets you register/use real passkeys against
`http://localhost:5001` (browsers treat localhost as a secure context).
Local D1/R2 state lives under `.wrangler/` (gitignored).

No `RESEND_API_KEY` here, so magic codes are printed by `wrangler dev` in the
terminal it is running in. Put your address in the local `signup_allowlist`
first, or the code is never issued:

```sh
npx wrangler d1 execute DB --local \
  --command "INSERT INTO signup_allowlist (email, added_at) VALUES ('you@example.com', 0)"
```

## The official deployment

Everything above describes deploying your own. The tidemarks.io deployment runs
the same code from the same repository, and differs in exactly one way: **its
account-specific values are not in the repository at all.**

They are Workers Builds *build variables*, and `scripts/deploy.ts` merges them
into `packages/app/wrangler.jsonc` at build time, writing
`packages/app/wrangler.generated.json` and pointing both wrangler commands at it
with `--config`. Nine variables, all required:

```
CF_WORKER_NAME  CF_D1_NAME  CF_D1_ID  CF_R2_BUCKET  CF_KV_ID
CF_ROUTE  CF_RP_ID  CF_ORIGIN  CF_MAIL_FROM
```

**The generator reads the repo's config rather than writing one from scratch**,
so that a change to something shared — a new path in `assets.run_worker_first`,
say — reaches production without anybody remembering that a second file exists.
It only overwrites the fields listed above.

**A missing variable stops the build.** It deliberately does not fall back to
`wrangler.jsonc`: that file carries no ids, so wrangler would provision a
*second* set of resources and every later deploy would fail with "already
exists" (code 10014) — the failure described in step 2, arrived at from the
other direction.

Build variables are readable during the build and not at runtime, which suits
them: they exist to write a configuration file, not to be read by the Worker.
The two values the Worker does read at runtime, `COOKIE_SECRET` and
`RESEND_API_KEY`, are still `wrangler secret` (step 3) and have nothing to do
with this.

Three things about this were checked against wrangler 4.124 rather than inferred,
and are the reason the generator exists at all:

- Wrangler does not interpolate `${VAR}` inside a configuration file.
- `wrangler deploy` has no flag that overrides a D1 `database_id`, an R2
  `bucket_name` or a KV `id`.
- `d1 migrations apply` is **not** one of the commands that pick up
  `.wrangler/deploy/config.json`, so it has to be passed `--config` explicitly.
  Without it, migrations are applied to whatever database `wrangler.jsonc`
  names — and it does not fail.

Paths inside a wrangler config resolve relative to the config file, which is why
the generated one is written next to the original in `packages/app/` rather than
somewhere tidier. It is gitignored.

## Operational notes

- **Backups**: D1 has point-in-time recovery (Time Travel); R2 objects are
  only ever added or orphaned, never mutated. The in-app「完整匯出」(full
  export) also produces a self-contained JSON backup.
- **Deleting a book** tombstones the row; the R2 object is not garbage
  collected (files are ~5 MB; revisit if storage ever matters).
- **Sessions** last 90 days. Losing every passkey is not losing the account:
  a mailed magic code gets you back in, and a new passkey is added from the
  account panel. Losing the inbox is another matter — the account is exactly as
  strong as it is.
- **Magic codes** live 10 minutes, survive five wrong guesses, and are spent on
  first use. Asking for a new one voids the last. Rows in `magic_codes` are
  cleaned up as new codes are issued for the same address.
