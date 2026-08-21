#!/usr/bin/env bash
#
# Walks you through standing up your own Tidemarks on Cloudflare, one step at a
# time: it opens each page, says what to do there, captures the values you copy
# back, and prints them as the table you paste into the build variables form.
#
# **It is docs/deployment.md in the order you actually do it.** That document is
# the reference — why each piece is the way it is, and what breaks otherwise. This
# script is the sequence, and it exists because the sequence is where the two
# quiet failures live: a sender domain that was never verified, and a missing
# COOKIE_SECRET. Both deploy successfully and then nobody can log in.
#
# **Every step here is a page in a browser, not a wrangler command.** Not because
# wrangler cannot do it — docs/deployment.md gives those commands, and they are
# noted below where they exist — but because a wizard that drives a browser can
# also be run by somebody who has never logged wrangler in, and because the two
# secrets are safer copied between tabs than typed into a shell that keeps
# history.
#
# Nothing is written outside `.scratch/`, which `.gitignore` covers, so nothing
# you type here can be committed by accident. The two secrets are never written
# down at all.
#
# Usage:
#   ./scripts/setup-cloudflare.sh
#
# Stop any time with Ctrl-C and re-run: values already captured come back as
# defaults, so you carry on rather than start over.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Wizard library — delightful, consistent UX. Identical across every wizard.
# ──────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

# Author sets this at the top of the stages section.
TOTAL_STAGES=0

_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()    # KEYs written to ENV_FILE this run
WRITTEN_SECRET=() # secret NAMEs set this run
SKIPPED=()        # things we couldn't do (e.g. gh missing)

# _clear — wipe the terminal so only the current step is on screen. No-op when
# output isn't a terminal, so piped logs stay readable.
_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1; then tput clear; else printf '\033[2J\033[3J\033[H'; fi
}

# banner "Title" — opening frame: what this wizard does.
banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  You drive the browser; this wizard tells you exactly what to do and\n' "$DIM"
  printf '  captures the values you copy back. Stop any time with Ctrl-C and re-run\n'
  printf '  later — it remembers values already saved.%s\n' "$RESET"
  pause "Ready to start?"
}

# stage "Name" — clear the screen, then announce a stage and show progress.
# Clearing keeps only the current step on screen.
stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

# say "..." — a plain instruction line.
say()  { printf '  %s\n' "$1"; }
# step "..." — a numbered-feeling action the human takes in the browser.
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

# open_url URL — open in the human's browser, cross-platform incl. WSL.
open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview     >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open    >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open        >/dev/null 2>&1; then open "$url"
    else warn "couldn't open a browser — visit it manually: $url"; fi
  } >/dev/null 2>&1 || warn "couldn't open a browser — visit it manually: $url"
}

# pause "msg" — wait for the human to confirm they've done the manual part.
pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

# confirm "question" — y/N gate; returns success on yes.
confirm() {
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

# _existing KEY — current value of KEY in ENV_FILE, if any.
_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  printf '%s' "${line#*=}"
}

# ask KEY "Prompt" — read a value into $KEY. Offers the existing .env value as
# a default on re-runs (Enter keeps it). Visible input (non-secret).
ask() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -r input || true
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# ask_secret KEY "Prompt" — like ask, but input is hidden.
ask_secret() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || true
  printf '\n'
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# write_env KEY VALUE — upsert KEY=VALUE into ENV_FILE (creates it; replaces
# any existing line). Idempotent.
write_env() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

# set_secret NAME VALUE — set a GitHub Actions repo secret via gh. Falls back
# to a warning (and records it) if gh is unavailable or unauthenticated.
set_secret() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if printf '%s' "$value" | gh secret set "$name" >/dev/null 2>&1; then
      WRITTEN_SECRET+=("$name")
      printf '  %s✓ set%s GitHub secret %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub secret $name (set it manually: gh secret set $name)")
  warn "skipped GitHub secret $name — gh not ready; set it later"
}

# set_var NAME VALUE — set a GitHub Actions repo variable (non-secret).
set_var() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh variable set "$name" --body "$value" >/dev/null 2>&1; then
      printf '  %s✓ set%s GitHub variable %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub variable $name")
  warn "skipped GitHub variable $name — gh not ready; set it later"
}

