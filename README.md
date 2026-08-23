<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/tidemarks-wordmark-dark.svg">
    <img src="docs/brand/tidemarks-wordmark.svg" alt="Tidemarks" width="340">
  </picture>
</p>

A local-first epub reader, built as a PWA. Everything lives in the browser's IndexedDB, so a book stays readable and writable offline; an optional Cloudflare Worker syncs across devices (sign in with a passkey, or with a code mailed to you — no password either way).

**You can run your own.** That is what the source being readable is for — [docs/deployment.md](docs/deployment.md) walks through standing one up on your own Cloudflare account, and it is the same path the hosted one takes.

**[app.tidemarks.io](https://app.tidemarks.io) is the one the maintainer runs.** Any other deployment, whatever it calls itself, is somebody else's — so the hostname is the thing to check.

繁體中文版：[README.zh-TW.md](README.zh-TW.md)

## Features

- Library: import epubs by drag-and-drop or file picker; the shelf shows covers, progress, accumulated reading time and session count
- Reader: page turns left and right (arrow keys too), jumps from the table of contents, reopens at the last position
- Highlights: select text, pick a colour, optionally attach a note; the sidebar lists highlights in book order and jumps to any of them
- Reading stats: opening a book records a session, and the time accumulates
- Export: one book's notes as markdown; the whole dataset — epub files included — as JSON, so another browser can pick up where this one left off
- Sync (optional): a book imported on the desktop turns up on the phone's shelf, with progress, highlights, notes and stats travelling with it; the epub body itself downloads only when the book is opened

## Where this is going

The first line above describes what works today. The name points somewhere else: a tidemark is what a tide leaves behind, and what this is aiming to be is a place for what reading leaves behind. Reading well is the foundation; the half worth getting right is what you write down.

Two things follow from that, and **neither has code behind it yet**:

- **A note should not need a book and a selection.** Today a note is a string attached to a highlight, which is attached to one book and one range of text. The kind of note this is aiming at needs neither.
- **EPUB should not be the only source.** Articles and video belong here too.

These are positions, not a schedule. They are written down so that a feature request has something to be measured against — see [ADR-0029](docs/adr/0029-the-app-is-called-tidemarks.md) for how the name forced the question.

## Development

```sh
npm install                # dependencies
npm run dev                # dev server
npm test                   # vitest — pure logic from the decision modules, on Node
npm run test:container     # both runners (Vitest + three browsers); run this if you touched the reader
npm run build              # type-check, then emit dist/
```

Testing comes in two layers. `npm test` covers pure logic: direction inversion, TOC flattening, highlight clipping, settings mapping. `npm run test:container` opens a real book in a container under Chromium, Firefox and WebKit, and actually turns pages, draws highlights and drags the Scrubber. That suite's assertions are the container's numbers, which is why the entry point is `test:container` rather than `test:browser`.

A third layer runs on the host with playwright-cli ([docs/agents/verify.md](docs/agents/verify.md)), covering what automation cannot reach: sync behind a login, gestures on real hardware. The rules for opening a PR are in [docs/agents/pull-requests.md](docs/agents/pull-requests.md).

## Stack

Vite + React + TypeScript, [frond](packages/frond/README.md) for rendering and CFI addressing (vertical and horizontal writing are equals, and are verified as equals across all three engines), [Dexie](https://dexie.org/) over IndexedDB.

The rendering layer was epub.js, then its typed fork `@likecoin/epub-ts`, and is now frond. frond was written for Tidemarks, and it takes the half of the app's `src/lib/` that existed only to patch vertical writing back onto the library's side of the line. See [ADR-0003](docs/adr/0003-epub-ts-to-frond.md).

The repository is an npm workspaces monorepo: `packages/app` is the PWA and the Worker, `packages/frond` is the renderer. frond was published to npm until 0.4.15 and now lives here — see [ADR-0017](docs/adr/0017-frond-moves-in-and-stops-being-published.md) and [ADR-0018](docs/adr/0018-one-repo-many-packages.md).

Backend: Cloudflare Workers + D1 + R2, with [@simplewebauthn](https://simplewebauthn.dev/) for passkeys.

Deployment: [docs/deployment.md](docs/deployment.md)

Why it exists: [docs/intent/2026-07-15-spine-cross-device-reading.md](docs/intent/2026-07-15-spine-cross-device-reading.md)

## Contributing

The source is open for the exit it buys: if the hosted service goes away, the reader your library lives in is still something you can run yourself ([ADR-0009](docs/adr/0009-open-source-buys-an-exit-not-contributions.md)). Running a community around it is separate work, and for now the effort goes into building this solo.

So, plainly: issues get read, but a pull request is unlikely to get a timely review and some will get none at all. Better to say that up front than to leave you reading silence. Forking is fine — the licence is MIT, and see `## Where this is going` above for what a feature request would be measured against.

## Licence

MIT, in [LICENSE](LICENSE). Third-party material bundled or vendored here is listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
