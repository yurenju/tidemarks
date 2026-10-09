#!/usr/bin/env bash
#
# Shared preamble for the container engine: confirm docker is reachable, build the image. Ported
# from frond's `scripts/container.sh`.
#
# **This is not meant to be executed; it is meant to be `source`d.**
#
# Its callers — `test-in-container.sh`, `capture-shots.sh` (the screen sweep), `measure-perf.sh`
# (page turns under load), `build-test-image.sh`, and frond's `scripts/scan-books.sh` — have to
# agree on the image and on how it is built, cleaned up and checked, and "how to talk to the
# container engine" can only have one answer.
# It also answers a different question than any of them: this one is about reaching docker at all
# and getting an image that holds this checkout, which is worth reading — and failing — separately
# from "which tests to run".
#
# After sourcing, available are:
#   REPO_ROOT        the absolute path of the repo root
#   IMAGE_NAME       the tag to build; the image's id once container_build has run
#   container_build  clears out test images nobody can use any more, builds the shared dependency
#                    image if this set of dependencies has none yet, builds this checkout's image
#                    on top of it, refuses to return unless that image holds the working directory
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
# What it costs: images accumulate rather than replace one another, so a deleted worktree would
# leave one behind. Nobody deletes them by hand reliably, so `container_prune` below does it on
# every build — and keeps the cost of each one small by sharing the dependency layer.
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
    echo "    docker build --no-cache --build-arg DEPS_IMAGE=${DEPS_TAG} --tag ${IMAGE_NAME} ${REPO_ROOT}" >&2
    return 1
}

# --- the dependency image every checkout shares ------------------------------
#
# Each checkout's image is built on a shared one holding the browsers, the fonts and `npm ci`'s
# tree, tagged rather than left to the build cache, because a tag survives a cache prune. ADR-0051
# (docs/adr/0051-the-test-image-shares-its-dependencies-across-checkouts.md) has the argument.
DEPS_REPO=tidemarks-deps

# The manifests `npm ci` needs. docker/deps.Dockerfile says why `packages/site` is not one.
DEPS_MANIFESTS=(package.json packages/app/package.json packages/frond/package.json)

# Fills the directory $1 with everything docker/deps.Dockerfile is allowed to see, and nothing else.
#
# **The image's tag is a hash of this directory, so what goes in here is what decides when the
# dependencies count as changed.** That makes a forgotten file fail loudly: a `COPY` of something
# not put here fails the build, rather than baking in a file the hash never saw.
#
# The manifests go in without their `scripts`. A branch that added one script would otherwise get a
# fresh 918MB `npm ci` of a tree identical to everyone else's — measured on a real branch, whose only
# difference was a `"perf"` line.
deps_context() {
    local ctx="$1" manifest
    cp -R "$REPO_ROOT/docker/." "$ctx/"
    cp "$REPO_ROOT/package-lock.json" "$ctx/"
    for manifest in "${DEPS_MANIFESTS[@]}"; do
        mkdir -p "$ctx/$(dirname "$manifest")"
    done
    node -e '
        const { readFileSync, writeFileSync } = require("node:fs");
        const { join } = require("node:path");
        const [root, ctx, ...manifests] = process.argv.slice(1);
        for (const manifest of manifests) {
            const json = JSON.parse(readFileSync(join(root, manifest), "utf8"));
            delete json.scripts;
            writeFileSync(join(ctx, manifest), JSON.stringify(json, null, 2) + "\n");
        }
    ' "$REPO_ROOT" "$ctx" "${DEPS_MANIFESTS[@]}"
}

# Paths are part of what is hashed, so a file moving inside the context counts as a change too.
deps_hash() {
    (cd "$1" && find . -type f | LC_ALL=C sort | while IFS= read -r f; do sha256sum "$f"; done) |
        sha256sum | cut -c1-16
}

# --- clearing out what nobody can use any more --------------------------------
#
# The project is developed in worktrees whose names carry a random suffix, so the image of a
# deleted worktree is never reused by anyone — and git has no hook for a worktree being removed.
# The next build, from any checkout, is the first moment anything can notice, so that is where this
# runs: before building, because a full disk is exactly when the build needs the room.
#
# ⚠️ **What it may remove is narrow on purpose.** Another checkout may be building or running
# tests right now, and losing its image halfway would fail it with an error that points nowhere
# near here. So it removes only these, never with `-f` (an image a container is using stays), and
# never touches the build cache:
#
#   - a checkout image whose checkout directory is gone. Decided by the path in its label rather
#     than by `git worktree list`, which would take another clone's images for orphans.
#   - a checkout image with no tag left that is over a day old: an earlier build of a checkout that
#     still exists. Not removed sooner because `container_build` pins an image id and the runs
#     after it can take a while; a second build in the same checkout meanwhile strips this one's
#     tag, and removing it then would pull it out from under the first.
#   - a dependency image no remaining checkout image is built on, also only once it is a day old,
#     so one built a moment ago for a checkout whose own build has not finished is left alone.
#
# Images built before these labels existed carry none, so this never sees them; they are removed
# by hand once (docs/development.md).
#
# Best effort throughout: a failure here is reported and the build carries on, because a full
# disk is a better error than a test run refused over housekeeping.
CONTAINER_STALE_AFTER=24h

