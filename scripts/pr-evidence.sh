#!/usr/bin/env bash
#
# The part of capturing pull-request evidence that is the same every time: getting a browser on
# the host into the state where the interesting screenshot can be taken.
#
# **This is not meant to be executed; it is meant to be `source`d**, the same way
# `container.sh` is. What it holds is only the setup — open a clean browser, put a book in,
# open that book. What the shot is *of* stays in the script that sources this, because that
# part is different every time and writing it out is the point.
#
#   source scripts/pr-evidence.sh
#   SHOTS=$(mktemp -d)
#   for B in chromium; do
#       pw_fresh "$B" "$B"
#       pw_import "$B" "$PWD/tests/books/kusamakura-vertical-japanese.epub"
#       pw_open_book "$B"
#       # ── whatever this pull request is about, from here ──
#       pw_fonts_ready "$B"
#       playwright-cli -s="$B" screenshot --filename="$SHOTS/$B-reader.png"
#       playwright-cli -s="$B" close
#   done
#   pr-image upload --markdown "$SHOTS"/*.png
#
# **A loop over one engine, and the loop is kept for the one case that still needs it.** Evidence
# is chromium alone by default; when the change touches `packages/frond/src/renderer/` or
# anything vertical, the list becomes `chromium firefox webkit` and every helper below already
# takes the engine as its first argument. That is the whole of the rule — the reasoning, and what
# goes unwatched between the two, is docs/adr/0039-three-engines-are-ci-s-job-not-the-local-loop-s.md.
#
# Why this exists rather than the skeleton being copied each time: across this project's
# sessions the same eight lines were rewritten more than thirty times, and every one of the
# recurring failures documented in `docs/agents/pull-requests.md` lives in exactly these eight —
# the missing click before `upload`, `delete-data` on the wrong side of `open`, a Chinese label
# for an English button, an unpinned interface language. Encoding them once is what stops the
# next session from rediscovering them one error message at a time.
#
# Evidence is still captured on the host and still written per pull request
# (docs/adr/0007-pr-evidence-is-captured-on-the-host.md). This does not move it into the
# container and does not turn it into a fixed suite; the screen sweep that *is* a fixed suite is
# `capture-shots.sh`, and it is a different thing for a different reason (ADR-0027).

# The app under test. Override when 5001 is taken by another worktree — and note that `/api`
# and `/auth` still proxy to 5002, so sync cannot be exercised from a moved port.
: "${TIDEMARKS_URL:=http://localhost:5001/}"

# Every playwright-cli call goes through here, and the reason is worth stating plainly:
#
# **A failed command exits 0.** A click that matches nothing prints
#
#     ### Error
#     Error: "getByRole('button', { name: '…' })" does not match any elements.
#
# on *stdout* and returns success. Nothing about it is visible to `set -e`, to `||`, or to `$?`.
# So the whole sequence runs to the end on top of a step that did not happen, and the evidence
# that comes out the far side is a screenshot of the wrong screen — which is exactly what the
# accompanying guide warns about, and the reason a helper cannot simply redirect to /dev/null
# and hope.
#
# Reading stdout for the marker is therefore the only signal there is. Output is held back on
# success so a three-engine loop stays readable, and printed in full on failure.
pw() {
    local out status
    out="$(playwright-cli "$@" 2>&1)"
    status=$?
    if [[ $status -ne 0 || "$out" == *"### Error"* ]]; then
        printf 'playwright-cli %s\n%s\n' "$*" "$out" >&2
        return 1
    fi
    return 0
}

# The same, for the calls whose output is the point (`eval` reading a measurement back). Errors
# still go to stderr and still fail; what is different is that stdout survives.
pw_out() {
    local out status
    out="$(playwright-cli "$@" 2>&1)"
    status=$?
    if [[ $status -ne 0 || "$out" == *"### Error"* ]]; then
        printf 'playwright-cli %s\n%s\n' "$*" "$out" >&2
        return 1
    fi
    printf '%s\n' "$out"
}

