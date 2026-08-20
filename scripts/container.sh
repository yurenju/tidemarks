#!/usr/bin/env bash
#
# Shared preamble for the container engine: pick an engine, confirm it is reachable, build
# the image. Ported from frond's `scripts/container.sh`.
#
# **This is not meant to be executed; it is meant to be `source`d.**
#
# It used to have two callers, which was the argument for keeping it separate: `test-in-container.sh`
# and `capture-evidence.sh` had to agree on the image, and "how to talk to the container engine"
# can only have one answer. The second caller is gone — evidence for a pull request is captured on
# the host now (docs/adr/0007-pr-evidence-is-captured-on-the-host.md).
#
# It stays a file of its own because it answers a different question than its caller does: this one
# is about reaching a container engine at all (which engine, is the daemon up, is it rootless), and
# that is worth reading — and failing — separately from "which tests to run". If no second caller
# ever appears, folding it into `test-in-container.sh` is a reasonable thing to do next time
# someone touches either.
#
# After sourcing, available are:
#   ENGINE           podman or docker
#   REPO_ROOT        the absolute path of the repo root
#   IMAGE_NAME       the image name
#   container_build  builds the image, then refuses to return unless it holds the working
#                    directory (issue #185)

IMAGE_NAME="${TIDEMARKS_TEST_IMAGE:-tidemarks-test}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The requirement is that running the tests needs no root-equivalent access, and **podman is the
# shortest way to meet it** — run by a non-root user it is rootless already, with nothing to
# install afterwards, no daemon to keep alive, and no client to point anywhere. That is why it
# comes first: the default should be the engine that cannot be misconfigured into rootful.
#
# Rootless docker meets the same requirement and stays as the fallback: a dockerd under an
# ordinary uid, its socket in $XDG_RUNTIME_DIR rather than /var/run/docker.sock, and no `docker`
# group for anyone to join. What it costs is a setup step (`dockerd-rootless-setuptool.sh
# install`) and one trap that step does not mention — the client keeps pointing at the rootful
# socket until a context is created for it, and the error when it does not reads as "docker is
# not installed". Machines already set up that way keep working; they just no longer decide the
# order for machines that are not.
#
# Preferring podman does not weaken the rootless guarantee for docker, because the order is not
# what enforces it. The check after the reachability probe measures it off the daemon.
#
# An explicit choice still wins, and CI makes one: the runner ships both engines, so which one
# builds the image should not depend on what that image happens to include. Its podman writes an
# OCI spec the crun beside it rejects, which kills every `RUN` in the build with "unknown version
# specified" before the command inside it starts — so CI pins docker, and the pin is load-bearing
# rather than belt-and-braces now that the order below would land on podman. Either way both
# engines build the same Dockerfile, so the image stays the one thing CI and local machines share.
if [[ -n "${TIDEMARKS_CONTAINER_ENGINE:-}" ]]; then
    ENGINE="$TIDEMARKS_CONTAINER_ENGINE"
    if ! command -v "$ENGINE" >/dev/null 2>&1; then
        echo "TIDEMARKS_CONTAINER_ENGINE is set to ${ENGINE}, which is not on PATH." >&2
        exit 1
    fi
elif command -v podman >/dev/null 2>&1; then
    ENGINE=podman
elif command -v docker >/dev/null 2>&1; then
    ENGINE=docker
else
    echo "Neither podman nor docker found." >&2
    exit 1
fi

# Being on PATH does not mean the daemon is reachable. Without this step a misconfigured
# machine gets all the way to the build before failing, and the error says a socket path does
# not exist — which reads as "not installed" when in fact it is installed and the client is
# pointed at the wrong place. Those two call for entirely different responses.
#
# This only diagnoses. Where the socket lives belongs to the engine's configuration, not to a
# test script — a script that guessed would silently paper over a misconfigured machine.
#
# The advice is per engine, because the two fail for unrelated reasons and the wrong hint sends
# someone down a road with nothing at the end of it. podman has no daemon to be down at all: when
# it cannot run, it is almost always that the user has no subordinate UID range to map into.
if ! "$ENGINE" info >/dev/null 2>&1; then
    echo "Found ${ENGINE} but it cannot run." >&2
    if [[ "$ENGINE" == podman ]]; then
        echo "podman is daemonless, so this is its own setup rather than a service being down." >&2
        echo "Rootless podman needs a subordinate UID/GID range for $(id -un) in /etc/subuid and /etc/subgid:" >&2
        echo "    grep $(id -un) /etc/subuid /etc/subgid" >&2
        echo "Read the whole error with: podman info" >&2
    elif [[ -S "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/docker.sock" ]]; then
        echo "The rootless socket is at ${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/docker.sock, but the client is not pointed at it. To connect:" >&2
        echo "    docker context create rootless --docker host=unix://${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/docker.sock" >&2
        echo "    docker context use rootless" >&2
    else
        echo "Check whether the daemon is running, and where the client points (docker context ls / DOCKER_HOST)." >&2
    fi
    exit 1
