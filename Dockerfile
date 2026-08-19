# Folis's browser-test environment.
#
# Ported from frond's, and deliberately leaner. The shape is the same and for the same
# reason: **CI and local machines share one image**, so "the tests are green" means the same
# thing in both places, and there is no "green locally, red in CI" gap hiding in the font
# layer.
#
# frond's fontconfig pinning is ported too, and it used to not be. The argument for leaving
# it out was that frond measures glyph geometry while Folis measures **behaviour** — does a
# page turn advance, does a highlight land over the text it was drawn from, does the
# Scrubber mirror for a vertical book — and that none of those change with the face.
#
# **That argument was wrong, and issue #25 is the bill.** The base image carries WenQuanYi
# Zen Hei, and unpinned fontconfig resolved `serif` to it — along with every family name
# this image does not have, which is every name the book and Folis's own stack put ahead of
# the generic. WenQuanYi Zen Hei's Han glyphs have no vertical advance, so every kanji in
# the vertical Japanese book was drawn with none and the next character landed on top of
# it. What that shows is not that the premise was too narrow but that the conclusion did not
# follow: the face does not have to change a *measurement* to make the text unreadable, and
# the evidence screenshots a pull request is read from are rendered here.
#
# The CJK font's version is pinned for the original reason as well: a font update changes
# glyph metrics, which changes line breaking, which changes **page** breaking — and a spec
# asserting "there is a second page" would then flake for a reason unrelated to Folis's
# code. Without any CJK font the vertical Japanese book renders as tofu boxes, which would
# make every evidence screenshot worthless.

# Pinned to an explicit version, and it has to match package.json's @playwright/test or the
# browsers in the image will not be the ones the suite expects. MCR's official images lag the
# npm package; check the tags before moving either:
#   curl -s https://mcr.microsoft.com/v2/playwright/tags/list
FROM mcr.microsoft.com/playwright:v1.61.1-noble

ARG FONTS_NOTO_CJK_VERSION=1:20230817+repack1-3
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        "fonts-noto-cjk=${FONTS_NOTO_CJK_VERSION}" \
    && rm -rf /var/lib/apt/lists/*

# Binds the generic families and the regional faces. Having the fonts installed is not
# enough on its own: what a bare `serif` resolves to is still decided by whatever else the
# base image happens to carry. The number 75 is necessary rather than arbitrary — the base
# image's 60-latin.conf and the 70-fonts-noto-cjk.conf that ships with fonts-noto-cjk both
# touch the same generic families, and this file has to come after both. The complete
# ordering rules, including one that runs counter to intuition, are in the file's header.
COPY docker/fontconfig/75-folis-cjk.conf /etc/fonts/conf.d/75-folis-cjk.conf
RUN fc-cache --force --really-force

# The process locale is part of the font configuration. When WebKit asks fontconfig for a
# generic family it does **not** pass the document's `lang`, and fontconfig fills that gap
# from the locale — so one environment variable decides the CJK regional face for the whole
# WebKit process (frond measured LANG=ja_JP.UTF-8 switching its serif from TC to JP even for
# `lang=zh-TW` documents). The base image is already C.UTF-8, so these two lines change
# nothing today; they are written down because the day it drifts, the symptom is all three
# browsers' line and page breaks moving together with the cause hidden in a variable nobody
# is looking at.
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# Checks at build time that the bindings took effect. A broken binding raises no error and
# turns no assertion red — it silently renders everything in another face. Better to fail
# here than to find out from a screenshot.
COPY docker/verify-fonts.sh /usr/local/bin/folis-verify-fonts
RUN chmod +x /usr/local/bin/folis-verify-fonts && folis-verify-fonts

WORKDIR /work

# The lockfile alone first, so a source change does not reinstall the dependency tree.
#
# **Every workspace's manifest has to come along.** `npm ci` reads them to build the tree, and
# with one missing it does not fall back to something workable — it refuses, or installs a tree
# that does not match the lockfile.
COPY package.json package-lock.json ./
COPY packages/app/package.json ./packages/app/
COPY packages/frond/package.json ./packages/frond/
RUN npm ci

# The browsers are already in the base image; downloading them again would be several hundred
# megabytes of the same thing.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY . .

# frond is built into the image rather than by each run. The app imports it through its
# `exports`, which point at `dist/`, and every `docker run` below is `--rm` — so a build done
# inside one run would be gone before the next one needs it.
RUN npm run build:frond

# Nothing else is run at build time. The entry point is the command the scripts pass in
# (`scripts/test-in-container.sh` runs vitest and then playwright), so one image serves every
# runner in the monorepo.
CMD ["npm", "test"]