# Single-quote a value for embedding in the JavaScript that selectors and `eval` are written in.
# Book titles come from the epub and are not under this repo's control: `Alice's Adventures in
# Wonderland` — one of the two fixtures in `tests/books/` — closes the string early and leaves a
# selector that is neither valid nor obviously broken.
pw_js_string() {
    local s=${1//\\/\\\\}
    printf "'%s'" "${s//\'/\\\'}"
}

# The interface language the pictures are taken in.
#
# It has to be set here rather than left alone, because the app reads `navigator.languages`
# (`packages/app/src/lib/locale.ts`) — so an unpinned run photographs a property of the machine
# rather than a property of the app, and two shots of the same pull request taken on two laptops
# come back in two languages. The container's two Playwright configs pin `en` with a line each
# for the same reason; on the host there is no config to put that line in.
#
# `en` because English is the source language and therefore cannot be missing an entry
# (ADR-0031). Set this to zh-TW or ja to photograph a translation on purpose.
: "${TIDEMARKS_LOCALE:=en}"

# A browser with nothing left over from last time, at the pinned language.
#
# `open` twice around `delete-data` is not a stutter, and the order is the part that goes wrong:
# `delete-data` does nothing at all when no session is open (silently — it does not complain),
# and it closes the browser once it has run. So the sequence has to be open-clear-open, and a
# script that clears first ends up photographing last run's books.
#
# `--persistent` is not optional either: Tidemarks stores epub bodies as Blobs, which a throwaway
# profile cannot hold — WebKit fails the import outright with "Error preparing Blob/File data to
# be stored in object store".
#
#   pw_fresh <session> <browser> [extra open args...]
#
# Extra arguments go to the second `open`, which is where `--device "iPhone 15"` belongs. Device
# names are case sensitive and a wrong one is ignored in silence, leaving a 1280x720 desktop
# window that looks like the touch UI simply was not built.
pw_fresh() {
    local s=$1 browser=$2
    shift 2
    pw -s="$s" open --browser "$browser" --persistent "$@" "$TIDEMARKS_URL" || return 1
    pw -s="$s" delete-data || return 1
    pw -s="$s" open --browser "$browser" --persistent "$@" "$TIDEMARKS_URL" || return 1
    pw -s="$s" eval \
        "() => { localStorage.setItem('tidemarks-locale', $(pw_js_string "$TIDEMARKS_LOCALE")) }" ||
        return 1
    # The language is read once at startup, so it takes a reload to show up.
    pw -s="$s" goto "$TIDEMARKS_URL" || return 1
}

# One epub onto the shelf, the way a reader puts it there.
#
# **The click is load-bearing**: `upload` drives a file chooser, and with no chooser open it does
# nothing. It does not always say so, either — sometimes it answers "The tool
# "browser_file_upload" can only be used when there is related modal state present", and
# sometimes it returns quietly and the failure surfaces two commands later as `book-open` not
# matching anything, which reads like the import is still in flight. It is not; the shelf is
# empty.
#
# The button carries an English label because English is the source language (ADR-0031). A
# Chinese one selects nothing.
pw_import() {
    local s=$1 epub=$2 before after
    before=$(pw_out -s="$s" --raw eval \
        "() => document.querySelectorAll('[data-testid=\"book-open\"]').length") || return 1
    pw -s="$s" click "getByRole('button', { name: 'Import epub' })" || return 1
    pw -s="$s" upload "$epub" || return 1
    # Give the parse and the first render somewhere to land before anything asks for the card,
    # and then say so if nothing arrived. Counting rather than merely waiting is what turns a
    # silent no-op into a failure: `upload` with no file chooser open returns happily, and
    # without this the error would surface two commands later as `book-open` matching nothing,
    # which reads like the import is still in flight rather than like it never started.
    after=$(pw_out -s="$s" --raw eval \
        "async () => { const n = ${before}; for (let i = 0; i < 60; i++) { const c = document.querySelectorAll('[data-testid=\"book-open\"]').length; if (c > n) return c; await new Promise((r) => setTimeout(r, 250)) } return -1 }") || return 1
    if [[ "$after" == *-1* ]]; then
        echo "pr-evidence: ${epub##*/} never reached the shelf in ${s}." >&2
        echo "  The shelf still holds ${before} book(s). Check the console log the line above names." >&2
        return 1
    fi
}

# Open a book by its own title, or the first one on the shelf when no title is given.
#
# Selecting by title alone does not work: `getByRole`'s `name` matches on substring, so a title
# hits both the cover (`title="Open <title>"`) and the ⋯ button beside it
# (`aria-label="About <title>"`), and strict mode then clicks neither. Narrowing to the card and
# taking `book-open` inside it is what makes a title usable.
#
# With no title the shortcut is `book-open` first on the shelf, which is the selector
# `openBook()` uses in `packages/app/tests/browser/support/library.ts` — worth staying identical
# to, since a change to how a book is opened should break the browser suite rather than only the
# screenshots. `openBook()` has no by-title form; it seeds one book and opens it.
pw_open_book() {
    local s=$1 title=${2:-}
    if [[ -n "$title" ]]; then
        pw -s="$s" click \
            "getByTestId('book-card').filter({ hasText: $(pw_js_string "$title") }).getByTestId('book-open')"
    else
        pw -s="$s" click "getByTestId('book-open').first()"
    fi
}

# Wait for the book's own fonts, not for a guess.
#
# Skipping this photographs a layout still in flight, where every glyph sits at the same spot —
# indistinguishable from a broken font. `sleep 3` is measurably not enough on Firefox, and a
# sleep long enough to be safe is a sleep paid on every engine on every run.
pw_fonts_ready() {
    local s=$1
    pw -s="$s" eval \
        "async () => { const f = [...document.querySelectorAll('.viewer-mount iframe')].find((x) => getComputedStyle(x).visibility === 'visible'); await (f ? f.contentDocument : document).fonts.ready }"
}
