/**
 * A marked passage, made ready to be set as one paragraph.
 *
 * A mark can span paragraphs, and every screen that shows one sets it as a single run of prose —
 * so the line breaks are gone by the time the reader sees it, and what they leave behind is what
 * the book put *around* them: the indent at the head of each paragraph, the space at the end of
 * each line. Run together they read as holes in the middle of a sentence.
 *
 * ⚠️ **Done on the way to the screen, not on the way into the database.** What is stored stays the
 * book's own text: this is a typesetting judgement, and typesetting judgements change. A mark
 * rewritten on the way in cannot be un-rewritten when the rule below turns out to be too eager.
 */

/** Han, kana, hangul, and the full-width punctuation that sets with them. */
const WIDE = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-｠]/u;

/**
 * The passage with the book's layout taken out of it.
 *
 * ⚠️ **Not every space is layout, which is why this is not a blanket strip.** Between two Latin
 * words a space is part of the language, and taking it out destroys the text. Between two
 * ideographs there is no such space in the writing at all, so one standing there came from the
 * page rather than from the sentence.
 *
 * So: **a run of whitespace closes up when both of its neighbours are wide, and collapses to a
 * single space otherwise.** Mixed neighbours keep the space on purpose — a Latin word quoted
 * inside a Chinese sentence is set with spaces around it, and that is the one place where the two
 * halves of the rule disagree.
 */
export function tidy(text: string): string {
  const trimmed = text.trim();
  return trimmed.replace(/\s+/gu, (run, offset: number) => {
    const before = trimmed[offset - 1] ?? "";
    const after = trimmed[offset + run.length] ?? "";
    return WIDE.test(before) && WIDE.test(after) ? "" : " ";
  });
}
