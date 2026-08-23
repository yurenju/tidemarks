// The ways a synthetic fixture can stop carrying its ailment **without anything else going
// red** — a false green nobody would see: the `@import` written as `url()`, a plate that no
// longer overflows, hidden notes that are no longer last. Whether the ailment is present at
// all is single-ailment.test.ts's probes (set equality, so an ailment that vanishes fails
// there); what the ailment then does to a reader is the browser layer's
// (tests/browser/renderer/), and how frond reads it is tests/node/epub-book/'s.
import { describe, expect, test } from "vitest";
import { PNG } from "pngjs";
import { openEpub, type EpubArchive, type TocNode } from "../support/epub-archive.ts";
import { buildEpub } from "../../../src/test-fixtures/epub.ts";
import { buildFixture, type AilmentName } from "../../../src/test-fixtures/index.ts";

function open(name: AilmentName): EpubArchive {
  return openEpub(buildFixture(name));
}

describe("the stylesheet behind an @import", () => {
  test("writing-mode-behind-import: the <link>ed stylesheet is a single @import string", () => {
    const book = open("writing-mode-behind-import");

    // The quoted spelling rather than `url()` — that is the one measured in the sample,
    // and an implementation recognizing only `url()` is exactly what loses in this slot.
    // Written as `url()` the book still lays out vertically everywhere, so the browser
    // layer stays green and the fixture quietly stops playing its part.
    expect(book.stylesheet).toMatch(/@import\s*"book-style\.css"\s*;/);
    expect(book.stylesheet).not.toContain("url(");

    // Not one layout intention is in this file. Leaving any behind would have those
    // declarations absorb part of the "the whole stylesheet disappears" symptom, and the
    // fixture would no longer be a clean slot.
    expect(book.stylesheet).not.toMatch(/writing-mode/);
    expect(book.stylesheet).not.toMatch(/font-family/);
  });

  test("writing-mode-behind-import and vertical-japanese differ only in which file holds the declaration", () => {
    // What makes this pair hold: the declarations are identical character for character,
    // and the only difference is which file those bytes live in. If they differed in more
    // than that, "why is one book vertical and the other horizontal" would no longer have
    // the @import as its only explanation.
    const behindImport = open("writing-mode-behind-import");
    const inline = open("vertical-japanese");
    const imported = behindImport.manifest.find((item) => item.href === "book-style.css")!;

    expect(imported.mediaType).toBe("text/css");
    expect(behindImport.text(imported.archivePath)).toBe(inline.stylesheet);
  });
});

describe("shapes in manifest hrefs", () => {
  test("an href escaping the package root is blocked rather than silently corrected", () => {
    // "`../` is conforming" and "`../` always passes" are two different things: one more
    // `..` steps outside the package, and that really is non-conforming. ADR-0007 requires
    // illegal combinations to throw inside the generator — silently clamping to the
    // package root would let this spec produce a book that looks perfectly normal.
    expect(() =>
      buildEpub({
        title: "frond fixture",
        language: "ja",
        identifier: "urn:uuid:frond-fixture-probe",
        stylesheet: "html { line-height: 1.8; }\n",
        readingOrder: [{ path: "section-1.xhtml", title: "朝", body: "    <p>朝。</p>" }],
        resources: [
          {
            path: "../../outside.js",
            mediaType: "application/javascript",
            contents: Uint8Array.of(1),
          },
        ],
      }),
    ).toThrow(/package root/);
  });
});

/**
 * A nested TOC — one per vehicle, the same tree.
 *
 * What the tree looks like (labels, depth, which entries carry a fragment) is asserted
 * against the product in tests/node/epub-book/toc.test.ts. What is left here is the part
 * that tree cannot see: an anchor that does not exist, and an NCX whose own bookkeeping
 * disagrees with its nesting.
 */
