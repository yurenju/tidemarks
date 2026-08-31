/**
 * The reader's words that are not on the page — panel titles and screen-reader names.
 *
 * Every entry carries a `comment`, because that is the only thing that separates two English
 * strings a translator would otherwise take for one (`docs/agents/i18n.md`). They are worth
 * their length and they are not worth reading through the markup: `Reader.tsx` is where the
 * screen is put together, and the names it hangs on things belong beside each other here.
 *
 * ⚠️ **What the reader can actually read stays in the JSX.** A `<Trans>` wraps the words
 * themselves, and moving one here would leave markup that no longer says what is written on
 * screen — worse than the length it saved.
 */

import { msg } from "@lingui/core/macro";

export const READER_MESSAGES = {
  panelToc: msg({
    message: "Contents",
    comment:
      "Title of the panel listing the book's chapters, and the label of the bar button that raises it.",
  }),
  panelNotes: msg({
    message: "Notes",
    comment:
      "Title of the panel listing what the reader has marked in this book, and the label of the bar button that raises it.",
  }),
  panelLayout: msg({
    message: "Type",
    comment:
      "Title of the panel holding the six typography settings, and the label of the bar button that raises it. It is about how the book is set, not about the book's contents.",
  }),
  nextPage: msg({
    message: "Next page",
    comment:
      "Screen-reader name for one of the two page buttons flanking the book on a desk. Which side is 'next' flips for a right-opening book, so the two are chosen by direction rather than by position.",
  }),
  previousPage: msg({
    message: "Previous page",
    comment:
      "Screen-reader name for one of the two page buttons flanking the book on a desk. Which side is 'previous' flips for a right-opening book, so the two are chosen by direction rather than by position.",
  }),
  about: msg({
    message: "About this book",
    comment:
      "Screen-reader name for the button in the reader's bar that opens the panel describing the open book.",
  }),
};
