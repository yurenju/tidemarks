#!/usr/bin/env bash
#
# Runs the tests inside the test container. CI and local machines share one image — see the
# Dockerfile's header.
#
# Three suites run here, in this order: Vitest's Node tests for the whole monorepo, then
# Playwright for frond, then Playwright for the app. The Node half needs neither fonts nor
# browsers, but it goes in anyway — one entry point and one set of versions is what makes
# "the tests are green" mean the same thing in both places.
#
# **Except under CI, where the Node half is skipped.** That is a hole in the sentence above and
# it is worth being explicit about rather than leaving to be discovered. Two things make it a
# cheap one. The workflow's own `test` job already runs the same Vitest from the same lockfile,
# and it reports inside a minute rather than after an image build. And the guarantee the shared
# image buys is about fonts and browser builds — the paragraph above says so — which is a
# guarantee the Node tests have no use for.
#
# What it buys: this script runs once per engine in CI now, so an unconditional Vitest would be
# the same 23s of transform, workerd startup and 1469 assertions three times over, in front of
# the browser tests each shard is actually there to run.
#
# frond before the app because it is the layer underneath: when the renderer is broken, the
# app's specs go red too, and reading frond's failures first says which of the two it is.
#
# Usage:
#   ./scripts/test-in-container.sh                     # chromium, off CI (see below)
#   ./scripts/test-in-container.sh --project=firefox   # remaining arguments pass to playwright
#   ./scripts/test-in-container.sh --only=app --project=chromium tests/browser/library/marks.spec.ts
#
# **Off CI and with no `--project` of its own, this runs chromium alone** — see
# docs/adr/0039-three-engines-are-ci-s-job-not-the-local-loop-s.md. All three still exist and CI
# still runs all three; what changed is which of them a local run reaches for by default. To ask
# for the others here, name them:
#
#   ./scripts/test-in-container.sh --project=chromium --project=firefox --project=webkit
#
# **`--only=` exists so that naming one spec file is possible at all.** The remaining arguments
# go to both browser suites, so a path under `packages/app/tests/` matches nothing on frond's
# side, and Playwright treats "no tests found" as an error and stops the script before the app's
# half runs. Without a way to drop the other suite, the only way to iterate on a single spec was
# to bypass this script and call the container engine directly — which skips the build and the
# staleness check below, and so answers about an image that may not hold the code on disk.
#
# What it is worth, measured on this project: a full run is 6m46s (787 renderer assertions, then
# 341 app ones across three engines), against 21s for one spec in one engine — of which 18s is
# building the image and checking it, so the tests themselves are seconds. That difference is
# paid on every edit, so it decides the shape of the loop rather than trimming it.
#
# Narrow while the code is still moving; run the whole suite once before the commit, and again
# before the pull request — on chromium both times, per the default above.
#
# **What that gives up, stated rather than glossed over: one engine is one engine.** The full
# three-engine run that produced the numbers above also caught two failures in Firefox that no
# chromium-only run could have seen. Those now arrive as a red CI run instead, at the price of
# another push. See the testing section of CLAUDE.md.
#
# Playwright is invoked through each workspace's own script rather than as `npx playwright
# test`, because a package configures the browsers for itself and its config sits beside its
# specs — frond measures glyph geometry at 800×600, the app measures behaviour at 1000×700,
# and neither number is the other's business.
#
# When what you want is screenshots rather than a red/green light, this is not the script: it
# runs with --rm and mounts nothing writable, so files produced inside disappear with the
# container. Evidence for a pull request is captured on the host with playwright-cli instead —
# see docs/adr/0007-pr-evidence-is-captured-on-the-host.md.
set -euo pipefail

# Parsed before the image is built, so a typo fails in under a second rather than after it.
# Only the leading argument is examined: everything after it belongs to Playwright, and one of
# its own arguments could legitimately contain this string.
suites=all
case "${1:-}" in
    --only=app | --only=frond)
        suites="${1#--only=}"
        shift
        ;;
    --only=*)
        echo "Unknown suite '${1#--only=}'. It is --only=app or --only=frond." >&2
        exit 1
        ;;
esac

# Written anywhere else it would be handed to Playwright, which reads it as a filename pattern
# and answers `No tests found` — an error about the wrong thing entirely, and one that reads as
# "that spec does not exist". Cheaper to say so.
for arg in "$@"; do
    if [[ "$arg" == --only=* ]]; then
        echo "--only= has to come first, before the arguments meant for Playwright." >&2
        echo "    ./scripts/test-in-container.sh ${arg} ${*/${arg}/}" >&2
        exit 1
    fi
