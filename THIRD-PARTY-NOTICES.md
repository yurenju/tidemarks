# Third-party notices

This file covers material incorporated into the repository as a whole rather than
into any one package, which is why it sits at the root. Everything it describes
is test material: none of it is served to a browser or bundled into a deployment.

`packages/frond` keeps a pointer here rather than a copy of its own — a second
copy would be a second thing to keep in sync.

## foliate-js

<https://github.com/johnfactotum/foliate-js>

frond is a reimplementation, not a port: no foliate-js code is used in
`packages/frond/src/`, and foliate-js is not a dependency
([frond ADR-0001](packages/frond/docs/adr/0001-reimplementation-not-port.md)).

What *is* incorporated is upstream's `tests/epubcfi-tests.js` — the CFI strings
and comparison cases from it are used verbatim as an acceptance table in
`packages/frond/tests/node/cfi/foliate-acceptance.test.ts`. That file is test
material, but it lives in this public repository and so carries the notice below.

```
MIT License

Copyright (c) 2022 John Factotum

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The browser quirk knowledge recorded in `packages/frond/docs/browser-quirks.md`
was learned by reading foliate-js, but knowledge is not code and carries no
licence obligation (frond ADR-0001).

## The public-domain books in `tests/books/`

Two complete EPUB publications are redistributed in this repository, as the
second layer of test material in
[frond ADR-0007](packages/frond/docs/adr/0007-test-fixtures.md). They sit at the
root rather than inside a package because both packages' browser suites open the
same two files. Both are trimmed rather than verbatim:
`scripts/trim-public-books.ts` is the trim, and that ADR records what came out of
each. Neither is a dependency; they exist so
that a change to layout can be judged against a real book before a pull request.

### Kusamakura (草枕) — `kusamakura-vertical-japanese.epub`

An EPUB 3 sample publication of Natsume Sōseki's *Kusamakura*, produced by the
Japanese EPUB Specification Settlement Project (EPUB日本語拡張仕様策定プロジェクト)
from the Aozora Bunko transcription.

- Sample collection: <https://idpf.github.io/epub3-samples/30/samples.html>
- Source repository: <https://github.com/IDPF/epub3-samples>
- Text source: <https://www.aozora.gr.jp/cards/000148/card776.html>

The underlying work is in the public domain — Natsume Sōseki died in 1916.

The sample collection states: "Unless otherwise specified, all samples listed
here are licensed under CC-BY-SA 3.0" (<https://creativecommons.org/licenses/by-sa/3.0/>).
The Kusamakura entry carries no per-sample override. The publication's own
package document specifies something more permissive, and that specification is
what this copy relies on:

```
<meta property="dcterms:rights">EPUB日本語拡張仕様策定プロジェクト</meta>
<meta property="dcterms:license" scheme="xsd:anyURI"
      >http://creativecommons.org/publicdomain/zero/1.0/</meta>
```

The two media-overlay narration files in the original were the one exception —
they alone were licensed CC-BY-NC-SA 3.0, recorded by their own `dcterms:license`
statements. **They are not in this copy.** The trim removes them, and removes
those licence statements with them; nothing under a non-commercial term remains.

### Alice's Adventures in Wonderland — `alice-in-wonderland-horizontal.epub`

Lewis Carroll's *Alice's Adventures in Wonderland* (1865) with John Tenniel's
illustrations, as edited and typeset by Standard Ebooks.

- Ebook: <https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel>
- Source repository: <https://github.com/standardebooks/lewis-carroll_alices-adventures-in-wonderland_john-tenniel>

Standard Ebooks' edition is based on a Project Gutenberg transcription produced
in 2008 by Arthur DiBianca and David Widger, and on digital scans from the
Internet Archive. It is re-typeset and carries no Project Gutenberg header or
footer, so no Project Gutenberg trademark term applies to it.

The publication's `dc:rights`, reproduced verbatim:

```
The source text and artwork in this ebook are believed to be in the United
States public domain; that is, they are believed to be free of copyright
restrictions in the United States. They may still be copyrighted in other
countries, so users located outside of the United States must check their local
laws before using this ebook. The creators of, and contributors to, this ebook
dedicate their contributions to the worldwide public domain via the terms in the
CC0 1.0 Universal Public Domain Dedication
(https://creativecommons.org/publicdomain/zero/1.0/).
```

The cover image of the original edition is adapted from *Amanita*, an 1879
painting by Ivan Shishkin. The cover and title pages use League Spartan and Sorts
Mill Goudy, created by The League of Moveable Type.