describe("a nested TOC", () => {
  const NESTED = ["nested-toc", "nested-toc-epub2"] as const;

  test.for(NESTED)(
    "%s's fragment-carrying second level points at real anchors",
    (name: AilmentName) => {
      const book = open(name);
      const withFragment = book.toc.filter((entry) => entry.href.includes("#"));

      expect(withFragment.length).toBeGreaterThan(0);
      for (const entry of withFragment) {
        const fragment = entry.href.slice(entry.href.indexOf("#") + 1);
        // Pointing nowhere would give this fixture a second ailment beyond "the TOC has two
        // levels", and nothing else reports it: frond resolves the entry to its Section
        // either way, so every layer above stays green.
        expect(book.text(entry.archivePath), entry.href).toContain(`id="${fragment}"`);
      }
    },
  );

  test("nested-toc-epub2: playOrder is continuous across levels, and dtb:depth matches", () => {
    const book = open("nested-toc-epub2");
    const ncx = book.text(book.navigationPath);

    // playOrder numbers the whole tree flattened, rather than restarting from 1 at each
    // level — the flat NCX in the sample runs 1..48 continuously, and the nested one is
    // continuous too. frond reads neither field, so both are the NCX's own conformance and
    // nothing above this file would notice.
    const order = [...ncx.matchAll(/playOrder="(\d+)"/g)].map((match) => Number(match[1]));
    expect(order).toEqual([1, 2, 3, 4, 5, 6, 7]);

    // The depth the NCX declares has to match the actual number of levels. Pinned at 1, an
    // implementation deciding whether to descend from this field alone never sees the
    // second level.
    expect(ncx).toContain('<meta name="dtb:depth" content="2"/>');
    expect(depthOf(book.tocTree)).toBe(2);
  });

  test("a flat TOC still declares dtb:depth=1", () => {
    // The depth is computed, not a constant edited along with the nested fixture.
    expect(open("healthy-epub2").text("EPUB/toc.ncx")).toContain(
      '<meta name="dtb:depth" content="1"/>',
    );
  });
});

/**
 * How many levels the tree has. `epub.ts`'s `tocDepth` is the same reduce, **written out
 * twice deliberately**: checking the depth the code under test writes into `dtb:depth`
 * against the depth that same code computed would have both sides wrong together and the
 * tests still green.
 */
function depthOf(nodes: readonly TocNode[]): number {
  return nodes.reduce((deepest, node) => Math.max(deepest, 1 + depthOf(node.children)), 0);
}

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

describe("sections with no text of their own", () => {
  test("empty-and-image-only-sections: one empty, one holding only an image", () => {
    const book = open("empty-and-image-only-sections");
    const bodies = book.readingOrder.map((section) => bodyOf(book.text(section.archivePath)));

    // Which section is which is load-bearing above: location.spec.ts asks whether an empty
    // section turns the progress fraction into NaN, and with a section that has text after
    // all that case passes without ever touching the code it exists for. The probe next
    // door only asks "some section has no <p>", so it cannot tell the two kinds apart.
    expect(bodies.filter((body) => body.trim() === "").length).toBe(1);

    const imageOnly = bodies.filter((body) => body.includes("<img") && !/<p[\s>]/.test(body));
    expect(imageOnly.length).toBe(1);
  });

  test("empty-and-image-only-sections: the image is a real PNG and is declared in the manifest", () => {
    const book = open("empty-and-image-only-sections");
    const image = book.manifest.find((item) => item.mediaType === "image/png");

    expect(image).toBeDefined();
    const bytes = book.bytes(image!.archivePath);
    expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE);

    // Really decode it with pngjs. Matching only the signature would pass a PNG with a
    // broken IDAT, a miscomputed CRC or a reversed adler32 — and that image is a broken
    // image icon in the browser, not a plate, which no assertion above ever looks at.
    const decoded = PNG.sync.read(Buffer.from(bytes));
    expect(decoded.width).toBe(96);
    expect(decoded.height).toBe(128);
  });
});

/**
 * The plate that overflows its column.
 *
 * Every assertion here is a precondition for rendering.spec.ts's geometry: that group
 * asserts the image ends up no taller than the column, and a plate that was never too tall
 * satisfies it without measuring anything.
 */
