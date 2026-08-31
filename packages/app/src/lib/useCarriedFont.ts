/**
 * The face this book wants, fetched in the background and applied when it lands (ADR-0014).
 *
 * Two halves on purpose. `carryFont` is the job — which files to ask for, what counts as
 * having arrived, and which one-off note the whole thing earns — and it knows nothing about
 * React, so the three answers that used to be unreachable are ordinary Node tests next door.
 * `useCarriedFont` is the state the reader draws from: the faces frond is handed, the running
 * line in the type panel, the trace under the Aa button, and the toast that explains the
 * reflow after the fact.
 */

import { useEffect, useRef, useState } from "react";
import { useLingui } from "@lingui/react";
import type { I18n } from "@lingui/core";
import { webFontsFor } from "./web-font";
import {
  ensureWebFont,
  webFontAppliedNote,
  WEB_FONT_UNAVAILABLE_NOTE,
  type LoadedWebFont,
  type WebFontStatus,
} from "./web-font-store";
import { FONT_FAMILIES, type FontChoice } from "./settings";

// How long the applied/unavailable toast stays before it clears itself. Long enough to read a
// short line, short enough not to sit over the page.
const FONT_TOAST_MS = 2600;

// The reader-facing name of a font choice, from its one source. The toast names the face the
// download applied, and the dropdown is where that name is defined.
const fontFamilyLabel = (i18n: I18n, choice: FontChoice): string => {
  const found = FONT_FAMILIES.find((f) => f.value === choice);
  return found ? i18n._(found.label) : "";
};

/**
 * What the whole job earns as a one-off note, and `null` for the jobs that stay silent.
 *
 * A job that was all cache is silent because a cached switch is instant — there is no reflow
 * to explain. `"applied"` wins over `"unavailable"` whenever a downloaded face is on the page:
 * the reader is reading in the face they picked, so a failure note would contradict what is on
 * screen. `"unavailable"` is for when nothing they picked could be had at all.
 */
export type FontOutcome = "applied" | "unavailable" | null;

/** Everywhere `carryFont` reports to, and the one question it asks back. */
export interface FontCarrySink {
  /** The running line in the type panel. */
  status: (status: WebFontStatus) => void;
  /** Whether a face is on the wire right now, which the Aa button traces its border for. */
  busy: (running: boolean) => void;
  /** A face that has arrived and is frond's to render with. */
  loaded: (font: LoadedWebFont) => void;
  /**
   * Whether this job has been left behind — the reader switched face, or closed the book.
   * Asked rather than told, because the answer changes while the fetch is in flight.
   */
  cancelled: () => boolean;
}

/**
 * Fetching the faces one choice needs, in order, reporting as it goes.
 *
 * `ensure` is a parameter so that what decides a 16 MB download can be run without a network
 * or a database. Every caller but the tests takes the default, and the alternative — mocking
 * the module — is a tool this repo does not use anywhere.
 */
export async function carryFont(
  choice: FontChoice,
  sink: FontCarrySink,
  ensure: typeof ensureWebFont = ensureWebFont,
): Promise<FontOutcome> {
  // Whether a face both came down the wire *and* applied, and whether one could not be had.
  let netApplied = false;
  let failed = false;
  try {
    // A loop over what is now one file per kind. It used to be two — Regular first, so the
    // body text arrived before the headings — and the loop is kept because the shape of
    // "fetch what this setting needs" is the setting's business rather than the count's.
    for (const font of webFontsFor(choice)) {
      let downloading = false;
      const loaded = await ensure(font, (status) => {
        if (sink.cancelled()) return;
        sink.status(status);
        // The trace comes up the moment a fetch reaches the wire, and is cleared once, in
        // `finally`. That used to matter across two faces, so the indicator did not flicker
        // off between Regular finishing and Bold starting; with one file it is simply where
        // the clearing belongs.
        if (status.state === "downloading") {
          downloading = true;
          sink.busy(true);
        }
      });
      if (sink.cancelled()) return null;
      if (!loaded) {
        // offline; the platform stack stands, and there is no second try this pass
        failed = true;
        break;
      }
      // Only a face that reached the wire earns the applied toast, so a cached switch stays
      // silent; a face that came from the device applies without setting this.
      if (downloading) netApplied = true;
      sink.loaded(loaded);
    }
  } finally {
    if (!sink.cancelled()) sink.busy(false);
  }
  if (sink.cancelled()) return null;
  if (netApplied) return "applied";
  if (failed) return "unavailable";
  return null;
}

export interface CarriedFont {
  /**
   * The faces already on this device, which is what frond is handed. Empty until one arrives,
   * and empty for good when the reader is offline — the book renders in the platform's face
   * either way.
   */
  webFonts: readonly LoadedWebFont[];
  /** The same list as a ref, for the open path — it builds the first settings before any of
   *  this is in state. */
  webFontsRef: React.RefObject<readonly LoadedWebFont[]>;
  /** What the settings panel says about the fetch. `null` until there is anything to say. */
  status: WebFontStatus | null;
  /** Whether a face is on the network right now. A face that comes back from the device shows
   *  nothing — a cached switch is instant and silent, no trace, no toast. */
  busy: boolean;
  /** The one-off note that fires once at the end of the whole job, and clears itself. */
  toast: string | null;
}

/**
 * The carried face as reader state.
 *
 * Deliberately its own effect rather than part of opening the book: the book is readable while
 * this runs, and 16 MB on a phone connection is not something to hold a page turn for. What
 * applies the result is the settings effect in `Reader.tsx` — `webFonts` is in its
 * dependencies, so a face arriving is a settings change like any other.
 *
 * It runs again when the reader switches serif to sans or back, because that is when the other
 * face becomes the one they are looking at. A face already on the device comes back from Dexie
 * without touching the network.
 */
export function useCarriedFont(wants: boolean, choice: FontChoice): CarriedFont {
  const { i18n } = useLingui();
  const [webFonts, setWebFonts] = useState<readonly LoadedWebFont[]>([]);
  const [status, setStatus] = useState<WebFontStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const webFontsRef = useRef(webFonts);
  webFontsRef.current = webFonts;

  useEffect(() => {
    if (!wants) return;
    let cancelled = false;

    void (async () => {
      const outcome = await carryFont(choice, {
        status: setStatus,
        busy: setBusy,
        loaded: (font) =>
          setWebFonts((held) => [...held.filter((f) => f.family !== font.family), font]),
        cancelled: () => cancelled,
      });
      if (outcome === "applied") setToast(webFontAppliedNote(i18n, fontFamilyLabel(i18n, choice)));
      else if (outcome === "unavailable") setToast(i18n._(WEB_FONT_UNAVAILABLE_NOTE));
    })();

    return () => {
      cancelled = true;
    };
    // `i18n` is left out on purpose: this effect fetches 16 MB, and the only thing the locale
    // feeds is the wording of a toast that clears itself after 2.6 seconds.
  }, [wants, choice]);

  // The toast says its piece and clears itself: it explains the reflow, it is not a control.
  useEffect(() => {
    if (toast === null) return;
    const id = setTimeout(() => setToast(null), FONT_TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  return { webFonts, webFontsRef, status, busy, toast };
}
