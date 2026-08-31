/**
 * One sitting with one book: opening it, and tearing it down on the way out.
 *
 * The job itself is `lib/book-session.ts`, which knows nothing about React. This is the two
 * lines of lifecycle around it — open when the book changes, destroy when it changes again or
 * the reader leaves — and the reason they are a file is the paragraph below.
 *
 * ⚠️ **The session is handed a ref rather than returning one**, because the reader and the
 * session each need the other: `lib/useSelection.ts` asks the session whether a selection should
 * be blamed on the last tap, and the session is opened with the selection's commands. One of the
 * two has to be reachable before it exists, and a ref is what that looks like.
 */

// oxlint-disable react-hooks/exhaustive-deps -- see `useBookSession` below: the one effect here
// is keyed on the book alone, on purpose, and everything it reads besides is either carried in
// once at open or reached through a ref. oxlint cannot silence this rule for a single line
// (tested on 1.73.0 and 1.80.0), and this file holds one effect, so the exemption is the file's.

import { useEffect, type RefObject } from "react";
import { openBookSession, type BookSession, type BookSessionOptions } from "./book-session";

/**
 * Opens the book and keeps `session` pointing at it for as long as it is the book on screen.
 *
 * ⚠️ **`bookId` alone, and that is what "read once" means.** `openAt` changes while the book
 * stays open — jumping to a note's source moves the address to the passage — so depending on it
 * would re-open the book onto the last note the reader looked at, every time they looked at one.
 * `select` and `handles` are carried out once as the book opens and never again. `i18n` is out
 * for the same reason: what it feeds is an error message stored in state, and re-running this to
 * refresh that wording would re-open the book, sending a reader who changed language while
 * looking at a failure back to page one of one that worked.
 *
 * ⚠️ **`selection` is not one either, and asking for it is the trap `lib/useSelection.ts` opens
 * with.** The commands are handed over as the ref they are, precisely so this once-per-book
 * session reads the current set instead of the one it opened with.
 */
export function useBookSession(
  session: RefObject<BookSession | null>,
  options: BookSessionOptions,
): void {
  useEffect(() => {
    const open = openBookSession(options);
    session.current = open;
    return () => {
      session.current = null;
      open.destroy();
    };
  }, [options.bookId]);
}
