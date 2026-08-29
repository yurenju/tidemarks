import { useEffect, useState } from "react";

/**
 * Where the reader's entries live, in the words CSS asks the question in.
 *
 * `styles/device.css` asks it too, for the bars themselves, and the rule that does names
 * this file.
 * Two copies of one string, because CSS cannot read a constant — and this copy decides only
 * which way a finger dismisses a panel, so a frame of disagreement costs nothing.
 *
 * `any-pointer` rather than `pointer`: it is about whether a finger can reach this screen at
 * all, not about which pointer happens to be in use (ADR-0023). **A drag in progress asks a
 * different question and does not come here** — it has an event, and the event knows what is
 * touching it (`Scrubber`).
 */
export const HAND_HELD_CHROME = "(any-pointer: coarse) and (max-width: 819px)";

/**
 * Where a panel stands **beside** the book rather than over it.
 *
 * Another copy of a string `styles/device.css` owns — the rule that gives the panel its column
 * is `.reader[data-panel] .reader-body`'s `padding-right`, and it only exists inside this query.
 * Below it the panel covers the page, at every width and on every pointer.
 *
 * What asks: pressing a quote in the notes panel. The panel is kept standing so the reader can
 * work down the list, and that is only worth anything where the passage they were taken to is
 * still on screen. Narrower, keeping it would hide the very thing the press was for.
 */
export const BOOK_KEEPS_A_COLUMN = "(min-width: 1024px)";

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
