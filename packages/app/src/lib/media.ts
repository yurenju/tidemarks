import { useEffect, useState } from "react";

/**
 * Where the reader's entries live, in the words CSS asks the question in.
 *
 * `index.css` asks it too, for the bars themselves, and the rule that does names this file.
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
