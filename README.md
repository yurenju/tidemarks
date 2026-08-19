# Folis

A local-first epub reader, built as a PWA. Everything lives in the browser's IndexedDB, so a book stays readable and writable offline; an optional Cloudflare Worker syncs across devices (sign in with a passkey, or with a code mailed to you — no password either way).

**The only official Folis is [app.folis.ink](https://app.folis.ink).** Any other deployment, whatever it calls itself, is somebody else's — which is the point of the source being readable, but it means the hostname is the thing to check.

繁體中文版：[README.zh-TW.md](README.zh-TW.md)

## Features

- Library: import epubs by drag-and-drop or file picker; the shelf shows covers, progress, accumulated reading time and session count
- Reader: page turns left and right (arrow keys too), jumps from the table of contents, reopens at the last position
- Highlights: select text, pick a colour, optionally attach a note; the sidebar lists highlights in book order and jumps to any of them
- Reading stats: opening a book records a session, and the time accumulates
- Export: one book's notes as markdown; the whole dataset — epub files included — as JSON, so another browser can pick up where this one left off
- Sync (optional): a book imported on the desktop turns up on the phone's shelf, with progress, highlights, notes and stats travelling with it; the epub body itself downloads only when the book is opened

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

The rendering layer was epub.js, then its typed fork `@likecoin/epub-ts`, and is now frond. frond was written for Folis, and it takes the half of the app's `src/lib/` that existed only to patch vertical writing back onto the library's side of the line. See [ADR-0003](docs/adr/0003-epub-ts-to-frond.md).

The repository is an npm workspaces monorepo: `packages/app` is the PWA and the Worker, `packages/frond` is the renderer. frond was published to npm until 0.4.15 and now lives here — see [ADR-0017](docs/adr/0017-frond-moves-in-and-stops-being-published.md) and [ADR-0018](docs/adr/0018-one-repo-many-packages.md).

Backend: Cloudflare Workers + D1 + R2, with [@simplewebauthn](https://simplewebauthn.dev/) for passkeys.

Deployment: [docs/deployment.md](docs/deployment.md)

Why it exists: [docs/intent/2026-07-15-spine-cross-device-reading.md](docs/intent/2026-07-15-spine-cross-device-reading.md)
