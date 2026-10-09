#!/usr/bin/env bash
#
# Measures page turns under load and leaves the numbers in `.scratch/perf/` (issue #261).
#
# In the container for the reason the screen sweep is: the numbers are read next to a run taken
# on another machine on another day, and the engine build and the fonts — which decide how much
# text a page holds — have to be the same both times.
#
# Nothing here passes or fails on a number; see the header of
# `packages/app/tests/perf/turn-load.spec.ts`.
#
# Usage:
#   ./scripts/measure-perf.sh                          # both directions, both CPU rates
#   ./scripts/measure-perf.sh -g "horizontal at 1"     # remaining arguments pass to playwright
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/container.sh"

container_build

# Created here rather than inside the container so it belongs to the user running this.
PERF_DIR="$REPO_ROOT/.scratch/perf"
mkdir -p "$PERF_DIR"

echo "==> measuring page turns into ${PERF_DIR}"

exec "$ENGINE" run --rm --init \
    --volume "${PERF_DIR}:/work/.scratch/perf" \
    --env TIDEMARKS_PERF_DIR=/work/.scratch/perf \
    "$IMAGE_NAME" npm run perf -w app -- "$@"
