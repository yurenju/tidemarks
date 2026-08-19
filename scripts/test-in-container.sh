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
#   ./scripts/test-in-container.sh                     # all three
#   ./scripts/test-in-container.sh --project=firefox   # remaining arguments pass to playwright
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
if [[ -z "${CI:-}" ]]; then
    echo "==> running the Node tests (Vitest, every package)"
    "$ENGINE" run "${run_args[@]}" "$IMAGE_NAME" npx vitest run
else
    echo "==> skipping the Node tests (CI runs them in the 'test' job)"
fi

echo "==> running frond's browser tests (Playwright)"
"$ENGINE" run "${run_args[@]}" --network=none "$IMAGE_NAME" \
    npm run test:browser -w @yurenju/frond -- "$@"

echo "==> running the app's browser tests (Playwright)"
exec "$ENGINE" run "${run_args[@]}" "$IMAGE_NAME" npm run test:browser -w app -- "$@"
