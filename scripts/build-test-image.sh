#!/usr/bin/env bash
#
# Builds the test image for this checkout and prints its id, for running something in it by hand.
#
#   IMG=$(./scripts/build-test-image.sh)
#   docker run --rm --init "$IMG" npm run typecheck
#
# It does everything `test-in-container.sh` does before running a test: clears out images nobody
# can use any more, builds the shared dependency image if needed, builds this checkout's image on
# top, and checks that image holds the code on disk (issue #185). Building by hand with
# `docker build` skips all of that, and the root Dockerfile does not build on its own anyway.
#
# **Prints an id rather than a name, and that is the point of it.** A name is resolved again on
# every `docker run`, so a loop of runs against `tidemarks-test-<dir>` starts running somebody
# else's build the moment anything rebuilds that name. An id cannot move.
#
# Progress goes to stderr, so the command substitution above captures the id and nothing else.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/container.sh"

container_build >&2

echo "$IMAGE_NAME"
