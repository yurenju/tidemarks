/**
 * Which lines of a passage the phone's one-note page shows before [[Show the full text]] (#262).
 *
 * **The window is placed on the mark, not on the paragraph's top.** The passage is every paragraph
 * the mark touches, whole, and how long a paragraph runs is up to the book; cut from the top, a
 * mark near the end of a long one fell out of the window altogether, and the reader saw half a
 * screen of faded words with nothing of what they had marked among them.
 *
 * So the mark's first line stands halfway down the window, with the book's words before it above
 * and after it below — and where that would need no cut at the top, the cut stays at the top, so a
 * mark early in its paragraph is shown as it always was.
 *
 * Everything is in whole lines, counted from zero, because the page cuts on a line (`NotePage`).
 */
export interface PassageLines {
  /** Lines the window has room for. */
  fits: number;
  /** Lines the whole passage takes. */
  total: number;
  /** The line the mark begins on. */
  markStart: number;
  /** The line after the one the mark ends on. */
  markEnd: number;
}

export interface PassageWindow {
  /** The passage's first line in the window. */
  start: number;
  /** Lines cut off above the window, and below it. */
  above: number;
  below: number;
}

/** `null` when the whole passage fits, which is also when there is nothing to open. */
export function passageWindow({
  fits,
  total,
  markStart,
  markEnd,
}: PassageLines): PassageWindow | null {
  if (total <= fits) return null;
  let start = markStart - Math.floor(fits / 2);
  // **A mark too long for the window's lower half is moved up**, until a line after it shows: the
  // fade at the foot then falls on the words after the mark rather than on its end. But never past
  // two lines of the words before it — a mark longer than the window is cut at its tail instead,
  // since its opening is what says which passage this is.
  const end = Math.min(markEnd + 1, total);
  if (end - start > fits) start = Math.min(end - fits, Math.max(markStart - 2, 0));
  // Not past either end: a window that ran off the passage would be part empty.
  start = Math.min(Math.max(start, 0), total - fits);
  return { start, above: start, below: total - fits - start };
}
