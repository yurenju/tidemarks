// Whether a fixture really is the EPUB version its name claims — the fixtures' second axis
// (ADR-0007, ADR-0010). The version going astray turns **every EPUB 2 fixture into "an
// EPUB 3 with an NCX attached"**, the backward-compatibility route rather than the shape
// books actually have, and every layer above keeps reading those books happily. How frond
// then reads either version is tests/node/epub-book/'s (toc.test.ts, cover.test.ts).
import { describe, expect, test } from "vitest";
import { openEpub, type EpubArchive } from "../support/epub-archive.ts";
import { buildEpub } from "../../../src/test-fixtures/epub.ts";
import {
  buildFixture,
  syntheticFixtures,
  type AilmentName,
} from "../../../src/test-fixtures/index.ts";

function open(name: AilmentName): EpubArchive {
  return openEpub(buildFixture(name));
}

describe("the EPUB 2 version", () => {
  test("the navigation document is an NCX, and the archive has no nav.xhtml at all", () => {
    const book = open("healthy-epub2");

    expect(book.navigationVehicle).toBe("ncx");
    expect(book.navigationPath).toBe("EPUB/toc.ncx");
    expect(book.entryPaths.filter((path) => path.endsWith("nav.xhtml"))).toEqual([]);
    // properties is an attribute only an EPUB 3 manifest has. An EPUB 2 carrying it is the
    // "EPUB 3 with an NCX attached" hybrid rather than the shape books actually have.
    expect(book.manifest.filter((item) => item.properties !== undefined)).toEqual([]);
  });

  test("the NCX is declared in the manifest, and the readingOrder points at it via spine's toc attribute", () => {
    const book = open("healthy-epub2");
    const ncx = book.manifest.find((item) => item.mediaType === "application/x-dtbncx+xml");

    expect(ncx).toBeDefined();
    expect(book.readingOrderTocId).toBe(ncx!.id);
  });

  test("every navPoint in the NCX has a navLabel, a content and a playOrder", () => {
    const book = open("healthy-epub2");
    const ncx = book.text(book.navigationPath);

    expect(book.toc.length).toBeGreaterThan(0);
    for (const entry of book.toc) {
      expect(entry.label).not.toBe("");
      expect(entry.href).not.toBe("");
    }
    // playOrder is the NCX's own reading-order declaration, and its count has to match the
    // navPoints — one short means a navPoint is missing it.
    expect([...ncx.matchAll(/<navPoint /g)].length).toBe(book.toc.length);
    expect([...ncx.matchAll(/playOrder="\d+"/g)].length).toBe(book.toc.length);
    expect([...ncx.matchAll(/<navLabel>/g)].length).toBe(book.toc.length);
  });

  test("no dcterms:modified — EPUB 2 has no such field", () => {
    const book = open("healthy-epub2");

    expect(book.text(book.packageDocumentPath)).not.toContain("dcterms:modified");
  });
});

describe("EPUB 3 was left untouched", () => {
  const epub3 = syntheticFixtures
    .filter((fixture) => fixture.epubVersion === "epub3")
    .map((fixture) => fixture.name);

  test.for(epub3)(
    '%s still declares version="3.0", and its navigation document is still a nav',
    (name) => {
      const book = open(name);

      expect(book.packageVersion).toBe("3.0");
      expect(book.navigationVehicle).toBe("nav");
    },
  );

  test.for(epub3)("%s has no NCX", (name) => {
    // Real EPUB 3s nearly always carry an NCX as well (ADR-0010: 31 of the 33 books in the
    // sample have both), but that NCX only has testing value when "the two navigation
    // vehicles disagree". #23 grew the TOC ailments onto the NCX by way of "the EPUB 2
    // version of the same ailment" (the `-epub2` suffix), and left this boundary alone.
    // Until a ticket calls for both vehicles side by side, EPUB 3 fixtures carry no NCX, so
    // that "an NCX is present" means EPUB 2.
    expect(open(name).entryPaths.filter((path) => path.endsWith(".ncx"))).toEqual([]);
  });
});

describe("the EPUB version is written in the filename", () => {
  test.for(syntheticFixtures)(
    "$fileName's suffix matches its EPUB version",
    (fixture: (typeof syntheticFixtures)[number]) => {
      // Only the non-default version carries a suffix: no suffix means EPUB 3. The
      // one-to-one between a committed fixture and its filename is where a red test's
      // readability comes from, so the version has to be visible.
      expect(fixture.fileName.endsWith("-epub2.epub")).toBe(fixture.epubVersion === "epub2");
    },
  );

  test.for(syntheticFixtures)(
    "the version $fileName declares matches the <package version> in its bytes",
    (fixture: (typeof syntheticFixtures)[number]) => {
      const expected = fixture.epubVersion === "epub2" ? "2.0" : "3.0";

      expect(open(fixture.name).packageVersion).toBe(expected);
    },
  );
});

describe("illegal combinations of version and cover declaration form are blocked", () => {
  // These two block #23 and #24: both add fixtures to this generator, and both of these
  // combinations produce non-conforming books — non-conforming in a silent way (one extra
  // attribute, one extra field), with nothing going red.
  const minimal = {
    title: "frond fixture",
    language: "ja",
    identifier: "urn:uuid:frond-fixture-probe",
    stylesheet: "html { line-height: 1.8; }\n",
    readingOrder: [{ path: "section-1.xhtml", title: "朝", body: "    <p>朝。</p>" }],
  } as const;

  test("an EPUB 2 may not carry a page-progression-direction", () => {
    expect(() =>
      buildEpub({ ...minimal, epubVersion: "epub2", pageProgressionDirection: "rtl" }),
    ).toThrow(/page-progression-direction/);
  });

  test('an EPUB 2 cover may not go through properties="cover-image"', () => {
    expect(() =>
      buildEpub({
        ...minimal,
        epubVersion: "epub2",
        cover: {
          path: "images/cover.png",
          mediaType: "image/png",
          contents: Uint8Array.of(1),
          declaredBy: ["cover-image-property"],
        },
      }),
    ).toThrow(/properties/);
  });
});