fi

# Rootless is the requirement, so measure it instead of reading it off the engine's name. The
# daemon reports it, and by this point the daemon is known to be reachable.
#
# Only docker gets asked. Not because podman is trusted on its name — the point above is that
# names are not evidence — but because there is no rootful podman to catch here: run by a
# non-root user it maps into a subordinate UID range and that is the only mode it has. Reaching
# this line at all now means docker was named explicitly or podman was not installed.
#
# What a rootful dockerd costs: its socket is equivalent to host root, because anything that can
# reach it can bind-mount the host filesystem into a privileged container — so joining the
# `docker` group hands over the machine. It also writes NAT and DOCKER-USER chains into netfilter
# ahead of the rules already there, which quietly reopens an egress whitelist if one is set up.
#
# A warning, not an exit: the tests do run on a rootful docker, and rebuilding a machine's engine
# setup mid-run is not this script's business. Staying quiet about it is not either. Silent under
# CI, where the runner is discarded after one job and the question buys nothing.
if [[ -z "${CI:-}" && "$ENGINE" == docker ]] &&
    ! docker info --format '{{.SecurityOptions}}' 2>/dev/null | grep -q 'name=rootless'; then
    echo "Warning: this dockerd is rootful. Its socket is equivalent to host root, and it puts" >&2
    echo "  its own rules into netfilter. This project expects a rootless engine: installing" >&2
    echo "  podman is the shorter way there, and 'dockerd-rootless-setuptool.sh install' the other." >&2
fi

# A proxy on the host's loopback needs the build to share the host's network.
#
# Both engines copy the ambient `HTTP_PROXY` / `HTTPS_PROXY` into the build, which is what makes
# `apt-get` work behind a corporate proxy and is the right default. It is the wrong default when
# the proxy is listening on loopback: inside the build container `127.0.0.1` is the container, so
# every fetch is refused and the Dockerfile dies on `Unable to locate package fonts-noto-cjk` —
# an error that reads as "this package is gone from Ubuntu" rather than "nothing reached the
# mirror". Machines that route egress through a local proxy are exactly the ones this hits.
#
# `--network=host` for the build alone puts the host's loopback back within reach. The test runs
# do not need it: the app's Vite server and the browser talk to each other over the container's
# own loopback, and frond's half deliberately has no network at all.
#
# Narrow on purpose. A machine with no proxy, or with one on a real address, builds exactly as it
# did before — the isolation is given up only where keeping it means not building.
build_network_args() {
    local proxy
    for proxy in "${HTTPS_PROXY:-}" "${https_proxy:-}" "${HTTP_PROXY:-}" "${http_proxy:-}"; do
        case "$proxy" in
            *localhost* | *127.0.0.1* | *"[::1]"*)
                echo "--network=host"
                return
                ;;
        esac
    done
}

# --- the image has to be this working directory ----------------------------
#
# A build is only worth anything if the image it leaves behind holds the code on disk right now.
# On this project's machines that has not always been true: podman 5.7 has been seen printing
# `Using cache` for the Dockerfile's `COPY . .` against a context that had gained a file, and the
# tests then ran green against a checkout from an earlier session (issue #185).
#
# The cause is still unknown — the same podman, the same repo, the same Dockerfile refuse to
# reproduce it on demand — which is exactly why the answer here is not to chase the cache. It is
# to measure the thing the build was supposed to guarantee, so that the failure mode stops being
# "quietly tested the wrong code" and becomes "refused to run". `--no-cache` would also be
# correct, and costs an apt install and an `npm ci` on every single run; that is too much to pay
# for a fault nobody can trigger twice.

# One manifest recipe, run on both sides, so a difference can only come from the files.
#
# `sha256sum` alone would report a missing file on stderr, whose interleaving with stdout is not
# ordered — two identical trees could then produce two different transcripts. Naming the missing
# file on stdout instead keeps the comparison about content.
MANIFEST_SCRIPT='while IFS= read -r f; do
    if [ -f "$f" ]; then sha256sum "$f"; else echo "missing         $f"; fi
done'

