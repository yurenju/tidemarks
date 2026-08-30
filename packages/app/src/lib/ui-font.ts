/**
 * The carried CJK face, lent to Tidemarks' own chrome.
 *
 * The interface is set in a serif (docs/design-system.md), and the Latin half of that is a
 * face shipped with the app. The Han half is not: `Noto Serif CJK TC` is 16 MB for Regular
 * alone, and a shelf that cannot be read until it arrives is not a shelf. So the chrome names
 * the platform's serif stack and takes what the machine has.
 *
 * A reader who picked [[Serif]] has our copy on this device already, though, and the book is
 * rendered inside an iframe (frond's ADR-0006) — `@font-face` is per-document, so the face
 * frond declares in there reaches not one character of the shelf. Registering the same bytes
 * on this document is what lets the interface use them, and it costs no download: the blob is
 * already in IndexedDB.
 *
 * **Only at startup, and only the serif.** Registering the moment a download finishes would
 * change the interface's typeface under the reader's eyes — and they are looking right at it,
 * because the progress line they are watching is in the panel that would redraw. Waiting for
 * the next open makes the same change unobserved. Serif and not whatever `fontFamily` says,
 * because that setting means "how should the **book** look"; letting it retypeset the chrome
 * as well would be widening the word behind the reader's back.
 */

import { db } from "./db";
import { storedFontUrl } from "./web-font-store";
import { carriedFontKinds, weightAxis, WEB_FONTS, type WebFont } from "./web-font";

/**
 * Which carried faces the chrome should be drawn in, given the keys this device holds.
 *
 * Empty unless the serif is here. There is one file and it answers for every weight, so the
 * old hazard is gone — the chrome can no longer end up with real body text beside headings
 * the browser outlined for itself.
 */
export function uiFontFaces(storedKeys: readonly string[]): readonly WebFont[] {
  if (!carriedFontKinds(storedKeys).serif) return [];
  return WEB_FONTS.filter((font) => font.kind === "serif");
}

/**
 * Hands the stored serif to this document, if it is stored.
 *
 * `display: "swap"` is load-bearing rather than a preference: the parse of 16 MB is measured
 * in hundreds of milliseconds (`web-font-store.ts`), and the default would hold the text
 * invisible for that long. Swapping means the shelf draws in the platform face and changes to
 * ours a moment later, which is the same trade the book makes.
 *
 * Failure is silence by design. Every branch here ends in "the interface keeps the face the
 * platform gave it", which is exactly what a reader who never downloaded anything sees.
 */
export async function registerUiFonts(): Promise<void> {
  if (typeof FontFace !== "function") return;

  let keys: string[];
  try {
    keys = (await db.fonts.toCollection().primaryKeys()).map(String);
  } catch {
    return;
  }

  for (const font of uiFontFaces(keys)) {
    try {
      const src = await storedFontUrl(font);
      if (src === null) continue;
      // **The whole axis, not the reader's two weights.** Those two belong to the book: they
      // are what the reader chose for reading in, and the chrome has its own scale — 600 for
      // a section heading, 400 for a label (`styles/`). Declared with the book's pair, a 600
      // in the interface would draw at the book's bold weight and the chrome's hierarchy
      // would come out flattened onto two steps.
      const face = new FontFace(font.family, `url(${src})`, {
        weight: weightAxis(font.kind),
        display: "swap",
      });
      document.fonts.add(await face.load());
    } catch {
      // The face was in the store a moment ago, so getting here means the read or the parse
      // failed. The chrome keeps the face the platform gave it.
    }
  }
}
