import { useLingui } from "@lingui/react/macro";
import { handleReach, washRect, type Rect, type SelectionEnds } from "../lib/selection-handles";

// The selection the app draws itself, on touch (ADR-0036): a wash over the chosen passage and
// a handle at each end of it.
//
// **A wash, not a wave.** The wave belongs to [[Mark]] — to a mark the reader has already made,
// which is 墨. A selection is still 潮: it can move, and it may yet come to nothing. Drawing
// both the same shape would leave the reader unable to tell "I marked this" from "I am about to"
// (CONTEXT.md [[Owned selection]]), and indigo against tide is the closest pair of colours in the app.
//
// **Only the handles take pointer events**, and the layer as a whole must not: the page under it
// has to keep receiving the presses that turn it. So the wash is inert and each handle captures
// its own pointer, which is also what keeps a handle drag alive when the finger leaves the bead.
//
// The wash boxes are `aria-hidden` and the handles are real buttons with names. That split is
// the whole of what ADR-0036 owes ADR-0021 in this round: the wash says nothing a screen reader
// cannot already get from the text, while a control with no name is a control that is gone.
export default function SelectionLayer({
  rects,
  ends,
  vertical = false,
  onHandlePointer,
}: {
  /** Where the passage sits, in container coordinates — one rectangle per line, as frond reports them. */
  rects: readonly Rect[];
  ends: SelectionEnds;
  vertical?: boolean;
  /**
   * A pointer event on one of the handles, with the handle it landed on.
   *
   * The gesture itself is `Reader.tsx`'s, like every other gesture in the book: this component
   * knows where the ends are and nothing about what dragging one means.
   */
  onHandlePointer: (
    kind: "down" | "move" | "up" | "cancel",
    end: "start" | "end",
    event: React.PointerEvent<HTMLButtonElement>,
  ) => void;
}) {
  const { t } = useLingui();
  const axis = vertical ? "v" : "h";

  const handles = [
    {
      end: "start" as const,
      point: ends.start.point,
      span: ends.start.span,
      label: t({
        message: "Selection start",
        comment:
          "Screen-reader name for the draggable handle at the beginning of a passage the reader is selecting by touch. Dragging it moves that end of the selection.",
      }),
    },
    {
      end: "end" as const,
      point: ends.end.point,
      span: ends.end.span,
      label: t({
        message: "Selection end",
        comment:
          "Screen-reader name for the draggable handle at the end of a passage the reader is selecting by touch. Dragging it moves that end of the selection.",
      }),
    },
  ];

  return (
    <div
      className="selection-layer"
      /* How far past the text a bead is held off, so it begins where the colour ends
         (`handleReach`). It differs by writing mode and CSS cannot see which one is in force,
         so it is set once here and inherited by both handles. */
      style={{ ["--handle-reach" as string]: `${handleReach(vertical)}px` }}
    >
      {rects.map((rect, index) => {
        // Let out across the strip under vertical setting, where the box frond reports stops at
        // the glyphs (`washRect`). Done here rather than to the rectangles the reader's selection
        // is held as: the handles are placed from the same boxes, and a bead belongs on the edge
        // of the text rather than on the edge of its colour.
        const wash = washRect(rect, vertical);
        return (
          <div
            key={index}
            className="selection-wash"
            aria-hidden
            style={{ left: wash.x, top: wash.y, width: wash.width, height: wash.height }}
          />
        );
      })}
      {handles.map(({ end, point, span, label }) => (
        <button
          key={end}
          type="button"
          className="selection-handle"
          data-end={end}
          data-axis={axis}
          aria-label={label}
          /* Named but not tabbable. A button that answers to no key is a stop in the tab order
             that does nothing when it is reached, which is worse than not being there — while
             the name still reaches a screen reader moving through the page, which is what it is
             for. Adjusting a selection from a keyboard is the desk's, where the browser's own
             selection is still in charge (ADR-0036). */
          tabIndex={-1}
          /* `--handle-span` is how far the wash reaches back from this bead, which decides how
             long its stem is drawn: a stem that stops short of the colour leaves the bead
             floating beside the passage instead of holding on to it. The width of a line is not
             something `book.css` can know — the reader sets the type and the book has its own
             CSS — so it arrives here as a number and `book.css` does the arithmetic. */
          style={{ left: point.x, top: point.y, ["--handle-span" as string]: `${span}px` }}
          onPointerDown={(event) => {
            // The finger owns this handle until it lifts, wherever it travels — without the
            // capture the drag stops the moment it leaves the bead, which is immediately.
            event.currentTarget.setPointerCapture(event.pointerId);
            onHandlePointer("down", end, event);
          }}
          onPointerMove={(event) => onHandlePointer("move", end, event)}
          onPointerUp={(event) => onHandlePointer("up", end, event)}
          onPointerCancel={(event) => onHandlePointer("cancel", end, event)}
        />
      ))}
    </div>
  );
}