# Fails when the image is in use, so the caller can count it as still there.
container_remove() {
    local reason="$1" id="$2" tags="$3"
    # A tagged image is removed by its tags, because `docker rmi <id>` refuses an id that more
    # than one tag points at.
    if [[ -n "$tags" ]]; then
        # shellcheck disable=SC2086 # tags are space-separated and contain no spaces themselves
        docker rmi $tags >/dev/null 2>&1 || { echo "    kept ${tags} (${reason}, but it is in use)"; return 1; }
        echo "    removed ${tags} (${reason})"
    else
        docker rmi "$id" >/dev/null 2>&1 || { echo "    kept ${id:7:12} (${reason}, but it is in use)"; return 1; }
        echo "    removed ${id:7:12} (${reason})"
    fi
}

# Every image carrying the label $1, tagged or not, narrowed by any further `--filter` arguments.
# `docker images` leaves untagged images out of a label filter unless it is also asked for
# `dangling=true` — and the untagged ones are half of what the prune is for.
container_images_labelled() {
    local label="$1"
    shift
    {
        docker images --filter "label=${label}" "$@" --format '{{.ID}}' &&
            docker images --filter "label=${label}" --filter dangling=true "$@" --format '{{.ID}}'
    } | sort -u
}

container_prune() {
    local keep_deps="$1" ids stale id checkout deps tags tag in_use deps_in_use=" "
    # The unit separator rather than a tab, because `read` collapses runs of whitespace delimiters
    # and an empty field would shift every field after it.
    local sep=$'\x1f'

    echo "==> clearing out test images nobody can use any more"

    if ! ids="$(container_images_labelled tidemarks.role=checkout)" ||
        ! stale="$(docker images --filter label=tidemarks.role=checkout --filter dangling=true \
            --filter "until=${CONTAINER_STALE_AFTER}" --format '{{.ID}}')"; then
        echo "    could not list the images; leaving them all in place" >&2
        return 0
    fi
    for id in $ids; do
        IFS="$sep" read -r id checkout deps tags < <(docker image inspect --format \
            "{{.Id}}${sep}{{index .Config.Labels \"tidemarks.checkout\"}}${sep}{{index .Config.Labels \"tidemarks.deps\"}}${sep}{{join .RepoTags \" \"}}" \
            "$id") || continue
        # An image that could not be removed is still built on its dependency image, so that one
        # counts as in use just as it would for an image nobody tried to remove.
        if [[ ! -d "$checkout" ]]; then
            container_remove "${checkout} is gone" "$id" "$tags" || deps_in_use+="${deps} "
        elif [[ -z "$tags" ]] && grep -q "^${id:7:12}" <<<"$stale"; then
            container_remove "an earlier build for ${checkout}" "$id" "" || deps_in_use+="${deps} "
        else
            deps_in_use+="${deps} "
        fi
    done

    if ! ids="$(container_images_labelled tidemarks.role=deps)" ||
        ! stale="$(container_images_labelled tidemarks.role=deps \
            --filter "until=${CONTAINER_STALE_AFTER}")"; then
        echo "    could not list the dependency images; leaving them all in place" >&2
        return 0
    fi
    for id in $ids; do
        IFS="$sep" read -r id tags < <(docker image inspect --format \
            "{{.Id}}${sep}{{join .RepoTags \" \"}}" "$id") || continue
        if [[ " $tags " == *" ${keep_deps} "* ]]; then
            continue
        fi
        in_use=
        for tag in $tags; do
            [[ "$deps_in_use" == *" ${tag} "* ]] && in_use=yes
        done
        if [[ -z "$in_use" ]] && grep -q "^${id:7:12}" <<<"$stale"; then
            container_remove "no checkout image is built on it" "$id" "$tags"
        fi
    done
}

container_build() {
    local network ctx status=0
    network="$(build_network_args)"
    if [[ -n "$network" ]]; then
        echo "==> building with ${network}: the proxy is on loopback"
    fi

    ctx="$(mktemp -d)"
    deps_context "$ctx"
    DEPS_TAG="${DEPS_REPO}:$(deps_hash "$ctx")"

    container_prune "$DEPS_TAG"

    # Built only when missing. A tag that exists already holds this exact context, since the
    # context is what named it — so there is nothing to rebuild, whether or not the cache that
    # produced it is still around.
    if docker image inspect "$DEPS_TAG" >/dev/null 2>&1; then
        echo "==> reusing ${DEPS_TAG}"
    else
        echo "==> building ${DEPS_TAG} (no image for these dependencies on this machine yet)"
        docker build ${network:+"$network"} --file "$ctx/deps.Dockerfile" \
            --label tidemarks.role=deps --tag "$DEPS_TAG" "$ctx" || status=$?
    fi
    rm -rf "$ctx"
    if [[ "$status" -ne 0 ]]; then
        return "$status"
    fi

    # `tidemarks.role` is set again here because labels are inherited: without it, this image
    # would carry the dependency image's `deps` and be cleared out as one.
    echo "==> building ${IMAGE_NAME} on ${DEPS_TAG}"
    docker build ${network:+"$network"} --build-arg DEPS_IMAGE="$DEPS_TAG" \
        --label tidemarks.role=checkout \
        --label tidemarks.checkout="$REPO_ROOT" \
        --label tidemarks.deps="$DEPS_TAG" \
        --tag "$IMAGE_NAME" "$REPO_ROOT"

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
    # rests on. Containers run by hand would resolve the name again on every run, which is why
    # `build-test-image.sh` hands them this id instead.
    IMAGE_NAME="$(docker image inspect --format '{{.Id}}' "$IMAGE_NAME")"
}
