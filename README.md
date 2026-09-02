<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/tidemarks-wordmark-dark.svg">
    <img src="docs/brand/tidemarks-wordmark.svg" alt="Tidemarks" width="340">
  </picture>
</p>

Tidemarks is a web app for reading epubs — reading, highlighting and taking notes — built as a PWA that works offline by default.

The hosted site is at https://app.tidemarks.io/

With an account, books, reading progress, highlights and notes sync across your devices. It also speaks MCP (Model Context Protocol), so an AI can read along with you and answer questions about the book.

The hosted sync service syncs three books for free; syncing more is paid. The software is open source, so anyone can stand up and run their own sync service — see [docs/deployment.md](docs/deployment.md).

繁體中文版：[README.zh-TW.md](README.zh-TW.md)

## Features

- Library: import epubs by drag-and-drop or file picker; the shelf shows covers, progress, accumulated reading time and session count
- Reader: page turns left and right (arrow keys too), jumps from the table of contents, reopens at the last position
- Highlights: select text, pick a colour, optionally attach a note; the sidebar lists highlights in book order and jumps to any of them
- Reading stats: opening a book records a session, and the time accumulates
- Export: one book's notes as markdown; the whole dataset — epub files included — as JSON, so another browser can pick up where this one left off
- Sync (optional): a book imported on the desktop turns up on the phone's shelf, with progress, highlights, notes and stats travelling with it; the epub body itself downloads only when the book is opened

## Development

Running it locally, the test layers and the stack: [docs/development.md](docs/development.md) (written in Chinese).

## Contributing

This is an open source project, but running a development community takes energy this project does not have to spare right now, so there is no contribution guide yet.

## Licence

MIT, in [LICENSE](LICENSE). Third-party material bundled or vendored here is listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
