# Deploying Folis to Cloudflare

Folis is a monorepo (ADR-0018) and the deployable half is `packages/app`, which
is where `wrangler.jsonc` and `migrations/` live. Any npm script named below is
run from the **root**; the `wrangler` commands here are one-off provisioning and
run from wherever you like.

Folis runs as a single Cloudflare Worker that serves the PWA (static assets),
the auth endpoints (`/auth/*`), and the sync API (`/api/*`). Storage is
**D1** (structured data) and **R2** (epub files and covers), plus a small **KV**
namespace holding OAuth grants for the read-only MCP server.

An account is an email address with two ways in: a passkey, and a six-digit code
mailed to that address. Mail needs a provider, or it goes to the log — see
step 4.

Everything lives under one hostname, and it is the one decision here that cannot
be taken back later — see *Deciding the hostname first* below.

## Prerequisites

- A Cloudflare account
- `npx wrangler login` (or an API token) for the one-time provisioning steps
- A hostname whose zone is on that account — **optional**, see step 5
- Node.js and `npm install` at the root of the repo, if you want to run it
  locally as well (one lockfile covers every package)

## How a deployment is configured

**Nothing account-specific is in this repository, and you should not put yours
there either.** `packages/app/wrangler.jsonc` holds only what is true of every
deployment; the database id, the bucket name, the hostname and the sender
address are supplied as **Workers Builds build variables**, in whichever
Cloudflare account is doing the building. At build time
`scripts/deploy.ts` merges them into that file and writes
`packages/app/wrangler.generated.json`, which is what wrangler is actually given.

This is the same for the official deployment and for yours. There is no
separate path, and **no deploying from a laptop**: the build environment is the
only place that holds the values, which is the point — a deploy is a thing that
happened on a branch, not a thing somebody did on a Tuesday.

Editing `wrangler.jsonc` to hold your own ids would work, and is still the wrong
move: upstream keeps changing those lines, so on a fork of a public repository
every `git pull` would conflict there. Build variables cost one dashboard form,
once.

The variables:

| Variable | | Value |
|---|---|---|
| `CF_WORKER_NAME` | required | the Worker's name, e.g. `tidemarks` |
| `CF_D1_NAME` | required | D1 database name (step 2) |
| `CF_D1_ID` | required | D1 `database_id` (step 2) |
| `CF_R2_BUCKET` | required | R2 bucket name (step 2) |
| `CF_KV_ID` | required | KV namespace id (step 2) |
| `CF_RP_ID` | required | the hostname passkeys are scoped to. **Permanently locked once the first passkey is registered** — changing it invalidates every passkey |
| `CF_ORIGIN` | required | `https://` + that hostname |
| `CF_ROUTE` | optional | a custom domain. Leave it unset and the Worker answers on `<CF_WORKER_NAME>.<your-subdomain>.workers.dev` |
| `CF_MAIL_FROM` | optional | sender of magic-code mail, on a domain Resend has verified. Leave it unset for the zero-vendor path — see step 4 |

**A missing required variable stops the build**, on purpose. It deliberately
does not fall back to `wrangler.jsonc`, which carries no ids: wrangler would
provision a *second* set of resources, and because a build environment cannot
commit the ids back to the repository they would be lost — every later deploy
then tries to create them again and fails with "already exists" (code 10014).
This project has been there.

Build variables are readable during the build and **not** at runtime, which
suits them: they exist to write a configuration file, not to be read by the
Worker. The two values the Worker does read at runtime, `COOKIE_SECRET` and
`RESEND_API_KEY`, are secrets on the Worker instead — step 3.

### Deciding the hostname first

`CF_RP_ID` has to be set before the first deploy, and cannot be changed
afterwards without invalidating every passkey. So decide now, not later:

- **With a custom domain**: a dedicated subdomain (`folis.example.com`) rather
  than an apex, so passkeys are scoped to this app only. Its zone must be on
  your Cloudflare account. Set `CF_ROUTE` and `CF_RP_ID` to it.
- **Without one**: your Worker's address is
  `<CF_WORKER_NAME>.<your-subdomain>.workers.dev`, and your subdomain is shown
  in the dashboard under Workers & Pages → Overview before you deploy anything.
  Set `CF_RP_ID` to that whole hostname, leave `CF_ROUTE` unset.

## 1. Create the storage resources (one-time)

```sh
# D1 database — note the returned database_id, it becomes CF_D1_ID
npx wrangler d1 create tidemarks

# R2 bucket (never public; the Worker streams objects after an auth check)
npx wrangler r2 bucket create tidemarks

# KV namespace for the MCP server's OAuth grants — note the returned id, it becomes CF_KV_ID
npx wrangler kv namespace create OAUTH_KV
```

The names are yours to choose; they go into `CF_D1_NAME` and `CF_R2_BUCKET`.

**No tables are created here.** Migrations are applied by the deploy (step 6),
which is the order that matters: `wrangler d1 migrations apply` runs everything
in `packages/app/migrations/` that this database has not seen and records what it
applied in a `d1_migrations` table, so it is safe to re-run — that is the point of
the record. Adding a column means adding a file there; editing an existing
migration means editing something the database already believes it has run.