done

# The default engine, and it is a default rather than a setting: anything that names a
# `--project` of its own is left exactly as written, including the three-engine form in the
# usage above. ADR-0039 has the reasoning; in short, three engines are what CI is for, and
# paying for all three on every local edit stopped being worth it once the renderer stopped
# being what changes.
#
# **Gated on CI, and the gate points the safe way.** CI names its engine on every call
# (`.github/workflows/ci.yml`), so this branch is not reached there today. What the gate buys is
# the direction of the mistake if that ever stops being true: a CI job that forgot its
# `--project` runs all three and is slow, rather than running one and going green on a third of
# what it claimed to check.
#
# Both spellings, because `--project=chromium` and `--project chromium` are the same argument to
# Playwright and would not be to a match on the first alone.
if [[ -z "${CI:-}" ]]; then
    engine_named=
    for arg in "$@"; do
        [[ "$arg" == --project* ]] && engine_named=yes
    done
    if [[ -z "$engine_named" ]]; then
        echo "==> chromium only (off CI, no --project given); CI runs all three"
        set -- --project=chromium "$@"
    fi
fi

source "$(dirname "${BASH_SOURCE[0]}")/container.sh"

container_build

# --- run -------------------------------------------------------------------
#
# **The two browser suites do not get the same network.** frond supplies every page through
# Playwright's route interception, so it runs with `--network=none` and thereby proves no spec
# quietly depends on an outside connection. The app's specs drive the real app, which means
# Playwright starts Vite inside the container and the browser talks to it over loopback — and
# `--network=none` leaves no loopback interface to bind. What keeps that half honest instead is
# that nothing in it reaches outside the container: the books come from `tests/books/`, and the
# sync API is not exercised by these specs.
run_args=(--rm --init)

if [[ -n "${CI:-}" ]]; then
    mkdir -p "$REPO_ROOT/playwright-report"
    run_args+=(
        --env CI
        --volume "${REPO_ROOT}/playwright-report:/work/playwright-report"
    )
fi

# The Node tests first. They cover the pure logic the browser tests lean on — when a decision
# module is broken, seeing that first is far easier to trace than watching all three browsers
# go red together.
#
# They are not free: 23s, of which only 7 is running assertions and the rest is transform,
# imports and workerd starting up. On a local machine that is worth paying for the ordering
# alone. Under CI it is not, because the `test` job has already paid it — see the header.
#
# **`npm test` rather than `vitest` directly, and the difference is not stylistic.** The root
# script compiles the message catalogs before it runs anything, and a bare `vitest` skips that:
# `worker/i18n.ts` imports `../src/locales/en.mjs`, which is compiled output and is not in the
# image — the image builds the renderer, not the catalogs. So every app and worker test file
# died on a missing module, 37 of them, while the header above was claiming this entry point is
# what makes "the tests are green" mean the same thing in both places. It did not: CI skips this
# half, so the one place the gap could show was a local run, pointing the wrong way round from
# the "green locally, red in CI" hazard the Dockerfile's header is written about.
#
# Naming the same script CI's `test` job runs is what closes it. The renderer build it repeats
# costs 0.6s against an image that already has one.
#
# `--only=` skips them too. The ordering argument above is about which failure you read first
# when you are running everything; someone who has named one spec file is not reading a list.
# `npm test` on the host is seconds and covers the same ground.
if [[ "$suites" != all ]]; then
    echo "==> skipping the Node tests (--only=${suites}; run 'npm test' on the host)"
elif [[ -z "${CI:-}" ]]; then
    echo "==> running the Node tests (Vitest, every package)"
    "$ENGINE" run "${run_args[@]}" "$IMAGE_NAME" npm test
else
    echo "==> skipping the Node tests (CI runs them in the 'test' job)"
fi

if [[ "$suites" == all || "$suites" == frond ]]; then
    echo "==> running frond's browser tests (Playwright)"
    "$ENGINE" run "${run_args[@]}" --network=none "$IMAGE_NAME" \
        npm run test:browser -w @yurenju/frond -- "$@"
fi

if [[ "$suites" == all || "$suites" == app ]]; then
    echo "==> running the app's browser tests (Playwright)"
    "$ENGINE" run "${run_args[@]}" "$IMAGE_NAME" npm run test:browser -w app -- "$@"
fi
