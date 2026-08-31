import { useLingui } from "@lingui/react/macro";
import type { SegmentLabel } from "./Segmented";
import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import type { ReactNode } from "react";
import {
  BOOK_KEEPS_A_COLUMN,
  panelCoversEverything,
  useMediaQuery,
  type PanelNeeds,
} from "../lib/media";

/**
 * Whether the thing that dismissed this panel was the chrome the panel stands beside.
 *
 * Two ends of the event are asked, because pressing an entry dismisses the panel twice over and
 * the two arrive with different shapes: the press itself is an `outside-press` whose `target` is
 * the button, and the focus leaving the panel for that button is a `focus-out` whose
 * `relatedTarget` is. A guard that knew only the first works on a panel opened from the bare bar
 * and fails on one switched to from another panel — because only then is the focus inside the
 * panel to begin with.
 *
 * **The whole chrome, not only the three entries.** Two reasons, and the second is a bug:
 *
 * The first is that one press does one thing. Base UI dismisses on `pointerdown`, and an entry's
 * own `onClick` arrives after it — so a reader pressing [[Contents]] while [[Contents]] stood had the
 * panel closed here and reopened a moment later by the toggle, which read the state as already
 * closed. The entry looked dead.
 *
 * The second is that **the bars move when a panel leaves**, and a press that dismisses the panel
 * is a press on something that is about to walk out from under it. `.chrome` gives up its right
 * end to a standing panel and takes it back over 180ms (`styles/reader.css`), and the browser
 * only counts a click when `mousedown` and `mouseup` land on the same element. Measured: a press
 * on [[Stay here]] in the [[Position from elsewhere]] banner beside a standing [[Notes]] panel moved
 * that button 47px to the right within one frame, and a press held for 90ms — a human's, or a
 * busy machine's — had its click swallowed and the banner stayed standing (the webkit flake in
 * #160). The Scrubber is exposed the same way, and "the Scrubber stays reachable beside the
 * panel" is the whole point of the bars stopping short of it (`chrome-placement.spec.ts`).
 *
 * The box is found by its class rather than by a `data-testid` per bar: what makes a press safe
 * here is being inside the box that moves, and that box has exactly one name. `.chrome` itself
 * catches no pointer events — each bar grants its own — so a press on the page between the bars
 * still reaches frond and is still an outside press.
 *
 * ⚠️ **The ⋯ that opens [[About]] is in that box too**, so the caller below asks this only of the
 * faces it was written for. Trapping the focus marks the rest of the screen `aria-hidden`, which
 * does not stop a press — the bar under [[About]] is still pressable — so without that guard a
 * reader pressing ⋯ while [[About]] stood would have the press swallowed here and nothing would
 * happen. There are three doors and one room; the fourth door is not one of them.
 */
const fromChrome = (event: Event): boolean => {
  const related = "relatedTarget" in event ? (event as FocusEvent).relatedTarget : null;
  return [event.target, related].some(
    (node) => node instanceof Element && node.closest(".chrome") !== null,
  );
};

/**
 * One shell for all four faces — [[Contents]], [[Notes]], [[Layout]] and [[About]] (ADR-0046).
 *
 * There used to be two of these, `Panel` and `Drawer`, with identical props and the same Base UI
 * tree inside them, differing in four lines. The four lines were four consequences of one
 * question — **what does this face need to be able to see behind it?** — so the question became
 * `needs` and the copy went away. What that bought is not tidiness: it is that the hash and the
 * back button, added in the same change, were written once instead of twice.
 *
 * **Which edge it is anchored to is settled in CSS, so the layout never waits on JavaScript**
 * (`lib/media.ts`). What is decided here is behaviour with no layout to get wrong: the direction
 * a finger dismisses it and whether it holds the focus.
 *
 * ⚠️ **`modal` is not the caller's to set**, which is why it is derived rather than passed.
 * `modal={true}` renders a `position: fixed; inset: 0` interception element and, on desktop,
 * writes `height: 100dvh; overflow: hidden` onto `<body>` — both of which fight the page-turn
 * gesture and frond's `pointerup` in the book underneath. It would not fail to compile; it would
 * fail on a phone, as page turns that stopped working. `'trap-focus'` is the half that is wanted
 * and the half this asks for.
 */