The KV namespace belongs on this list even though wrangler offers to provision
it for you, for the 10014 reason above.

## 2. Create the Worker

In the dashboard, Workers & Pages → Create → Worker, named whatever you put in
`CF_WORKER_NAME`. It will serve a placeholder until step 6 replaces it.

This exists before the code does because **secrets attach to a Worker**, and the
next step needs somewhere to attach them.

## 3. Set secrets (one-time)

```sh
# nobody needs to know this one, so generate it rather than choosing it
openssl rand -hex 32 | npx wrangler secret put COOKIE_SECRET --name <CF_WORKER_NAME>
```

- `COOKIE_SECRET`: any long random string. Rotating it only invalidates
  in-flight login ceremonies, not sessions. **It is required**, and it is the
  one that fails quietly: a Worker without it deploys successfully and then
  nobody can log in. Do not leave it until later.
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
   and **nobody can log in**. Start this early; it is the step that waits.
3. Set `CF_MAIL_FROM` to an address **on the domain you just verified**. This is
   the step that gets skipped, because nothing complains until a reader tries to
   log in. The sending domain has nothing to do with the hostname Folis is
   served from — they are two independent choices, and Resend only knows about
   the one you verified with it. Send from a domain it has not verified and
   every request for a code fails with 403, which reads to the reader
   as「寄不出登入碼」.
4. Set the key:

   ```sh
   npx wrangler secret put RESEND_API_KEY --name <CF_WORKER_NAME>
   ```

Setting the key with no `CF_MAIL_FROM` is refused loudly rather than falling back
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

## 5. Attach the custom domain (optional)

Skip this entirely to stay on `*.workers.dev`.

Otherwise, set `CF_ROUTE` to the hostname — the deploy provisions the DNS record
and the certificate, as long as that zone is on your account.

## 6. Connect the build, and deploy

This is where the code actually ships. Folis uses
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/):
Cloudflare watches the GitHub repo and builds/deploys on push. **It is the only
way anything here is deployed** — there is no laptop path, because the build
variables live in this dashboard and nowhere else.

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
   - Deploy command: `npm run deploy`
   - Root directory: `/`

4. Fill in the build variables listed in *How a deployment is configured*, then
   trigger the first build. It applies the migrations and deploys.

   **Every command in the form above has to be an npm script at the root, never
   a tool invoked directly.** The root's `package.json` knows where each package
   lives, so moving one does not require somebody to remember to edit a form in a
   dashboard. A command that names `wrangler` instead resolves against the
   repository root, where there is no `wrangler.jsonc` — and it announces that
   only as a failed deploy after the merge. That is exactly how the preview
   command below broke when the app moved into `packages/`.
3. Recommended triggers (mirrors the default dashboard setup):
   - `main` branch → build + `npm run deploy` (production)
   - all other branches → build + `npm run versions:upload` (preview versions,
     no production traffic). **Not `npx wrangler versions upload`**, for the
     reason above.

The build token Cloudflare mints for this already covers everything a deploy
here does, D1 included — see below if a build ever fails on permissions.

Secrets set in step 3 live on the Worker and survive deploys; the build
environment does not need them.

### Migrations run from the deploy command, and only on `main`

`wrangler deploy` does not apply migrations, so something else has to.
`deploy` is `node scripts/deploy.ts production`, which generates the
configuration, applies migrations and then deploys. Leave the migration out and a push that adds a column deploys a
Worker reading a column the database has not got — which fails on the first
request, not at deploy time.

**It is an npm script, not a command typed into the dashboard**, so the steps and
their order live in this repo where they can be read and reviewed. The dashboard
holds `npm run deploy` and never needs editing again.
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

## 7. Who may create an account

While `OPEN_SIGNUP` is absent, an address can only create an account if it is in
the `signup_allowlist` table. Existing accounts are unaffected: the gate stands
at account creation, so removing a row does not lock anybody out of data that is
already theirs.

```sh
npx wrangler d1 execute <CF_D1_NAME> --remote \
  --command "INSERT INTO signup_allowlist (email, added_at) VALUES ('reader@example.com', unixepoch() * 1000)"
```

Opening signup to everyone means adding `"OPEN_SIGNUP": "true"` to `vars` in
`wrangler.jsonc` and deploying, on purpose — for Folis itself that edit *is* the
launch line ([ADR-0004](adr/0004-development-phase-and-launch-line.md)), and it
should leave a commit behind. Adding one person should not need a deploy, which
is why the list is in the database and the switch is not.

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
`http://localhost:5001` (browsers treat localhost as a secure context). This is
also why `wrangler.jsonc` having no `vars` costs local development nothing:
`.dev.vars` is where those belong here, and it is gitignored.
Local D1/R2 state lives under `.wrangler/` (gitignored).

No `RESEND_API_KEY` here, so magic codes are printed by `wrangler dev` in the
terminal it is running in. Put your address in the local `signup_allowlist`
first, or the code is never issued:

```sh
npx wrangler d1 execute DB --local \
  --command "INSERT INTO signup_allowlist (email, added_at) VALUES ('you@example.com', 0)"
```

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
