#!/usr/bin/env bash
#
# Shared preamble for the container engine: confirm docker is reachable, build the image. Ported
# from frond's `scripts/container.sh`.
#
# **This is not meant to be executed; it is meant to be `source`d.**
#
# It used to have two callers, which was the argument for keeping it separate: `test-in-container.sh`
# and `capture-evidence.sh` had to agree on the image, and "how to talk to the container engine"
# can only have one answer. The second caller is gone — evidence for a pull request is captured on
# the host now (docs/adr/0007-pr-evidence-is-captured-on-the-host.md).
#
# It has callers again: `test-in-container.sh`, `capture-shots.sh` (the screen sweep) and
# `measure-perf.sh` (page turns under load). It also answers a different question than any of them:
# this one is about reaching docker at all (is the daemon up, is the client pointed at it), and that
# is worth reading — and failing — separately from "which tests to run".
#
# After sourcing, available are:
#   REPO_ROOT        the absolute path of the repo root
#   IMAGE_NAME       the tag to build; the image's id once container_build has run
#   container_build  builds the image, refuses to return unless it holds the working directory
#                    (issue #185), and repoints IMAGE_NAME at the id it checked

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# One image per checkout, so two of them stop overwriting each other's tag.
#
# The name used to be `tidemarks-test` from everywhere on the machine, which cost two things.
# Correctness, addressed by `container_build` pinning the image id below rather than by this name.
# And work: a build from one checkout leaves every other checkout's tag pointing at an image that
# is no longer theirs, so their next run rebuilds — the tags took turns rather than coexisting.
#
# Keyed on the checkout's directory name, so `docker images` still says which worktree an image
# belongs to. Lowercased because a tag may not carry uppercase: a clone in `~/src/Tidemarks` would
# otherwise fail every run with `repository name must be lowercase`, an error that never mentions
# the directory.
#
# **Names can still collide** — two clones both called `tidemarks` is the realistic case, not two
# worktrees. That costs the rebuilds above and nothing else, because what a run is pointed at is an
# image id by then. `TIDEMARKS_TEST_IMAGE` is there for whoever wants to separate them anyway.
#
# What it costs: images accumulate rather than replace one another, so a deleted worktree leaves
# one behind. Cleanup is in docs/development.md.
IMAGE_NAME="${TIDEMARKS_TEST_IMAGE:-tidemarks-test-$(basename "$REPO_ROOT" | tr '[:upper:]' '[:lower:]')}"

# docker, rootful or rootless — the tests run on either, and which one a machine uses is that
# machine's business, not this script's. Rootless docker carries one trap worth knowing: the client
# keeps pointing at the rootful socket until a context is created for it, and the error when it
# does not reads as "docker is not installed". The reachability check below names that case.
if ! command -v docker >/dev/null 2>&1; then
    echo "docker not found." >&2
    exit 1
fi

# Being on PATH does not mean the daemon is reachable. Without this step a misconfigured
# machine gets all the way to the build before failing, and the error says a socket path does
# not exist — which reads as "not installed" when in fact it is installed and the client is
# pointed at the wrong place. Those two call for entirely different responses.
#
# This only diagnoses. Where the socket lives belongs to docker's configuration, not to a
# test script — a script that guessed would silently paper over a misconfigured machine.
if ! docker info >/dev/null 2>&1; then
    echo "Found docker but it cannot run." >&2
    if [[ -S "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/docker.sock" ]]; then
        echo "The rootless socket is at ${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/docker.sock, but the client is not pointed at it. To connect:" >&2
        echo "    docker context create rootless --docker host=unix://${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/docker.sock" >&2
        echo "    docker context use rootless" >&2
    else
        echo "Check whether the daemon is running, and where the client points (docker context ls / DOCKER_HOST)." >&2
    fi
    exit 1
fi

# A proxy on the host's loopback needs the build to share the host's network.
#
# docker copies the ambient `HTTP_PROXY` / `HTTPS_PROXY` into the build, which is what makes
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
# On this project's machines that has not always been true: a container engine this project has
# since stopped using was seen printing `Using cache` for the Dockerfile's `COPY . .` against a
# context that had gained a file, and the tests then ran green against a checkout from an earlier
# session (issue #185).
#
# The cause was never found — the same engine, the same repo, the same Dockerfile refused to
# reproduce it on demand — so there is no telling whether docker can do the same, and that is
# exactly why the answer here is not to chase the cache. It is
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
        docker run --rm --interactive --workdir /work "$IMAGE_NAME" sh -c "$MANIFEST_SCRIPT")"

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
    echo "    docker build --no-cache --tag ${IMAGE_NAME} ${REPO_ROOT}" >&2
    return 1
}

container_build() {
    local network
    network="$(build_network_args)"

    if [[ -n "$network" ]]; then
        echo "==> building ${IMAGE_NAME} with docker (${network}: the proxy is on loopback)"
    else
        echo "==> building ${IMAGE_NAME} with docker"
    fi

    docker build ${network:+"$network"} --tag "$IMAGE_NAME" "$REPO_ROOT"

    echo "==> checking ${IMAGE_NAME} holds this working directory"
    container_verify_source

    # From here on the caller is pointed at an image id, not at the tag it just checked.
    #
    # Everything above proves a property of an *image*; a tag is a machine-wide mutable name that
    # happens to point at one right now. The runs come minutes later, and anything that builds the
    # same name in between — another checkout, another terminal in this one — moves the name and
    # leaves the run reporting on code nobody here has: green, with no sign of it in the output.
    # Measured, before the name became per-checkout: two parallel runs, one of which read back a
    # spec name and line number belonging to the other.
    #
    # An id cannot be moved, so the window closes rather than narrowing. Which also means the tag
    # above is now a convenience for reading `docker images` rather than something correctness
    # rests on, and hand-run containers are the case left over: `docker run … tidemarks-test-<dir>`
    # out of docs/agents/flaky.md resolves the name again, every time.
    IMAGE_NAME="$(docker image inspect --format '{{.Id}}' "$IMAGE_NAME")"
}
