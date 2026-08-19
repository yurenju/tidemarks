import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import type { ReactNode } from "react";
import { HAND_HELD_CHROME, useMediaQuery } from "../lib/media";

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
 * 目錄, 筆記 and 排版 — one shell, two anchors. On a hand-held it rises from the bottom edge;
 * everywhere else it is a column down the right side, because a full-width sheet rising from
 * the bottom of a 1400px window is a phone's answer given to a desk.
 *
 * **On a desk it takes its room from the book; on a hand-held it takes it from the bars.**
 * Both used to cover the book and stop short of the Scrubber, and both halves of that gave way
 * for the same reason: 〈排版〉 applies as it is dragged, so whatever the panel covers is the
 * thing the reader opened it to look at (ADR-0026). A column beside the book repaginates it —
 * that is the price, and 目錄 and 筆記 are the ones paying it. On a phone there is no column to
 * give, so the entries and the Scrubber leave instead.
 *
 * Which anchor is which is settled in CSS, so the layout never waits on JavaScript. The one
 * thing decided here is the direction a finger dismisses it, and that has no layout to get
 * wrong. This replaced a component called `BottomSheet` whose comment promised the desktop
 * would keep getting the phone's sheet because "two layouts is two sets of bugs" — still true,
 * which is why this is one component with one close path and two anchors, not two components.
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
  title: string;
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
  const handHeld = useMediaQuery(HAND_HELD_CHROME);
  return (
    <BaseDrawer.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        // **A press on the entry that opened this is not an outside press.** Base UI dismisses on
        // `pointerdown`, and the entry's own `onClick` arrives after it — so a reader pressing
        // 目錄 while 目錄 stands had the panel closed by this handler and reopened a moment later
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
         stop answering, which is the opposite of what "stops short of the Scrubber" was for. */
      modal={false}
      swipeDirection={handHeld ? "down" : "right"}
    >
      <BaseDrawer.Portal container={container}>
        <BaseDrawer.Backdrop className="panel-backdrop" />
        <BaseDrawer.Viewport className="panel-viewport">
          <BaseDrawer.Popup className="panel-popup" data-testid={testId}>
            <header className="panel-header">
              <BaseDrawer.Title className="panel-title">{title}</BaseDrawer.Title>
              <BaseDrawer.Close className="ghost panel-close" aria-label="關閉">
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
