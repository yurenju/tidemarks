import { Trans, useLingui } from "@lingui/react/macro";
import type { I18n } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import type { Elapsed, Offer } from "../lib/place";

/**
 * Where the reader's place in this book is, when it is not what is on screen, and the two ways of
 * answering that.
 *
 * **One source: a position that arrived from another device** (`lib/elsewhere.ts`). Going back to
 * a marked passage moves the reader too, and it used to raise this same banner — it marks the
 * Scrubber instead now (ADR-0040). The two look alike and are not: the position from another
 * device is unanswered and would be overwritten by the next page turn, while a visit is the
 * reader's own tap a moment ago with nothing at stake.
 *
 * `role="status"` rather than an alert: it is worth reading out when the reader gets to it, and
 * worth nothing interrupting them for.
 */
export default function ElsewhereBanner({
  offer,
  onGo,
  onStay,
}: {
  offer: Offer;
  onGo: () => void;
  onStay: () => void;
}) {
  const { i18n } = useLingui();
  return (
    <div className="elsewhere" role="status" data-testid="elsewhere">
      <p className="elsewhere-line">
        {offer.position.chapterLabel === null ? (
          <Trans comment="Banner over the book, naming the reader's place in it when that place is not what is on screen, and it cannot be named as a chapter. The value is a whole number. The place was written somewhere else while this device had the book open, and the sentence does not say where on purpose: Tidemarks cannot tell which device wrote a position, or even whether it was another browser on this one.">
            You were reading at {Math.round(offer.position.percentage * 100)}%
          </Trans>
        ) : (
          <Trans comment="Banner over the book, naming the reader's place in it when that place is not what is on screen. The value is the chapter's own name, taken from the book — it is in the book's language and is never translated. The place was written somewhere else while this device had the book open, and the sentence does not say where on purpose: Tidemarks cannot tell which device wrote a position, or even whether it was another browser on this one.">
            You were reading “{offer.position.chapterLabel}”
          </Trans>
        )}
      </p>
      {/* **How long ago goes, how far in stays** — the span is what a narrow screen drops
          (`styles/reader.css`). The sentence names a chapter, and a chapter can run for
          thirty pages: without the percentage a reader already inside that chapter is
          offered a move to somewhere the words on screen cannot tell apart from where they
          are. How long ago is the part that can be spared, and it is also the part whose
          length decides whether this fits beside the answers.

          Beside the sentence rather than under it, which is a row saved everywhere — and
          on a phone it is the row that keeps the banner off a fifth of the screen. */}
      <p className="elsewhere-when">
        <span className="elsewhere-elapsed">{elsewhereWhen(i18n, offer.elapsed)} · </span>
        {Math.round(offer.position.percentage * 100)}%
      </p>
      {/* **The pair is one thing and wraps as one.** Left loose among the other pieces, a
          393px screen fitted the timestamp and [[Go there]] on one row and pushed
          [[Stay here]] onto another — two answers to one question, on separate lines, one of them
          looking like the answer to something else. */}
      <div className="elsewhere-actions">
        <button className="primary" onClick={onGo}>
          <Trans comment="Button on the banner naming the reader's place in the book: moves the book to that place. Short — it sits beside 'Stay here'.">
            Go there
          </Trans>
        </button>
        <button className="ghost" onClick={onStay}>
          <Trans comment="Button on the banner naming the reader's place in the book: makes the page on screen the reader's place, whatever the banner named. Short — it sits beside 'Go there'.">
            Stay here
          </Trans>
        </button>
      </div>
    </div>
  );
}

/**
 * How long ago the other device wrote its position, in words.
 *
 * Coarse on purpose. The reading is taken once, when the banner appears, and never refreshed
 * (`lib/elsewhere.ts`) — a grain of minutes and hours is one a stale reading survives, where
 * "5 minutes ago" refreshed to the second would not.
 */
function elsewhereWhen(i18n: I18n, elapsed: Elapsed): string {
  if (elapsed.unit === "now") {
    return i18n._(
      msg({
        message: "Just now",
        comment:
          "On the banner naming the reader's place in the book: that place was read less than a minute ago. Also what a position written slightly in the future says, since two devices' clocks need not agree.",
      }),
    );
  }
  const { count } = elapsed;
  if (elapsed.unit === "minutes") {
    return i18n._(
      msg({
        message: plural(count, { one: "# minute ago", other: "# minutes ago" }),
        comment:
          "On the banner naming the reader's place in the book: how long ago it was read. Whole minutes, under an hour.",
      }),
    );
  }
  if (elapsed.unit === "hours") {
    return i18n._(
      msg({
        message: plural(count, { one: "# hour ago", other: "# hours ago" }),
        comment:
          "On the banner naming the reader's place in the book: how long ago it was read. Whole hours, under a day.",
      }),
    );
  }
  return i18n._(
    msg({
      message: plural(count, { one: "# day ago", other: "# days ago" }),
      comment:
        "On the banner naming the reader's place in the book: how long ago it was read. Whole days.",
    }),
  );
}
