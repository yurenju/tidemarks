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

/**
 * The characters a space never sits between in the writing itself: Han, kana, and the punctuation
 * and forms that set at their width.
 *
 * ⚠️ **Hangul is deliberately not here**, and that is the whole reason this list is written out
 * rather than reached for as "CJK". Korean orthography makes the space between words mandatory,
 * exactly as Latin's does, so closing one up destroys the text.
 *
 * ⚠️ **Written as escapes rather than as literal characters.** The range that ends this list used
 * to open with a literal 豈 — which looks like the compatibility ideograph at U+F900 and is in
 * fact the ordinary one at U+8C48, so the range silently ran from there and swallowed hangul, the
 * surrogate block and the private use area on the way past.
 */
const WIDE = new RegExp(
  "[" +
    "\\u{3000}-\\u{303F}" + // CJK symbols and punctuation
    "\\u{3040}-\\u{30FF}" + // kana
    "\\u{3400}-\\u{4DBF}" + // unified ideographs, extension A
    "\\u{4E00}-\\u{9FFF}" + // unified ideographs
    "\\u{F900}-\\u{FAFF}" + // compatibility ideographs
    "\\u{FF00}-\\u{FF60}" + // fullwidth forms
    "\\u{20000}-\\u{2FA1F}" + // the extensions past the BMP
    "]",
  "u",
);

/**
 * The character ending at `end`, as a whole code point.
 *
 * ⚠️ `text[i]` hands back one UTF-16 code unit, and half of an astral character is not a
 * character: on its own a surrogate matches nothing sensible, so a passage that quoted an emoji
 * would have the space beside it judged against a meaningless half.
 */
function charEndingAt(text: string, end: number): string {
  if (end <= 0) return "";
  const code = text.charCodeAt(end - 1);
  const low = code >= 0xdc00 && code <= 0xdfff;
  return text.slice(low && end >= 2 ? end - 2 : end - 1, end);
}

/** The character starting at `start`, as a whole code point. */
function charStartingAt(text: string, start: number): string {
  if (start >= text.length) return "";
  const point = text.codePointAt(start)!;
  return String.fromCodePoint(point);
}

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
  return trimmed.replace(/\s+/gu, (run: string, offset: number) => {
    const before = charEndingAt(trimmed, offset);
    const after = charStartingAt(trimmed, offset + run.length);
    return WIDE.test(before) && WIDE.test(after) ? "" : " ";
  });
}
