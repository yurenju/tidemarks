# Tidemarks' browser-test environment, one image per checkout.
#
# This is the thin half. Everything that does not depend on the code being tested — the browsers,
# the CJK fonts and their fontconfig pinning, the dependency tree from `npm ci` — lives in
# `docker/deps.Dockerfile`, which `scripts/container.sh` builds once per set of dependencies and
# every checkout shares. Read that file's header for why the fonts are pinned the way they are.
# What is left here is the code itself, under 100MB a checkout instead of 1.5GB.
#
# Why the split: a tagged image is shared across checkouts whether or not the build cache survives,
# and the cache did not — see ADR-0051
# (docs/adr/0051-the-test-image-shares-its-dependencies-across-checkouts.md).
#
# **Not buildable on its own.** `DEPS_IMAGE` has no default, because the tag it names is a hash
# only `scripts/container.sh` computes. To get an image by hand, run
# `scripts/build-test-image.sh`; it prints the id.

ARG DEPS_IMAGE
FROM ${DEPS_IMAGE}

COPY . .

# frond is built into the image rather than by each run. The app imports it through its
# `exports`, which point at `dist/`, and every `docker run` below is `--rm` — so a build done
# inside one run would be gone before the next one needs it.
RUN npm run build:frond

# Nothing else is run at build time. The entry point is the command the scripts pass in
# (`scripts/test-in-container.sh` runs vitest and then playwright), so one image serves every
# runner in the monorepo.
CMD ["npm", "test"]