# finish — clear, then a closing summary of everything configured.
finish() {
  _clear
  printf '\n%s%s  ✓ Setup complete%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} ))    && note "wrote ${#WRITTEN_ENV[@]} value(s) to $ENV_FILE: ${WRITTEN_ENV[*]}"
  (( ${#WRITTEN_SECRET[@]} )) && note "set ${#WRITTEN_SECRET[@]} GitHub secret(s): ${WRITTEN_SECRET[*]}"
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "still to do by hand:"
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

# ──────────────────────────────────────────────────────────────────────────
# STAGES — author this section. One stage() per step the human takes.
# Replace the example below. Set TOTAL_STAGES to match the stages you write.
# ──────────────────────────────────────────────────────────────────────────

case "${1:-}" in
  -h|--help)
    # The header block above, minus the shebang: read to the first line of code
    # rather than to a line number, so editing the header cannot truncate --help.
    sed -n '3,/^set -euo/p' "${BASH_SOURCE[0]}" | grep '^#' | sed 's/^# \{0,1\}//'
    exit 0
    ;;
esac

# Run from the root wherever it was invoked from: the paths below are relative to
# it, and so is every npm script named in the dashboard forms.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Where the captured values land. Not `.env`: nothing on this machine reads any
# of them. Their one destination is a form in somebody's browser, so what this
# file is for is surviving a Ctrl-C and being pasted from. `.gitignore` covers
# `.scratch/`.
BUILD_VARS_FILE=".scratch/cloudflare-setup/build-variables.env"
mkdir -p "$(dirname "$BUILD_VARS_FILE")"
ENV_FILE="$BUILD_VARS_FILE"

# Two values worth remembering across re-runs that are not build variables.
# Mixing them into the file above would mean sorting out which rows go in the
# form and which do not, one row at a time, at the moment you least want to.
LOCAL_NOTES_FILE=".scratch/cloudflare-setup/notes.env"

# remember KEY "Prompt" — ask and persist, against the notes file rather than the
# build-variables one. It also keeps the key out of the closing summary's "wrote N
# values" line, which is about the form you are going to paste into and would be
# wrong if these two were counted in it.
remember() {
  local key="$1" prompt="$2" saved="$ENV_FILE" n
  ENV_FILE="$LOCAL_NOTES_FILE"
  ask "$key" "$prompt"
  n=${#WRITTEN_ENV[@]}
  write_env "$key" "${!key}"
  WRITTEN_ENV=("${WRITTEN_ENV[@]:0:n}")
  ENV_FILE="$saved"
}

# Dashboard deep links. `?to=/:account/...` fills your account in. If one drops
# you on the account picker instead, choose an account and follow the path named
# in the step.
CF_HOME="https://dash.cloudflare.com/"
CF_WORKERS="https://dash.cloudflare.com/?to=/:account/workers-and-pages"
CF_D1="https://dash.cloudflare.com/?to=/:account/workers/d1"
CF_R2="https://dash.cloudflare.com/?to=/:account/r2"
CF_KV="https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces"

TOTAL_STAGES=12

banner "Deploy Tidemarks to your Cloudflare account"

# ── 1. hostname ───────────────────────────────────────────────────────────
stage "Choose the hostname and the Worker's name"
say "This is the one decision here that cannot be taken back. CF_RP_ID is the"
say "hostname passkeys are scoped to, and once the first passkey is registered,"
say "changing it invalidates every passkey there is."
say ""
note "docs/deployment.md → Deciding the hostname first"
say ""
ask CF_WORKER_NAME "Worker name [tidemarks]:"
CF_WORKER_NAME="${CF_WORKER_NAME:-tidemarks}"

if confirm "Use a custom domain? (no = stay on *.workers.dev)"; then
  say ""
  step "Use a dedicated subdomain rather than an apex, e.g. tidemarks.example.com,"
  step "so passkeys are scoped to this app and nothing else on the domain."
  step "Its zone has to be on your Cloudflare account — that is the next stage."
  ask CF_ROUTE "Custom domain:"
  CF_RP_ID="$CF_ROUTE"
  write_env CF_ROUTE "$CF_ROUTE"
else
  say ""
  step "Your workers.dev subdomain is on Workers & Pages → Overview. It is there"
  step "before you have deployed anything."
  open_url "$CF_WORKERS"
  remember WORKERS_SUBDOMAIN "Your workers.dev subdomain (the middle part only):"
  CF_RP_ID="${CF_WORKER_NAME}.${WORKERS_SUBDOMAIN}.workers.dev"
  note "With CF_ROUTE unset the Worker answers on ${CF_RP_ID}"
fi

CF_ORIGIN="https://${CF_RP_ID}"
write_env CF_WORKER_NAME "$CF_WORKER_NAME"
write_env CF_RP_ID "$CF_RP_ID"
write_env CF_ORIGIN "$CF_ORIGIN"
say ""
warn "From here on, ${CF_RP_ID} is settled."
say ""
note "Get it wrong and the deploy still succeeds — nothing shows until somebody"
note "tries a passkey. So the Worker checks: a passkey asked for on a host this"
note "CF_RP_ID does not cover is refused with a sentence naming both hostnames."
note "Magic codes are deliberately not checked, which makes them the way back in."
pause "Happy with that? Press Enter to continue"

# ── 2. zone ───────────────────────────────────────────────────────────────
stage "Put the domain's zone on this Cloudflare account"
if [[ -n "${CF_ROUTE:-}" ]]; then
  DOMAIN_APEX="${CF_ROUTE#*.}"
  say "The deploy provisions the DNS record and the certificate for ${CF_ROUTE},"
  say "which it can only do if ${DOMAIN_APEX} is a zone on this account."
  open_url "$CF_HOME"
  step "Add a domain → ${DOMAIN_APEX}"
  step "Point your registrar at the two nameservers it gives you"
  step "Wait for the zone to go Active (minutes to hours)"
  say ""
  note "The next stage adds DNS records to this same zone, so let it go Active first."
  pause "Zone Active? Press Enter to continue"
else
  say "Staying on *.workers.dev, so there is no zone to add. Skipping."
  pause
fi

# ── 3. Resend ─────────────────────────────────────────────────────────────
stage "Mail: add the sending domain and publish its DNS"
say "An account is an email address, and a six-digit code mailed to it is one of"
say "the two ways in. So something has to send mail — or the code goes to the log."
say ""
say "Both are supported. Choose by who logs in:"
say ""
step "Just you → no vendor. The code is printed in the Worker's log."
step "Other people → Resend, with a domain it has verified."
say ""
warn "This is the step that fails quietly, and the step that waits."
say "An unverified sending domain means Resend refuses every message with a 403"
say "and nobody can log in — and none of that is visible at deploy time. So it"
say "goes early, and this stage only starts it; verification is checked later."
say ""

if confirm "Set up Resend? (no = codes go to the log)"; then
  open_url "https://resend.com/domains"
  step "Add Domain → the domain you will send from"
  step "It gives you SPF, DKIM and a return-path record"
  step "Add all three to that domain's DNS (in Cloudflare, if the zone is here)"
  say ""
  note "The sending domain has nothing to do with the hostname above — they are two"
  note "independent choices, and Resend only knows about the one you verified."
  say ""
  ask CF_MAIL_FROM "Sender address, e.g. Tidemarks <login@example.com>:"
  write_env CF_MAIL_FROM "$CF_MAIL_FROM"
  say ""
  note "Verification takes a while. Carry on; stage 6 comes back to check it."
  pause
else
  say ""
  say "Then leave both CF_MAIL_FROM and RESEND_API_KEY unset. Login codes are"
  say "written to the Worker's log, where stage 11 reads them."
  note "This is a supported way to run Tidemarks, not a half-finished one."
  note "docs/deployment.md → step 4"
  pause
fi

# ── 4. storage ────────────────────────────────────────────────────────────
stage "Create the storage: D1, R2, KV"
warn "Do not create any tables here. Migrations are applied by the first deploy,"
warn "and that order is the point."
say ""

step "D1 → Create database"
open_url "$CF_D1"
ask CF_D1_NAME "D1 database name [tidemarks]:"
CF_D1_NAME="${CF_D1_NAME:-tidemarks}"
step "Open it and copy the Database ID"
ask CF_D1_ID "D1 database_id:"

say ""
step "R2 → Create bucket. Leave public access off — the Worker streams objects"
step "itself, after an auth check."
open_url "$CF_R2"
ask CF_R2_BUCKET "R2 bucket name [tidemarks]:"
CF_R2_BUCKET="${CF_R2_BUCKET:-tidemarks}"

say ""
step "KV → Create a namespace, called OAUTH_KV. It holds OAuth grants for the"
step "read-only MCP server; nothing in it is a reader's data."
open_url "$CF_KV"
step "Copy its Namespace ID"
ask CF_KV_ID "KV namespace id:"

write_env CF_D1_NAME "$CF_D1_NAME"
write_env CF_D1_ID "$CF_D1_ID"
write_env CF_R2_BUCKET "$CF_R2_BUCKET"
write_env CF_KV_ID "$CF_KV_ID"
say ""
note "Same three with wrangler, if you would rather: wrangler d1 create <name>,"
note "wrangler r2 bucket create <name>, wrangler kv namespace create OAUTH_KV."
say ""
note "Wrangler offers to provision the KV namespace for you on first deploy. Do not"
note "let it: it writes the new id back into the config file, and a build environment"
note "cannot commit that. The id is lost, and every later deploy tries to create the"
note "namespace again and fails with \"already exists\" (code 10014)."
pause

# ── 5. Worker ─────────────────────────────────────────────────────────────
stage "Create an empty Worker"
say "The Worker exists before the code does because secrets attach to a Worker,"
say "and the next stage needs somewhere to attach them."
open_url "$CF_WORKERS"
step "Create → Worker (any starter will do)"
step "Name it ${CF_WORKER_NAME} — exactly what you gave as CF_WORKER_NAME"
step "Deploy. It serves a placeholder until stage 10 replaces it."
pause "Worker created? Press Enter to continue"

# ── 6. secrets ────────────────────────────────────────────────────────────
stage "Set the secrets"
say "Secrets are attached to the Worker and read at runtime. Build variables are"
say "read at build time and invisible to a running Worker — different things,"
say "different forms."
say ""
warn "COOKIE_SECRET is required and it is the one that fails quietly: a Worker"
warn "without it deploys successfully and then nobody can log in."
say ""
GENERATED_COOKIE_SECRET="$(openssl rand -hex 32)"
say "Here is one, generated locally and written to no file:"
say ""
printf '    %s%s%s\n' "$BOLD" "$GENERATED_COOKIE_SECRET" "$RESET"
say ""
say "Both secrets go in the same place:"
say ""
printf '    %sWorkers & Pages → %s → Settings → Variables and Secrets → Add%s\n' \
  "$BOLD" "$CF_WORKER_NAME" "$RESET"
say ""
warn "Pick type Secret, not Text. Text is shown in plain sight in the dashboard."
say ""
open_url "$CF_WORKERS"
step "Add → Type: Secret → Name: COOKIE_SECRET → Value: the string above → Deploy"
say ""
note "Losing it or rotating it is cheap: it only voids login ceremonies in flight,"
note "not sessions that already exist."
say ""

if [[ -n "${CF_MAIL_FROM:-}" ]]; then
  # CF_MAIL_FROM may be "Tidemarks <login@example.com>" or the bare address, so
  # take what follows the @ and drop a trailing >. That is the domain Resend knows.
  MAIL_DOMAIN="${CF_MAIL_FROM#*@}"; MAIL_DOMAIN="${MAIL_DOMAIN%%>*}"
  say "The second secret is RESEND_API_KEY, in that same form. Verify first:"
  say ""
  step "Resend → Domains → confirm ${MAIL_DOMAIN} reads Verified"
  open_url "https://resend.com/domains"
  step "Not verified yet? Wait. Setting the key now only earns you a 403 per message."
  say ""
  step "Once verified: Resend → API Keys → create one and copy it (shown once)"
  open_url "https://resend.com/api-keys"
  say ""
  step "Back to Workers & Pages → ${CF_WORKER_NAME} → Settings → Variables and Secrets"
  step "Add → Type: Secret → Name: RESEND_API_KEY → Value: the key → Deploy"
  open_url "$CF_WORKERS"
  say ""
  note "Copied tab to tab, never through this script — so neither key reaches a disk"
  note "or a shell history. wrangler secret put does the same job if you prefer."
  say ""
  note "A secret takes effect on Deploy; no rebuild, and later deploys never wipe it."
  note "MAIL_FROM is the opposite: a build variable, so it arrives with stage 10's"
  note "build. That gap is harmless now — the Worker is still stage 5's placeholder."
  say ""
  warn "It stops being harmless once the site is live. Adding Resend to a running"
  warn "deployment goes the other way round: set CF_MAIL_FROM, rebuild, then the key."
  note "A key with no MAIL_FROM makes worker/email.ts throw and takes login down"
  note "entirely — worse than neither. On purpose: a deployment that believes it is"
  note "sending mail must not quietly print login codes into a log."
else
  note "No CF_MAIL_FROM, so do not set RESEND_API_KEY either. That combination is"
  note "refused loudly rather than falling back to the log."
fi
pause "Secrets set? Press Enter to continue"

# ── 7. Workers Builds ─────────────────────────────────────────────────────
stage "Connect Workers Builds"
say "This is the only way anything here is deployed. There is no laptop path,"
say "because the build variables live in this dashboard and nowhere else."
open_url "$CF_WORKERS"
step "${CF_WORKER_NAME} → Settings → Builds → Connect"
step "Connect GitHub and pick your fork (installs Cloudflare's GitHub App the first time)"
say ""
say "Build configuration:"
say ""
say "    Build command    npm run build"
say "    Deploy command   npm run deploy"
say "    Root directory   /"
say ""
say "Branches other than the default:"
say ""
say "    Deploy command   npm run versions:upload"
say ""
warn "Every command in those forms has to be an npm script at the root, never a"
warn "tool invoked directly."
say "The root package.json knows where each package lives, so moving one does not"
say "mean remembering to edit a form in a dashboard. A command naming wrangler"
say "resolves against the repository root, where there is no wrangler.jsonc — and"
say "it announces that only as a failed deploy, after the merge."
say ""
note "Only the production trigger applies migrations. A branch build must not: it"
note "would apply that branch's migration to the production database before anyone"
note "merged it, and there is no undo."
pause "Connected? Press Enter to continue"

# ── 8. build variables ────────────────────────────────────────────────────
stage "Fill in the build variables"
say "Everything captured so far. Settings → Builds → Build variables, one per row:"
say ""
printf '  %s%-18s %s%s\n' "$BOLD" "CF_WORKER_NAME" "$CF_WORKER_NAME" "$RESET"
printf '  %s%-18s %s%s\n' "$BOLD" "CF_D1_NAME" "$CF_D1_NAME" "$RESET"
printf '  %s%-18s %s%s\n' "$BOLD" "CF_D1_ID" "$CF_D1_ID" "$RESET"
printf '  %s%-18s %s%s\n' "$BOLD" "CF_R2_BUCKET" "$CF_R2_BUCKET" "$RESET"
printf '  %s%-18s %s%s\n' "$BOLD" "CF_KV_ID" "$CF_KV_ID" "$RESET"
printf '  %s%-18s %s%s\n' "$BOLD" "CF_RP_ID" "$CF_RP_ID" "$RESET"
printf '  %s%-18s %s%s\n' "$BOLD" "CF_ORIGIN" "$CF_ORIGIN" "$RESET"
[[ -n "${CF_ROUTE:-}" ]]     && printf '  %s%-18s %s%s\n' "$DIM" "CF_ROUTE" "$CF_ROUTE" "$RESET"
[[ -n "${CF_MAIL_FROM:-}" ]] && printf '  %s%-18s %s%s\n' "$DIM" "CF_MAIL_FROM" "$CF_MAIL_FROM" "$RESET"
say ""
note "The same list is in $BUILD_VARS_FILE if you get interrupted halfway."
say ""
open_url "$CF_WORKERS"
say ""
note "Miss a required one and the build stops and prints which. It deliberately does"
note "not fall back to the repository's wrangler.jsonc, which carries no ids: wrangler"
note "would provision a second set of resources, and see the 10014 story in stage 4."
pause "Filled in? Press Enter to continue"

# ── 9. custom domain ──────────────────────────────────────────────────────
stage "Attach the custom domain"
if [[ -n "${CF_ROUTE:-}" ]]; then
  say "CF_ROUTE is set to ${CF_ROUTE}, and the deploy provisions the DNS record and"
  say "the certificate itself. Nothing to do here beyond what stage 2 already did:"
  say "the zone has to be on this account."
  note "docs/deployment.md → step 5"
else
  say "Staying on *.workers.dev. Your address will be ${CF_RP_ID}"
fi
pause

# ── 10. first deploy ──────────────────────────────────────────────────────
stage "Trigger the first deploy"
open_url "$CF_WORKERS"
step "${CF_WORKER_NAME} → Settings → Builds → trigger a build (or push to the default branch)"
say ""
say "It does three things in this order: generate the configuration, apply the"
say "migrations, upload the Worker."
say ""
note "The order is the whole point. wrangler deploy does not apply migrations, so"
note "scripts/deploy.ts does. Leave it out and a commit adding a column deploys a"
note "Worker reading a column the database has not got — which fails on the first"
note "request, not at deploy time."
say ""
warn "If the build fails on permissions, read the token Workers Builds minted."
warn "The documented permission list is shorter than what the dashboard actually"
warn "mints and omits D1 entirely."
note "The failure mode is at least the safe one: the migration errors and the Worker"
note "is never uploaded."
pause "Build green? Press Enter to continue"

# ── 11. allowlist ─────────────────────────────────────────────────────────
stage "Let your address create an account"
say "While OPEN_SIGNUP is unset, an address can only create an account if it is in"
say "the signup_allowlist table (worker/signup-gate.ts). A fresh D1 is empty, so"
say "your first sign-in is refused with 「這個信箱還不能註冊」 and no code is sent."
say ""
note "The gate stands at account creation only. Logging in never passes through it,"
note "so removing a row later does not take away data that is already somebody's."
say ""
remember ADMIN_EMAIL "The email address you will sign in with:"
ADMIN_EMAIL_LOWER="$(printf '%s' "$ADMIN_EMAIL" | tr '[:upper:]' '[:lower:]')"
say ""
say "Run this on the D1 database — its Console tab in the dashboard, or wrangler"
say "d1 execute <name> --remote --command '...':"
say ""
printf '    %sINSERT INTO signup_allowlist (email, added_at)%s\n' "$BOLD" "$RESET"
printf '    %sVALUES (%s, unixepoch() * 1000);%s\n' "$BOLD" "'$ADMIN_EMAIL_LOWER'" "$RESET"
say ""
note "Lowercased for you: the Worker compares lower(email), so a capitalised row"
note "sits in the table looking correct and matching nobody."
open_url "$CF_D1"
pause "Row inserted? Press Enter to continue"

# ── 12. check it works ────────────────────────────────────────────────────
stage "Check it works"
say "Four things, and each failure has a different cause."
say ""
warn "Sign in with a magic code, not a passkey. There is no passkey yet — you"
warn "register one from the account panel after you are in."
say ""
open_url "$CF_ORIGIN"

VERIFY_FAILED=()
confirm "1. The build deployed?" \
  || VERIFY_FAILED+=("Deploy — read the build log; usually a missing required build variable")
confirm "2. ${CF_ORIGIN} loads?" \
  || VERIFY_FAILED+=("Loads — the custom domain's DNS and certificate may still be provisioning, or CF_ROUTE is unset")
if [[ -n "${CF_MAIL_FROM:-}" ]]; then
  confirm "3. A magic code arrives and signs you in?" \
    || VERIFY_FAILED+=("Sign-in — no mail: is the Resend domain verified? Bounced back out: is COOKIE_SECRET set? Refused: redo stage 11")
else
  say ""
  note "No Resend, so the code is in the Worker's log: ${CF_WORKER_NAME} → Logs →"
  note "Begin log stream, or wrangler tail. The whole letter is there, not just the code."
  confirm "3. The code from the log signs you in?" \
    || VERIFY_FAILED+=("Sign-in — bounced back out: is COOKIE_SECRET set? Refused: redo stage 11")
fi
confirm "4. A book you import shows up on a second device?" \
  || VERIFY_FAILED+=("Sync — the D1 or R2 binding; read the Worker's log")

say ""
if (( ${#VERIFY_FAILED[@]} )); then
  warn "Not passing yet:"
  for f in "${VERIFY_FAILED[@]}"; do note "  - $f"; done
  say ""
  note "docs/deployment.md has the long version of each of these."
else
  say "All four. It is yours, and it is running."
  say ""
  note "Two things worth knowing now rather than later: sessions last 90 days, and"
  note "losing every passkey is not losing the account — a mailed code gets you back"
  note "in. Losing the inbox is another matter. docs/deployment.md → Operational notes."
fi
pause

finish
note "Build variables: $BUILD_VARS_FILE"
[[ -f "$LOCAL_NOTES_FILE" ]] && note "Other values kept for re-runs: $LOCAL_NOTES_FILE"
note "If a step here did not match what you saw, that is a bug in this script or a"
note "gap in docs/deployment.md — either is worth an issue."
printf '\n'
