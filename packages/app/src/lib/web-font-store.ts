/**
 * Getting a carried face onto this device and back out as something a book can load.
 *
 * The "which and whether" half is `web-font.ts`; this is the half that touches the network,
 * IndexedDB and `URL.createObjectURL`.
 *
 * ## Why the bytes come back as a `blob:` URL
 *
 * The book renders inside an iframe frond creates from a Blob, and **a `blob:` iframe is not
 * under service worker control in Chromium** — so a face served from spine's own https URL
 * and cached by the service worker is simply missing there when the reader is offline.
 * Handing the book a `blob:` URL built from bytes already in IndexedDB is the one route all
 * three engines load offline. That is also why the face is not in the service worker's
 * precache: `vite.config.ts`'s `globPatterns` deliberately omits `woff2`.
 */

import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { db } from "./db";
import { staleFontKeys, webFontKey, type WebFont, type WebFontKind } from "./web-font";

export interface WebFontProgress {
  received: number;
  /** `null` when the server declared no `Content-Length` — a total nobody knows. */
  total: number | null;
}

export type WebFontStatus =
  | { state: "stored" }
  | { state: "downloading"; progress: WebFontProgress }
  /**
   * Offline, or the fetch failed. The reader stays on the platform stack; the caller says so
   * once, in a toast (`WEB_FONT_UNAVAILABLE_NOTE`), rather than leaving a picked face to change
   * nothing without a word — see ADR-0014, on what the reader is shown while it downloads.
   */
  | { state: "unavailable" };

/**
 * A face as frond takes it: a family name and somewhere to load the bytes from.
 *
 * No weight, because the file is variable and answers for the whole axis. Which weights it
 * is *declared* under is the reader's setting rather than the file's property, and
 * `frondSettings` decides it (`web-font.ts`'s `faceWeightDescriptors`).
 *
 * `kind` is not frond's — it is carried along so `frondSettings` can put the family in front
 * of the right stack, and pick the two weights, without looking the face up again.
 */
export interface LoadedWebFont {
  family: string;
  kind: WebFontKind;
  src: string;
}

type Fetcher = (url: string) => Promise<Response>;

const defaultFetch: Fetcher = (url) => fetch(url);

/**
 * Fetches a face, reporting what has arrived as it arrives.
 *
 * The body is read in chunks rather than awaited whole because 16 MB over a phone connection
 * is long enough that a reader deserves to see it moving. The fetcher is a parameter so the
 * progress arithmetic can be tested without a server.
 */
export async function downloadWebFont(
  font: WebFont,
  onProgress: (progress: WebFontProgress) => void,
  fetchImpl: Fetcher = defaultFetch,
): Promise<Blob> {
  const response = await fetchImpl(font.path);
  if (!response.ok) throw new Error(`${font.path}: ${response.status}`);

  const declared = response.headers.get("content-length");
  const total = declared === null ? null : Number(declared);
  const body = response.body;
  // No readable stream to follow (a test double, or an engine that gave none) — the bytes
  // still arrive, there is just nothing to report until they have.
  if (!body) return await response.blob();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress({ received, total });
  }

  return new Blob(chunks as BlobPart[], { type: "font/woff2" });
}

/**
 * The URL handed to the book for each face, built once and kept.
 *
 * **Never rebuilt on the settings path.** `@font-face` is per-document and every settings
 * change rebuilds that document, so a fresh object URL each time would re-parse the face —
 * and what the font cache is keyed on is the URL, not the Blob. Measured on this repo's
 * three engines, re-parsing 15.94 MB costs chromium 571 ms, firefox 576 ms and webkit
 * 244 ms; against a kept URL the second parse is 2 ms. Rebuilding would mean half a second
 * of stall on every drag of the font-size slider.
 */
const objectUrls = new Map<string, string>();

function objectUrlFor(key: string, file: Blob): string {
  const existing = objectUrls.get(key);
  if (existing) return existing;
  const url = URL.createObjectURL(file);
  objectUrls.set(key, url);
  return url;
}

/**
 * What the settings panel says about the face, in the reader's own language.
 *
 * A line rather than a spinner or a bar: the fetch does not block anything, so what it needs
 * to do is answer "why does the serif look like it always did" for the minute or two it is
 * running, and then stop being interesting.
 */
export function webFontNote(i18n: I18n, status: WebFontStatus | null): string | null {
  if (status === null) return null;

  switch (status.state) {
    case "downloading": {
      const { received, total } = status.progress;
      // Bytes rather than a percentage when the server declared no total. A percentage
      // invented from nothing is a bar that jumps backwards.
      if (total === null || total <= 0) {
        const megabytes = (received / 1024 / 1024).toFixed(1);
        return i18n._(
          msg({
            message: `Downloading font　${{ megabytes }} MB`,
            comment:
              "The running line in the typography panel while a CJK face downloads, when the server declared no total size so there is no percentage to show. The character between the words is an ideographic space (U+3000) — keep it, or use whatever spacing this language sets between a phrase and a figure.",
          }),
        );
      }
      const percent = Math.min(100, Math.round((received / total) * 100));
      return i18n._(
        msg({
          message: `Downloading font　${{ percent }}%`,
          comment:
            "The running line in the typography panel while a CJK face downloads. The character between the words is an ideographic space (U+3000) — keep it, or use whatever spacing this language sets between a phrase and a figure.",
        }),
      );
    }
    case "stored":
      return i18n._(
        msg({
          message: "Font is on this device",
          comment:
            "The line in the typography panel when the face the book needs has already been downloaded, so choosing it costs nothing.",
        }),
      );
    case "unavailable":
      return i18n._(
        msg({
          message: "The font will download once you are online",
          comment:
            "The line in the typography panel when the face this book wants is not held and cannot be fetched right now. It is a promise, not an error: the book still renders in the platform's own face.",
        }),
      );
  }
}