export default function Panel({
  open,
  onClose,
  title,
  testId,
  needs,
  container,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: SegmentLabel;
  /** `data-testid` for the popup, so tests stop naming the layout. */
  testId: string;
  /** What has to stay visible behind this face. The one thing the four differ by — see
   *  `PanelNeeds` in `lib/media.ts` for what each answer costs. */
  needs: PanelNeeds;
  /**
   * The reader's own box, for the faces drawn inside it.
   *
   * Rendering into it rather than into `<body>` is what keeps those panels' edges honest: they
   * are the box's, not constants that have to be kept in step with the height of two bars. The
   * first version of this used constants and they were wrong by nine pixels the first time
   * anyone measured them.
   *
   * **Absent for a face that needs nothing behind it**, which is both why it is optional and
   * what makes [[About]] work on the shelf: there is no reader's box there to render into, and on
   * a desk that face is meant to cover the whole window rather than stop at the reader's edges.
   */
  container?: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const { t, i18n } = useLingui();
  const besideTheBook = useMediaQuery(BOOK_KEEPS_A_COLUMN);
  const coversEverything = panelCoversEverything(needs, besideTheBook);
  return (
    <BaseDrawer.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        // **A press on the chrome this panel stands beside is not an outside press** — see
        // `fromChrome` above for the two things that go wrong when it is counted as one.
        // Filtered here rather than guarded at each control, because the chrome is what this
        // panel *is* — three doors and one room — and a guard per control would be several
        // places that each have to know that.
        const dismissal = details.reason === "outside-press" || details.reason === "focus-out";
        if (needs !== "nothing" && dismissal && fromChrome(details.event)) return;
        onClose();
      }}
      /* Trapping keeps the keyboard inside the panel and marks the rest of the screen
         `aria-hidden` — so it is exactly wrong for a panel that leaves something live behind it.
         Beside the book, everything outside the panel includes the bar it came from: the
         Scrubber and the other two entries would go quiet to a screen reader while still
         standing there in plain sight, which is the opposite of what "the panel stops short of
         the Scrubber" was for. Under [[Layout]]'s sheet it is the page itself, and the reader is
         looking straight at it — announcing it away at the one moment it is the subject
         (ADR-0005).

         Covering everything, none of that is true and the trap is what the arrangement asks for:
         a full-screen surface with a live tab order behind it is a keyboard walking into
         furniture nobody can see. */
      modal={coversEverything ? "trap-focus" : false}
      swipeDirection={besideTheBook ? "right" : "down"}
    >
      {/* No `container` means `<body>`, which is what a face needing nothing behind it wants —
          and the only thing available on the shelf. */}
      <BaseDrawer.Portal container={container}>
        {/* `data-needs` rides on all three parts rather than on an ancestor, and that is
            deliberate: the popup is portalled, so on the shelf it has no `.reader` above it to
            hang a rule on — and an attribute on the element itself survives the 180ms exit,
            which an open/closed flag on an ancestor does not (`styles/device.css`). */}
        <BaseDrawer.Backdrop className="panel-backdrop" data-needs={needs} />
        <BaseDrawer.Viewport className="panel-viewport" data-needs={needs}>
          <BaseDrawer.Popup className="panel-popup" data-needs={needs} data-testid={testId}>
            <header className="panel-header">
              <BaseDrawer.Title className="panel-title">
                {typeof title === "string" ? title : i18n._(title)}
              </BaseDrawer.Title>
              {/* **One ✕ at every width.** This used to be a ✕ beside the book and a ← over it,
                  on the reading that a full-screen panel is a place walked into rather than a
                  thing standing next to something. On a hand-held it is neither: the panel slides
                  down out of the way, which is a thing being put away, and ✕ is what that looks
                  like. One drawing, one entry, and nothing here that has to ask how wide the
                  window is. */}
              <BaseDrawer.Close
                className="ghost panel-close"
                aria-label={t({
                  message: "Close",
                  comment:
                    "Screen-reader name for the ✕ in the corner of a panel, at every width. A verb: it is the action, not a label for the thing being shut.",
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
