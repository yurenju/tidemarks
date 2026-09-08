// How long ago a passage was marked, in words.
//
// Shared by the two places that show a mark outside the book — the shelf's card and the notes
// panel — so that one distance is said one way. Its own file rather than one importing the
// other, because neither of those screens owns the words: they both borrow them.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { RelativeAge } from "../lib/revisit";

/**
 * The words for each rung of `relativeAge`.
 *
 * Descriptors declared out here rather than `t({...})` calls inside the component, and that is
 * forced rather than chosen: lingui's macro only rewrites its own `t`, so a helper handed one
 * as an argument extracts nothing and the strings never reach a catalog. `Record<RelativeAge,
 * ...>` keeps the exhaustiveness a `switch` would have given — a new rung fails to compile.
 */
export const AGE_LABELS: Record<RelativeAge, MessageDescriptor> = {
  justNow: msg({
    message: "Just now",
    comment:
      "How long ago the reader marked the passage the reader is being shown: within the hour. Both places carry a distance rather than a date, because reaching back for what they were thinking then is what it is for.",
  }),
  today: msg({
    message: "Today",
    comment: "How long ago the reader marked the passage the reader is being shown: earlier today.",
  }),
  yesterday: msg({
    message: "Yesterday",
    comment:
      "How long ago the reader marked the passage the reader is being shown: the day before.",
  }),
  thisWeek: msg({
    message: "This week",
    comment:
      "How long ago the reader marked the passage the reader is being shown: two to seven days back.",
  }),
  lastWeek: msg({
    message: "Last week",
    comment:
      "How long ago the reader marked the passage the reader is being shown: one to two weeks back.",
  }),
  thisMonth: msg({
    message: "This month",
    comment:
      "How long ago the reader marked the passage the reader is being shown: two to four weeks back.",
  }),
  lastMonth: msg({
    message: "Last month",
    comment:
      "How long ago the reader marked the passage the reader is being shown: one to two months back.",
  }),
  thisYear: msg({
    message: "This year",
    comment:
      "How long ago the reader marked the passage the reader is being shown: two months to a year back.",
  }),
  lastYear: msg({
    message: "Last year",
    comment:
      "How long ago the reader marked the passage the reader is being shown: one to two years back.",
  }),
  longAgo: msg({
    message: "Years ago",
    comment:
      "How long ago the reader marked the passage the reader is being shown: more than two years, the far end of the scale. Vague on purpose \u2014 past a certain distance the exact count stops meaning anything.",
  }),
};