/**
 * How much of the panel's progress bar to fill, as a share of one.
 *
 * `null` means there is no width to draw — either nothing is downloading, or the server
 * declared no total, in which case any fill would be invented. The bar answers that case with
 * movement instead of a width, which is the one honest thing left to show.
 */
export function webFontFraction(status: WebFontStatus | null): number | null {
  if (status === null || status.state !== "downloading") return null;

  const { received, total } = status.progress;
  if (total === null || total <= 0) return null;
  return Math.min(1, received / total);
}

/**
 * The one-off note the reader gets when every face they picked has arrived and been applied.
 *
 * Where `webFontNote` is the running line in the panel, this is the toast that fires once at
 * the end of the whole job — after Regular *and* Bold, not once per face. It names the face so
 * the reflow that just happened reads as "the font finished" rather than a jump out of nowhere.
 * The name is passed in rather than spelled here, so the faces have their one home in
 * `FONT_FAMILIES`.
 */
export function webFontAppliedNote(i18n: I18n, familyLabel: string): string {
  return i18n._(
    msg({
      message: `Now set in ${{ familyLabel }}`,
      comment:
        "Toast shown once a downloaded face has been applied to the book. The value is a typeface name — 'Serif' or 'Sans' as translated elsewhere in this catalog.",
    }),
  );
}

/**
 * The one-off note when the fetch could not complete — offline, or it failed.
 *
 * A reader who just picked a face and saw nothing change is owed a reason; without one this is
 * the very "nothing happened" the indicator exists to kill. It is informational, not an error
 * to act on: the platform stack stands and the reader can carry on reading (ADR-0014).
 */
export const WEB_FONT_UNAVAILABLE_NOTE = msg({
  message: "Cannot download the font right now — using the system font",
  comment:
    "Toast shown when every face the reader picked failed to arrive. Informational rather than an error: the book still renders, in whatever face the machine has.",
});

/**
 * Deletes stored faces this build no longer ships.
 *
 * **This is the reader's own storage, and it is not covered by ADR-0004.** "The data can be
 * thrown away" is about Tidemarks' databases during development; leaving 22 MB of a
 * superseded sans, or 33 of a serif, sitting on someone's phone is a different thing
 * entirely. Every device that ever picked a face holds a pair of them under the old
 * `family/weight` keys.
 *
 * Silent on failure, and deliberately so: this frees space, it does not make anything work.
 * A reader whose IndexedDB refuses the delete should not see an error about it.
 */
export async function forgetStaleFonts(): Promise<void> {
  try {
    const keys = (await db.fonts.toCollection().primaryKeys()).map(String);
    const stale = staleFontKeys(keys);
    if (stale.length > 0) await db.fonts.bulkDelete([...stale]);
  } catch {
    // Storage unavailable or evicted mid-read. The bytes stay where they are.
  }
}

/**
 * The URL for a face this device already holds, or `null` if it does not hold it.
 *
 * Never fetches: this is for callers that want the face **only if it is free**, which today
 * means the chrome borrowing the reader's serif (`lib/ui-font.ts`). Through `objectUrlFor` and
 * not a fresh `createObjectURL`, so it hands back the very URL the book is using — the font
 * cache is keyed on the URL, and a second one would mean parsing 16 MB twice.
 */
export async function storedFontUrl(font: WebFont): Promise<string | null> {
  const key = webFontKey(font);
  const held = objectUrls.get(key);
  if (held) return held;

  try {
    const stored = await db.fonts.get(key);
    return stored ? objectUrlFor(key, stored.file) : null;
  } catch {
    // IndexedDB unavailable. "Not held" is the honest answer and the caller's fallback is the
    // platform's own face, which is where it started.
    return null;
  }
}

/**
 * The face, from wherever it already is — memory, then this device, then the network.
 *
 * Returns `null` when it cannot be had: offline, or the fetch failed. That is not an error
 * state the reader has to deal with, it is the book rendering in the platform's own face as
 * it did before spine carried any, so the caller says so in the settings panel and carries
 * on.
 */
export async function ensureWebFont(
  font: WebFont,
  onStatus: (status: WebFontStatus) => void,
): Promise<LoadedWebFont | null> {
  const key = webFontKey(font);
  const loaded = (src: string): LoadedWebFont => ({
    family: font.family,
    kind: font.kind,
    src,
  });

  const held = objectUrls.get(key);
  if (held) {
    onStatus({ state: "stored" });
    return loaded(held);
  }

  try {
    const stored = await db.fonts.get(key);
    if (stored) {
      onStatus({ state: "stored" });
      return loaded(objectUrlFor(key, stored.file));
    }
  } catch {
    // IndexedDB unavailable (private mode, or storage evicted mid-read). Fetching is still
    // worth trying — it just will not be kept.
  }

  let file: Blob;
  try {
    onStatus({ state: "downloading", progress: { received: 0, total: null } });
    file = await downloadWebFont(font, (progress) => onStatus({ state: "downloading", progress }));
  } catch {
    onStatus({ state: "unavailable" });
    return null;
  }

  try {
    await db.fonts.put({ key, file });
  } catch {
    // Stored nowhere, so the next open pays for it again — still better than not rendering
    // this book in the face the reader chose.
  }

  onStatus({ state: "stored" });
  return loaded(objectUrlFor(key, file));
}
