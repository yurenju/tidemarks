# frond

The renderer. A TypeScript EPUB rendering library in which vertical and
horizontal writing are equal citizens, and every layout claim is verified on
Chromium, Firefox and WebKit.

It was published as `@yurenju/frond` until 0.4.15 and is not published any more:
it lives here, and the app depends on it as a workspace link. Why, and what
taking that back would cost, is in
[ADR-0017](../../docs/adr/0017-frond-moves-in-and-stops-being-published.md).

## The boundary, which is the whole point of it being a package

**frond answers with facts; the app decides policy**
([ADR-0002](docs/adr/0002-frond-owns-facts-spine-owns-policy.md)). A fact is
"this book is rtl, is vertical, this range covers these rectangles, the current
fraction is 0.42". A policy is "so swiping left means the next page, a highlight
is drawn in this colour, the table of contents is a sidebar".

Nothing in here is allowed to hold a default UI policy. There is no layer left
that could: `@yurenju/frond-react` was retired at 0.4.3, and the package
boundary is now the only thing keeping the line — a release no longer stands
between a shortcut and the renderer. So when something is painful to do in the
app, the question is which kind of pain it is:

- **The app cannot get at a fact only frond knows** → frond grows that fact, and
  the decision stays in the app.
- **It is merely fiddly** (many cases, many exceptions) → it stays in the app.
  Fiddly is not a reason to move.

## Two layers

| Entry point | Needs DOM | What it gives you |
| --- | --- | --- |
| `@yurenju/frond/epub` | no | `EpubBook.open(bytes)` → metadata, reading order, TOC, cover, manifest resources, raw bytes by path. Plus CFI parsing, serialising and comparison. |
| `@yurenju/frond/renderer` | yes | `Renderer.attach(book, element)` → paging, section navigation, reader settings, writing mode, CFI ↔ position, typed events. |

`EpubBook` has no DOM dependency, which is why the Worker can open a book to
answer an MCP question. `Renderer` does not take an `EpubBook` but a narrow
`RenderableBook` interface; `MemoryBook` implements it so that code reacting to
frond's events can be tested without faking a book.

The public surface explains itself in its own header comments. Start at
[`src/epub/index.ts`](src/epub/index.ts) and
[`src/renderer/index.ts`](src/renderer/index.ts).

## Zero runtime dependencies, still

ZIP reading, XML parsing, CFI and pagination are all its own code on top of
platform APIs. Nothing may creep in either: the build fails if anything appears
in the emitted modules that `package.json` did not declare
(`scripts/finish-build.ts`). One consequence worth keeping is that the emitted
modules carry no bare specifiers at all, so a browser can import them directly.

That rule survives the move. It is the reason `dist/` is what the app imports
rather than `src/`: the check runs on the way out.

## What frond does not do

Most of these are decisions rather than gaps. It does not handle gestures, does
not fetch anything, does not follow links, does not report a page count for a
whole book, does not run scripts inside books
([ADR-0006](docs/adr/0006-iframe-isolation-no-scripted-content.md)), does not do
DRM, does not manage a library, and reads EPUB only.

Where a book says nothing, frond reports "the book did not say" rather than
substituting a default
([ADR-0010](docs/adr/0010-epub-2-support-boundary.md)).

## Development

Every command runs from the root of the monorepo.

```bash
npm run build:frond                      # emit dist/, which the app imports
npm run typecheck -w @yurenju/frond      # tsc over src, scripts and tests
npx vitest run --project frond           # the parsing layer, no browser
npm run test:container                   # every runner, inside the test image
```

Browser tests only run inside the container: the three engines and the pinned
fonts are in the test image, not on your machine. See
[`CLAUDE.md`](CLAUDE.md) and [`docs/test-environment.md`](docs/test-environment.md).

## Licence

MIT. See [LICENSE](LICENSE), which still covers everything published up to
0.4.15.

frond is a reimplementation, not a port, and carries no third-party code. The one
piece of upstream material is the CFI acceptance table in
`tests/node/cfi/foliate-acceptance.test.ts`, taken from
[foliate-js](https://github.com/johnfactotum/foliate-js) (MIT, Copyright (c)
2022 John Factotum). See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
