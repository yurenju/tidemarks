/**
 * Tidemarks' half of reader settings: what survives in localStorage (including the two font
 * size migrations, where dropping a choice the reader made is the worse failure), and which
 * frond parameter each choice becomes — a percentage resolved against the reader's own root
 * size, the CJK stacks, dark mode's ink, and the margin and column count that can only be
 * answered once frond has read the writing mode.
 *
 * Nothing here produces CSS or measures a layout. What frond does with these parameters is
 * `packages/frond/tests/node/renderer/settings.test.ts` (the CSS it emits) and
 * `packages/frond/tests/browser/renderer/reader-settings.spec.ts` (that it reaches the page).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  frondLayout,
  frondSettings,
  loadSettings,
  readRootFontSize,
  type RenderContext,
  saveSettings,
} from "./settings";
import { fontStack } from "./chinese";
import type { LoadedWebFont } from "./web-font-store";

function stubStorage() {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe("settings", () => {
  beforeEach(stubStorage);

  it("returns defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips saved settings", () => {
    saveSettings({
      theme: "dark",
      fontFamily: "serif",
      fontSize: 120,
      columns: 1,
      lineHeight: 1.8,
      margin: 16,
    });
    expect(loadSettings()).toEqual({
      theme: "dark",
      fontFamily: "serif",
      fontSize: 120,
      columns: 1,
      lineHeight: 1.8,
      margin: 16,
    });
  });

  it("falls back to defaults on corrupt JSON", () => {
    localStorage.setItem("tidemarks-settings", "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("ignores invalid stored values", () => {
    localStorage.setItem(
      "tidemarks-settings",
      JSON.stringify({
        theme: "neon",
        fontSize: 9000,
        columns: "triple",
        lineHeight: 99,
        fontFamily: "'Some Legacy CSS', serif",
      }),
    );
    const s = loadSettings();
    expect(s.fontFamily).toBe(DEFAULT_SETTINGS.fontFamily);
    expect(s.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(s.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(s.columns).toBe(DEFAULT_SETTINGS.columns);
    expect(s.lineHeight).toBe(DEFAULT_SETTINGS.lineHeight);
  });

  it("keeps 0 (book default) as a valid line height", () => {
    localStorage.setItem("tidemarks-settings", JSON.stringify({ lineHeight: 0 }));
    expect(loadSettings().lineHeight).toBe(0);
  });

  it("fills the margin default for settings saved before the field existed", () => {
    localStorage.setItem("tidemarks-settings", JSON.stringify({ theme: "dark" }));
    expect(loadSettings().margin).toBe(DEFAULT_SETTINGS.margin);
  });

  it("round-trips a valid margin and keeps 0 (none)", () => {
    localStorage.setItem("tidemarks-settings", JSON.stringify({ margin: 0 }));
    expect(loadSettings().margin).toBe(0);
    localStorage.setItem("tidemarks-settings", JSON.stringify({ margin: 48 }));
    expect(loadSettings().margin).toBe(48);
  });

  it("rejects margins outside the option set", () => {
    localStorage.setItem("tidemarks-settings", JSON.stringify({ margin: 999 }));
    expect(loadSettings().margin).toBe(DEFAULT_SETTINGS.margin);
  });
});

// The font size has been through two units: a percentage under epub.js, px under frond, and
// now a percentage again — this time of the reader's own root size. A reader who deliberately
// made their text bigger keeps a comparable size through both, because dropping a setting they
// made is the worse of the two failures.
describe("migrating the font size back to a percentage", () => {
  beforeEach(stubStorage);

  it("converts a stored px against the browser default", () => {
    // 18px was the default, and 18/16 lands between two notches, so it snaps up to 115.
    localStorage.setItem("tidemarks-settings", JSON.stringify({ fontSize: 18 }));
    expect(loadSettings().fontSize).toBe(115);
  });

  it("keeps a larger choice larger", () => {
    localStorage.setItem("tidemarks-settings", JSON.stringify({ fontSize: 24 }));
    expect(loadSettings().fontSize).toBe(150);
  });

  it("lands both ends of the px range on a notch inside the percentage range", () => {
    // Nothing is clamped here, and nothing can be: 14–32px converts to 87.5–200%, which fits
    // inside what the panel offers. The clamp is for the percentages below it, further down.
    localStorage.setItem("tidemarks-settings", JSON.stringify({ fontSize: 14 }));
    expect(loadSettings().fontSize).toBe(90);
    localStorage.setItem("tidemarks-settings", JSON.stringify({ fontSize: 32 }));
    expect(loadSettings().fontSize).toBe(FONT_SIZE_MAX);
  });

  it("leaves a percentage from before the px detour alone", () => {
    // Both percentages were relative to the browser default, so there is nothing to convert —
    // and the ranges cannot overlap, since px topped out at 32 and percentages start at 70.
    localStorage.setItem("tidemarks-settings", JSON.stringify({ fontSize: 160 }));
    expect(loadSettings().fontSize).toBe(160);
  });

  it("clamps an old percentage below the range Tidemarks now offers", () => {
    localStorage.setItem("tidemarks-settings", JSON.stringify({ fontSize: 70 }));
    expect(loadSettings().fontSize).toBe(FONT_SIZE_MIN);
  });

  it("rejects a value in neither vocabulary", () => {
    localStorage.setItem("tidemarks-settings", JSON.stringify({ fontSize: 50 }));
    expect(loadSettings().fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    localStorage.setItem("tidemarks-settings", JSON.stringify({ fontSize: 9000 }));
    expect(loadSettings().fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });
});

// The percentage is a percentage of the reader's own root size, so this is where the basis
// comes from. Tidemarks' own UI is all `rem` and has followed that setting all along; the book
// is the one place that used to ignore it.
describe("readRootFontSize", () => {
  // Restored afterwards: these run under Node with no DOM, so anything left behind would put
  // every later test in this file under a fake `document`.
  const realDocument = globalThis.document;
  const realGetComputedStyle = globalThis.getComputedStyle;

  function stubRoot(fontSize: string) {
    globalThis.document = { documentElement: {} } as unknown as Document;
    globalThis.getComputedStyle = (() => ({ fontSize })) as unknown as typeof getComputedStyle;
  }

  afterEach(() => {
    globalThis.document = realDocument;
    globalThis.getComputedStyle = realGetComputedStyle;
  });

  it("reads what the browser resolved the root to", () => {
    stubRoot("20px");
    expect(readRootFontSize()).toBe(20);
  });

  it("falls back to the browser default when the value makes no sense", () => {
    stubRoot("");
    expect(readRootFontSize()).toBe(16);
    stubRoot("0px");
    expect(readRootFontSize()).toBe(16);
  });
});

describe("frondSettings", () => {
  const base = { ...DEFAULT_SETTINGS };
  // A laptop-sized box, wide enough for two columns but not wide enough for the ceiling to
  // bite — so these cases exercise the mapping rather than `measure.ts`, which has its own
  // tests.
  const context: RenderContext = {
    theme: "light",
    simplified: false,
    rootFontSize: 16,
    script: "cjk",
    webFonts: [],
  };

  it("resolves the reader's percentage against their own root size", () => {
    // frond takes px, and the number it gets is the basis every size in the book is relative
    // to — so the whole point of the percentage is that this multiplication happens here.
    expect(frondSettings({ ...base, fontSize: 100 }, context).fontSize).toBe(16);
    expect(frondSettings({ ...base, fontSize: 150 }, context).fontSize).toBe(24);
  });

  it("hands a reader with a larger browser default a larger book at the same percentage", () => {
    // The reason for the percentage: Tidemarks' own UI has always followed this setting, and the
    // book used to be the one place that did not.
    const roomier = { ...context, rootFontSize: 20 };
    expect(frondSettings({ ...base, fontSize: 100 }, roomier).fontSize).toBe(20);
    expect(frondSettings({ ...base, fontSize: 150 }, roomier).fontSize).toBe(30);
  });

  it("rounds the px it sends, so the stylesheet frond injects stays readable", () => {
    // That text is the only thing visible when investigating a problem, and a root size the
    // browser resolved to a fraction would otherwise drag a repeating decimal into it.
    expect(
      frondSettings({ ...base, fontSize: 115 }, { ...context, rootFontSize: 16.66 }).fontSize,
    ).toBe(19.16);
  });

  it("leaves the margin and the column count out entirely", () => {
    // They cannot be answered here: both need the writing mode, and nothing at this point has
    // it. `frondLayout` answers them when frond asks, which is after it has read the mode and
    // before it lays anything out.
    const frond = frondSettings({ ...base, margin: 32, columns: 2 }, context);
    expect(frond.margin).toBeUndefined();
    expect(frond.columns).toBeUndefined();
  });

  it("leaves the font unset for 'publisher', but still says what serif should mean", () => {
    // The whole point of `genericFamilies`: a reader keeping the book's typography still needs
    // a bare `serif` to land on a face with vertical punctuation glyphs.
    const frond = frondSettings({ ...base, fontFamily: "publisher" }, context);
    expect(frond.fontFamily).toBeUndefined();
    expect(frond.genericFamilies).toEqual({
      serif: fontStack("serif", false),
      sansSerif: fontStack("sans", false),
    });
  });

  it("names the face for an explicit font choice", () => {
    expect(frondSettings({ ...base, fontFamily: "sans" }, context).fontFamily).toBe(
      fontStack("sans", false),
    );
  });

  it("follows the book variant into the stacks", () => {
    const frond = frondSettings({ ...base, fontFamily: "serif" }, { ...context, simplified: true });
    expect(frond.fontFamily).toBe(fontStack("serif", true));
    expect(frond.genericFamilies?.serif).toBe(fontStack("serif", true));
  });

  it("maps the book-default line height to no setting at all", () => {
    // `undefined` and 0 are different things to frond: unset means it injects nothing and the
    // book's own line height stands.
    expect(frondSettings({ ...base, lineHeight: 0 }, context).lineHeight).toBeUndefined();
    expect(frondSettings({ ...base, lineHeight: 1.8 }, context).lineHeight).toBe(1.8);
  });

  it("only sets a theme for dark mode", () => {
    // Light mode leaves the book's own colours alone, which is what the reader gets today.
    expect(frondSettings(base, context).theme).toBeUndefined();
    expect(frondSettings(base, { ...context, theme: "dark" }).theme).toMatchObject({
      background: "#1b1b1e",
    });
  });
});

describe("frondSettings with the faces Tidemarks carries", () => {
  const base = { ...DEFAULT_SETTINGS };
  const context: RenderContext = {
    theme: "light",
    simplified: false,
    rootFontSize: 16,
    script: "cjk",
    webFonts: [],
  };
  const carried = (kind: "serif" | "sans", weight = 400): LoadedWebFont => ({
    family: kind === "serif" ? "Noto Serif CJK TC" : "Noto Sans CJK TC",
    kind,
    weight,
    src: `blob:tidemarks/${kind}-${weight}`,
  });

  it("changes nothing at all while no face has been fetched", () => {
    // Offline, or a book with no Han characters in it. What the reader gets is what they got
    // before Tidemarks carried any font — not an error, and not a different stack.
    expect(frondSettings(base, context).genericFamilies).toEqual({
      serif: fontStack("serif", false),
      sansSerif: fontStack("sans", false),
    });
  });

  // The stacks name our copy first already (`chinese.ts`), but only in the row matching the
  // book's variant: a Simplified book leads with `Noto Serif CJK SC`, which is a face Tidemarks
  // does not carry. Left alone, a reader who happens to have that installed would be served
  // their copy instead of ours — and "the same font on every machine" is the whole point.
  it("puts the fetched face first even when the book leads with the other variant", () => {
    const simplified = { ...context, simplified: true, webFonts: [carried("serif")] };
    const families = frondSettings(base, simplified).genericFamilies?.serif?.split(", ");
    expect(families?.[0]).toBe("'Noto Serif CJK TC'");
    // and it moves rather than being duplicated
    expect(families?.filter((f) => f === "'Noto Serif CJK TC'")).toHaveLength(1);
  });

  it("moves the face to the front of an explicitly chosen font too", () => {
    const withFace = { ...context, simplified: true, webFonts: [carried("serif")] };
    expect(frondSettings({ ...base, fontFamily: "serif" }, withFace).fontFamily).toMatch(
      /^'Noto Serif CJK TC'/,
    );
  });

  it("leaves the sans stack alone when only the serif face was fetched", () => {
    const serifOnly = { ...context, simplified: true, webFonts: [carried("serif")] };
    expect(frondSettings(base, serifOnly).genericFamilies?.sansSerif).toBe(fontStack("sans", true));
  });
});

describe("frondLayout", () => {
  const base = { ...DEFAULT_SETTINGS };
  const context = { rootFontSize: 16, script: "cjk" as const, webFonts: [] };
  // A laptop-sized box, wide enough for two columns but not wide enough for the ceiling to
  // bite — so these cases exercise the mapping rather than `line-length.ts`, which has its
  // own tests.
  const horizontal = {
    writingMode: "horizontal-tb" as const,
    viewport: { width: 1344, height: 821 },
  };

  it("sends the margin along the inline axis, the one that controls line length", () => {
    // frond lands that axis on the physical edges itself, so one number covers both
    // directions — this used to be two hand-written cases of wrapper padding.
    expect(frondLayout({ ...base, margin: 32 }, context, horizontal).margin).toEqual({
      block: 16,
      inline: 32,
    });
  });

  it("settles the column count itself rather than handing frond `auto`", () => {
    // frond's own `'auto'` splits at a fixed 700px, which is what puts 22 ideographs in a
    // column on a tablet held landscape. The count that goes across is already decided.
    expect(frondLayout({ ...base, columns: "auto" }, context, horizontal).columns).toBe(2);
    expect(frondLayout({ ...base, columns: 1 }, context, horizontal).columns).toBe(1);
    expect(frondLayout({ ...base, columns: 2 }, context, horizontal).columns).toBe(2);
  });

  it("turns the width past the ceiling into margin rather than into a longer line", () => {
    // Same settings, a wider screen: the reader's 32px is not what comes out the other end.
    const wide = { ...horizontal, viewport: { width: 2464, height: 1361 } };
    expect(frondLayout(base, context, horizontal).margin).toEqual({ block: 16, inline: 32 });
    expect(frondLayout(base, context, wide).margin).toEqual({ block: 16, inline: 476 });
  });

  it("measures the line down the page for a vertical book", () => {
    // **The reason this function takes facts from frond rather than guessing.** Same box,
    // same settings, the other writing mode: the ceiling is computed against the height, so
    // the answer is a different number on a different pair of edges.
    const box = { width: 2464, height: 1361 };
    const vertical = { writingMode: "vertical-rl" as const, viewport: box };

    expect(frondLayout(base, context, vertical).margin).toEqual({ block: 16, inline: 313 });
    expect(frondLayout(base, context, vertical).columns).toBe(1);
    expect(frondLayout(base, context, { ...horizontal, viewport: box }).margin).toEqual({
      block: 16,
      inline: 476,
    });
  });

  it("measures the ems against the size frondSettings sends, not the raw percentage", () => {
    // The two have to agree: a ceiling of 40 ems means nothing if it is 40 of a different em
    // from the one the text is actually set in.
    // One column, so the leftover is one line's worth and the gap does not come into it.
    const settings = { ...base, fontSize: 115, columns: 1 as const };
    const rootFontSize = 16.66;
    const fontSize = frondSettings(settings, {
      ...context,
      theme: "light",
      simplified: false,
      rootFontSize,
    }).fontSize;

    const wide = { ...horizontal, viewport: { width: 4000, height: 1361 } };
    const margin = frondLayout(settings, { ...context, rootFontSize }, wide).margin;

    // Under the ceiling the leftover is the margin, so the line is exactly 40 of that em.
    const inline = typeof margin === "object" ? margin.inline : 0;
    expect(4000 - 2 * inline).toBeCloseTo(40 * (fontSize ?? 0), 0);
  });
});
