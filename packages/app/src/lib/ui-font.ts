/**
 * The carried CJK face, lent to Folis's own chrome.
 *
 * The interface is set in a serif (docs/design-system.md), and the Latin half of that is a
 * face shipped with the app. The Han half is not: `Noto Serif CJK TC` is 16 MB for Regular
 * alone, and a shelf that cannot be read until it arrives is not a shelf. So the chrome names
 * the platform's serif stack and takes what the machine has.
 *
 * A reader who picked 明體 has our copy on this device already, though, and the book is
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
import { carriedFontKinds, WEB_FONTS, type WebFont } from "./web-font";

/**
 * Which carried faces the chrome should be drawn in, given the keys this device holds.
 *
 * Empty unless the serif is here **in both weights**: half a family is worse than none of it,
 * because the bold headings would then be the browser's outlining of our Regular while the
 * body around them is the real face, and the two do not look like the same typeface.
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
      const face = new FontFace(font.family, `url(${src})`, {
        weight: String(font.weight),
        display: "swap",
      });
      document.fonts.add(await face.load());
    } catch {
      // Both weights were in the store a moment ago, so getting here means the read or the
      // parse failed. Carrying on gives the other weight its chance; the chrome falls back
      // per character, so a Regular with no Bold is still most of the interface in our face.
    }
  }
}