# The exclusions are read off `.dockerignore` rather than repeated here, because a copy of a list
# is a list that goes stale: the day a tracked path starts or stops being ignored, the manifest
# follows on its own. No tracked path is excluded today — `docs/evidence/` was the last one, and it
# is gone — so the filter below currently removes nothing. It stays because the next such entry
# should not also have to remember this function exists.
#
# Three shapes are understood, which is every shape `.dockerignore` currently uses: `dir/`,
# `**/dir/`, and a plain path. An unknown shape errs the safe way on its own — it stays in the
# manifest, so the check asks the image for a file the image was never given and says so by name.
#
# A negation is the one shape that would err the other way, quietly: `!x` puts files *back* into
# the context, and leaving them out of the manifest would make this check weaker without saying
# so. So it is refused rather than guessed at.
context_exclude_regex() {
    local line escaped parts=()
    while IFS= read -r line; do
        line="${line%$'\r'}"
        [[ -z "$line" || "$line" == \#* ]] && continue
        if [[ "$line" == '!'* ]]; then
            echo "scripts/container.sh cannot read '${line}' in .dockerignore." >&2
            echo "  Negations widen the build context, so skipping one would quietly narrow the" >&2
            echo "  staleness check in container_verify_source. Teach it the shape first." >&2
            return 1
        fi
        escaped="$(printf '%s' "$line" | sed 's/[][^$.*+?(){}|\\]/\\&/g')"
        case "$line" in
            '**/'*/) parts+=("(^|/)${escaped#\\*\\*/}") ;;
            */) parts+=("^${escaped}") ;;
            *) parts+=("^${escaped}$") ;;
        esac
    done <"$1"
    local IFS='|'
    printf '%s' "${parts[*]}"
}

# Only tracked files, and only in the host-to-image direction.
#
# Tracked, because an untracked file on the host is not something the image is wrong for lacking.
# One direction, because the image legitimately holds a great deal the host does not — the
# dependency tree from `npm ci`, frond's `dist/` — so "the image has a file the host does not"
# cannot be an error in general. A stale layer that has gained a file has always lost or changed
# others too, and those are caught here.
container_verify_source() {
    local list host image excludes
    # Checked rather than left to `set -e`, which a caller writing `container_verify_source ||`
    # switches off for this whole function — and an unread `.dockerignore` there would carry on
    # with no exclusions at all and bury the real answer under every ignored file in the repo.
    if ! excludes="$(context_exclude_regex "$REPO_ROOT/.dockerignore")"; then
        return 1
    fi
    list="$(git -C "$REPO_ROOT" ls-files)"
    # An empty pattern matches every line, so an absent or comment-only `.dockerignore` has to
    # skip the filter rather than run it and leave nothing to compare.
    if [[ -n "$excludes" ]]; then
        list="$(printf '%s\n' "$list" | grep -Ev "$excludes" || true)"
    fi

    host="$(cd "$REPO_ROOT" && printf '%s\n' "$list" | sh -c "$MANIFEST_SCRIPT")"
    image="$(printf '%s\n' "$list" |
        "$ENGINE" run --rm --interactive --workdir /work "$IMAGE_NAME" sh -c "$MANIFEST_SCRIPT")"

    if [[ "$host" == "$image" ]]; then
        return 0
    fi

    echo "" >&2
    echo "${IMAGE_NAME} does not hold the code in ${REPO_ROOT}." >&2
    echo "" >&2
    echo "Refusing to run the tests: a green light from this image would not be about your" >&2
    echo "working directory. This is issue #185 — the container engine reused a cached" >&2
    echo "'COPY . .' layer against a context that had changed." >&2
    echo "" >&2
    echo "Files that differ (host manifest vs image manifest, first 20):" >&2
    # `diff` exits 1 on a difference and `head` can close the pipe under it — both of which
    # `set -e` in the caller reads as this function ending here, before the fix below is printed.
    { diff <(printf '%s\n' "$host") <(printf '%s\n' "$image") | head -20; } >&2 || true
    echo "" >&2
    echo "Rebuild without the cache and run again:" >&2
    echo "    ${ENGINE} build --no-cache --tag ${IMAGE_NAME} ${REPO_ROOT}" >&2
    return 1
}

container_build() {
    local network
    network="$(build_network_args)"

    if [[ -n "$network" ]]; then
        echo "==> building ${IMAGE_NAME} with ${ENGINE} (${network}: the proxy is on loopback)"
    else
        echo "==> building ${IMAGE_NAME} with ${ENGINE}"
    fi

    "$ENGINE" build ${network:+"$network"} --tag "$IMAGE_NAME" "$REPO_ROOT"

    echo "==> checking ${IMAGE_NAME} holds this working directory"
    container_verify_source
}
