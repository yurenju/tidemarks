import { useEffect, useState } from "react";
import type { Panel } from "./route";

/**
 * Where a panel stands **beside** the book rather than over the whole screen.
 *
 * Another copy of a string `styles/device.css` owns — the rule that gives the panel its column
 * is `.reader[data-panel] .reader-body`'s `padding-right`, and it only exists inside this query.
 * `lib/tokens.test.ts` fails if the two ever drift.
 *
 * **Width alone, and no pointer query**, because where a thing sits is a question about the
 * window (ADR-0023): a desktop window dragged under 820 has the same room a phone has, and the
 * hand on the mouse does not give it any more. How big to draw what is in it is the other
 * question, and `any-pointer` is still what answers that.
 *
 * **One line, two questions, and today they have the same answer.** Above it a panel is a column
 * and the book keeps the rest; below it there is no book left worth keeping, so [[Contents]] and
 * [[Notes]] take the whole screen ([[Layout]] does not — ADR-0005 needs the page it is applied to).
 * Kept as one constant because a second name for the same number is a second number waiting to
 * be moved on its own; if the two ever want different lines, split it then and say why.
 *
 * Three things ask, and none of them is a layout:
 * - pressing a quote or a chapter in a panel, which may leave the panel standing only where the
 *   place it sent the reader to is still on screen beside it;
 * - which way a finger swipes a panel away;
 * - whether the panel traps the focus and locks the page behind it, which it must when it covers
 *   everything and must not when it leaves the Scrubber and the other two entries standing.
 *
 * **How the way out is drawn was once on that list and no longer is.** It is a ✕ at every width:
 * narrower the panel slides down out of the way, and a thing being put away is shut rather than
 * stepped out of.
 *
 * **Being in the address is not on that list either, and deliberately.** Every panel is in the address
 * at every width (ADR-0046), so the back button does the same thing on a phone and on a desk —
 * a rule that changed with the window would be one the reader has to learn twice.
 */
export const BOOK_KEEPS_A_COLUMN = "(min-width: 820px)";

/**
 * What a panel needs to be able to see behind it, which is the one question the four faces
 * answer differently (ADR-0046).
 *
 * - `"page"` — [[Layout]]. The strongest of the three: the six settings apply as they are dragged,
 *   so the page under the panel *is* the answer the reader opened it for (ADR-0005).
 * - `"book"` — [[Contents]] and [[Notes]]. Where the book keeps a column they send the reader
 *   somewhere in it and the panel may stay; where it does not, there is no column to give and
 *   a sliver of book buys nothing.
 * - `"nothing"` — [[About]]. Three numbers and a way out, and what it describes is *a book*,
 *   which need not be the one on the screen underneath: opened from the shelf, it is not.
 *
 * ⚠️ **It says what the panel needs, not which edge it is anchored to.** Which edge is a
 * question about the window and changes with it, so it is CSS's (see the note below on why a
 * layout may not wait on JavaScript). CSS reads this and the width and draws; JavaScript reads
 * this and the width and behaves. Neither derives the other's answer.
 */
export type PanelNeeds = "page" | "book" | "nothing";

/**
 * The answer for each of the four, in one place.
 *
 * Two callers ask, and they are far apart: the panel itself, for how it behaves, and `App.tsx`,
 * for whether the page behind it locks. Answering it at each of them would be two tables to keep
 * in step, and the one that drifted would drift silently — a page that goes on scrolling under a
 * full-screen panel looks like nothing at all until a finger is on it.
 */
export const PANEL_NEEDS: Record<Panel["kind"], PanelNeeds> = {
  layout: "page",
  toc: "book",
  notes: "book",
  about: "nothing",
};

/**
 * Whether nothing of the screen underneath is left showing — and therefore whether the panel
 * traps the focus and locks the page behind it. **One condition for both**, because they are one
 * claim: a surface with the whole screen has the reader's whole attention, and anything still
 * answering a key or a scroll behind it is out of reach and moving.
 *
 * `"page"` is never on this side of the line at any width: narrow it is a sheet with the live
 * page standing above it, and a press meant for that page has to reach it.
 */
export const panelCoversEverything = (needs: PanelNeeds, besideTheBook: boolean): boolean =>
  needs === "nothing" || (needs === "book" && !besideTheBook);

/**
 * Whether a media query holds, kept up to date while it is being watched.
 *
 * Nothing about the **layout** may depend on this. A layout that waits on JavaScript is a
 * layout that flashes the wrong arrangement on the way in, and worse, one that is wrong on the
 * first paint for anyone whose device changes its answer (a tablet picking up a mouse). What
 * belongs here is behaviour that has no CSS to express it.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}