describe("a plate taller than a page", () => {
  test("plate-taller-than-page: the image is wrapped in a div that declares no height", () => {
    const book = open("plate-taller-than-page");
    const body = bodyOf(book.text(book.readingOrder.at(-1)!.archivePath));

    expect(body).toContain('<div class="plate"><img src="images/tall-plate.png"');

    // The wrapper **must declare no height** — this fixture's whole mechanism rests on
    // "the containing block's height is indefinite", and the moment that layer has a
    // definite height, `max-block-size: 100%` resolves and the fixture is no longer ill.
    expect(book.stylesheet).toMatch(/\.plate\s*\{[^}]*\}/);
    expect(/\.plate\s*\{([^}]*)\}/.exec(book.stylesheet)?.[1]).not.toMatch(/height|block-size/);
  });

  test("plate-taller-than-page: the image really is taller than a page", () => {
    const book = open("plate-taller-than-page");
    const image = book.manifest.find((item) => item.mediaType === "image/png");
    const decoded = PNG.sync.read(Buffer.from(book.bytes(image!.archivePath)));

    // In an 800x600 viewport, after the reader margins, a column is about 552px along the
    // block axis. The image has to exceed that clearly, or this fixture proves nothing.
    expect(decoded.height).toBeGreaterThan(600);
    // A tall, narrow ratio: it fits along the inline axis and does not along the block
    // axis — so the book's own max-width is harmless here, and any overflow can only come
    // from the block axis side.
    expect(decoded.width).toBeLessThan(decoded.height / 5);
  });

  test("plate-taller-than-page: the book itself only constrains the inline axis", () => {
    const book = open("plate-taller-than-page");

    // The shape of real books: `max-width: 100%` (the inline axis) is there, and the block
    // axis has no bound.
    expect(book.stylesheet).toMatch(/\.plate img\s*\{[^}]*max-inline-size:\s*100%/);
    expect(/\.plate img\s*\{([^}]*)\}/.exec(book.stylesheet)?.[1]).not.toMatch(
      /max-block-size|max-height/,
    );
  });
});

describe("content hidden inside a content document", () => {
  test("hidden-trailing-notes: the notes come after the body text, and are the last thing there", () => {
    const book = open("hidden-trailing-notes");
    const body = bodyOf(book.text(book.readingOrder.at(-1)!.archivePath));

    // Position is the whole of this ailment. Were the notes not last, the final text node
    // in document order would be visible body text — and that book is healthy, so
    // pagination.spec.ts's "the page count follows the body text" would be green over a
    // book that never had the defect.
    const firstNote = body.indexOf('<div class="note"');
    expect(firstNote).toBeGreaterThan(0);
    expect(
      body
        .slice(firstNote)
        .replaceAll(/<div class="note"[\s\S]*?<\/div>/g, "")
        .trim(),
      "Nothing should follow the notes — that would make the last text node visible again.",
    ).toBe("");

    expect(book.stylesheet).toMatch(/\.note\s*\{[^}]*display:\s*none/);
  });

  test("hidden-trailing-notes: only the last section is touched; the earlier ones stay healthy", () => {
    const book = open("hidden-trailing-notes");
    const healthy = open("vertical-japanese");

    // No probe next door watches this ailment, so this is the only place "it spread to the
    // other sections" can be seen. The readingOrder's length does not change either —
    // "the readingOrder has only one Section" is huge-single-section's ailment, and the two
    // must stay separable.
    expect(book.readingOrder.length).toBe(healthy.readingOrder.length);
    for (const [index, section] of book.readingOrder.slice(0, -1).entries()) {
      expect(book.text(section.archivePath)).toBe(
        healthy.text(healthy.readingOrder[index]!.archivePath),
      );
    }
  });
});

function bodyOf(document: string): string {
  return document.slice(document.indexOf("<body>") + "<body>".length, document.indexOf("</body>"));
}
