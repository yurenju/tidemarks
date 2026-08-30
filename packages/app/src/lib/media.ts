import { useEffect, useState } from "react";

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
 * and the book keeps the rest; below it there is no book left worth keeping, so 〈目錄〉 and
 * 〈筆記〉 take the whole screen (〈排版〉 does not — ADR-0005 needs the page it is applied to).
 * Kept as one constant because a second name for the same number is a second number waiting to
 * be moved on its own; if the two ever want different lines, split it then and say why.
 *
 * Three things ask, and none of them is a layout:
 * - pressing a quote or a chapter in a panel, which may leave the panel standing only where the
 *   place it sent the reader to is still on screen beside it;
 * - which way a finger swipes a panel away;
 * - whether the panel traps the focus, which it must when it covers everything and must not when
 *   it leaves the Scrubber and the other two entries standing.
 */
export const BOOK_KEEPS_A_COLUMN = "(min-width: 820px)";

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
