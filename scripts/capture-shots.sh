#!/usr/bin/env bash
#
# Sweeps every screen the app has and leaves the pictures in `.scratch/shots/`.
#
# The images are for looking at — for discussing visual design and UX with an assistant — and
# they are thrown away after. Nothing here compares them to anything.
#
# **Why this runs in the container, when evidence for a pull request does not.** They are two
# different pictures. Evidence is captured on the host, of a specific change, alongside numbers
# and a defect reading (docs/adr/0007-pr-evidence-is-captured-on-the-host.md). A sweep is of
# everything, whatever changed, and it is looked at next to a sweep taken on another machine on
# another day — so the font resolution and the engine build have to be the same both times, and
# the container is the only place in this project where they are. The full argument, and what it
# costs, is docs/adr/0027-the-screen-sweep-runs-in-the-container.md.
#
# **This is not `test-in-container.sh`.** That one runs with nothing writable mounted, on
# purpose, and its header says so. This is its second caller — the one `container.sh` has been
# waiting for since `capture-evidence.sh` retired.
#
# Usage:
#   ./scripts/capture-shots.sh                      # both devices
#   ./scripts/capture-shots.sh --project=mobile     # remaining arguments pass to playwright
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/container.sh"

container_build

# The one writable thing in the mount, and it is outside version control (`.gitignore` covers
# `.scratch/`). Created here rather than inside the container so it belongs to the user running
# this rather than to whoever the image runs as.
SHOTS_DIR="$REPO_ROOT/.scratch/shots"
mkdir -p "$SHOTS_DIR"

echo "==> sweeping every screen into ${SHOTS_DIR}"

exec "$ENGINE" run --rm --init \
    --volume "${SHOTS_DIR}:/work/.scratch/shots" \
    --env TIDEMARKS_SHOTS_DIR=/work/.scratch/shots \
    "$IMAGE_NAME" npm run sweep -w app -- "$@"
