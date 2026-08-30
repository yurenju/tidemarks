import { useLingui } from "@lingui/react/macro";
import type { SegmentLabel } from "./Segmented";
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import type { ReactNode } from "react";
import { BOOK_KEEPS_A_COLUMN, useMediaQuery } from "../lib/media";

/**
 * Whether the thing that dismissed this panel was one of the three entries that raise it.
 *
 * Two ends of the event are asked, because pressing an entry dismisses the panel twice over and
 * the two arrive with different shapes: the press itself is an `outside-press` whose `target` is
 * the button, and the focus leaving the panel for that button is a `focus-out` whose
 * `relatedTarget` is. A guard that knew only the first works on a panel opened from the bare bar
 * and fails on one switched to from another panel — because only then is the focus inside the
 * panel to begin with.
 *
 * The bar is found by its `data-testid` because that is the one name the entries already answer
 * to in both arrangements — top bar on a desk, a row above the Scrubber on a hand-held — and a
 * class would be a second name for the same box.
 */
const fromEntries = (event: Event): boolean => {
  const related = "relatedTarget" in event ? (event as FocusEvent).relatedTarget : null;
  return [event.target, related].some(
    (node) => node instanceof Element && node.closest("[data-testid='chrome-nav']") !== null,
  );
};

/**
 * [[Contents]], [[Notes]] and [[Layout]] — one shell, two anchors. Under 820px it comes up from the bottom edge;
 * wider, it is a column down the right side, because a full-width sheet rising from the bottom
 * of a 1400px window is a phone's answer given to a desk.
 *
 * **Wide, it takes its room from the book; narrow, it takes it from the bars.** Both used to
 * cover the book and stop short of the Scrubber, and both halves of that gave way for the same
 * reason: [[Layout]] applies as it is dragged, so whatever the panel covers is the thing the reader
 * opened it to look at (ADR-0005). A column beside the book repaginates it — that is the price,
 * and [[Contents]] and [[Notes]] are the ones paying it. Narrow there is no column to give, so the entries and
 * the Scrubber leave instead, and [[Contents]] and [[Notes]] go on to take the whole screen: what a
 * sheet would leave above itself there is not a book anyone can read
 * (ADR-0044).
 *
 * Which anchor is which is settled in CSS, so the layout never waits on JavaScript. What is
 * decided here is behaviour with no layout to get wrong: the direction a finger dismisses it,
 * and whether it holds the focus. This replaced a component called `BottomSheet` whose comment
 * promised the desktop would keep getting the phone's sheet because "two layouts is two sets of
 * bugs" — still true, which is why this is one component with one close path and two anchors,
 * not two components.
 */
export default function Panel({
  open,
  onClose,
  title,
  testId,
  container,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: SegmentLabel;
  /** `data-testid` for the popup, so tests stop naming the layout. */
  testId: string;
  /**
   * The reader's own box.
   *
   * Rendering into it rather than into `<body>` is what keeps this panel's edges honest: they
   * are the box's, not constants that have to be kept in step with the height of two bars. The
   * first version of this used constants and they were wrong by nine pixels the first time
   * anyone measured them.
   */
  container: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const { t, i18n } = useLingui();
  const besideTheBook = useMediaQuery(BOOK_KEEPS_A_COLUMN);
  return (
    <BaseDrawer.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        // **A press on the entry that opened this is not an outside press.** Base UI dismisses on
        // `pointerdown`, and the entry's own `onClick` arrives after it — so a reader pressing
        // [[Contents]] while [[Contents]] stands had the panel closed by this handler and reopened a moment later
        // by the toggle, which read the state as already closed. The entry looked dead.
        //
        // The press is the entry's, and one press does one thing. Filtering it here rather than
        // guarding the toggle, because the entries are what this panel *is* — three doors and one
        // room — and a guard on the toggle would be a second place that has to know that.
        const dismissal = details.reason === "outside-press" || details.reason === "focus-out";
        if (dismissal && fromEntries(details.event)) return;
        onClose();
      }}
      /* Never `modal={true}` in the reader. That renders a `position: fixed; inset: 0`
         interception element and, on desktop, writes `height: 100dvh; overflow: hidden` onto
         `<body>` — and both of those fight the page-turn gesture and frond's `pointerup` in the
         book underneath. It would not fail to compile; it would fail on a phone, as page turns
         that stopped working.

         **And not `'trap-focus'` either, which the drawers on the shelf do use.** Trapping the
         focus means marking everything outside the panel `inert`, and everything outside this
         one includes the bar it came from — the Scrubber goes dead and the other two buttons
         stop answering, which is the opposite of what "stops short of the Scrubber" was for.

         ⚠️ **Under 820px [[Contents]] and [[Notes]] now cover the whole screen, and a thing that covers
         the whole screen ought to trap.** It is not done here, and not by oversight: `inert`
         stops presses as well as focus, and [[Layout]] is a sheet at that width with a live page
         above it that a press is meant to reach (`.panel-backdrop` takes it to dismiss the
         sheet). So trapping has to be per face, and it belongs with the rest of what makes these
         two drawers rather than panels — the hash and the back button, in #148. */
      modal={false}
      swipeDirection={besideTheBook ? "right" : "down"}
    >
      <BaseDrawer.Portal container={container}>
        <BaseDrawer.Backdrop className="panel-backdrop" />
        <BaseDrawer.Viewport className="panel-viewport">
          <BaseDrawer.Popup className="panel-popup" data-testid={testId}>
            <header className="panel-header">
              <BaseDrawer.Title className="panel-title">
                {typeof title === "string" ? title : i18n._(title)}
              </BaseDrawer.Title>
              <BaseDrawer.Close
                className="ghost panel-close"
                aria-label={t({
                  message: "Close",
                  comment:
                    "Screen-reader name for the ✕ that dismisses a drawer or a panel. A verb: it is the action, not a label for the thing being shut.",
                })}
              >
                ✕
              </BaseDrawer.Close>
            </header>
            <div className="panel-body">{children}</div>
          </BaseDrawer.Popup>
        </BaseDrawer.Viewport>
      </BaseDrawer.Portal>
    </BaseDrawer.Root>
  );
}
