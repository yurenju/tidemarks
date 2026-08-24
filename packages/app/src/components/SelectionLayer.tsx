import { useLingui } from "@lingui/react/macro";
import type { Rect, SelectionEnds } from "../lib/selection-handles";

// The selection the app draws itself, on touch (ADR-0036): a wash over the chosen passage and
// a handle at each end of it.
//
// **A wash, not a wave.** The wave belongs to 〈螢光〉 — to a mark the reader has already made,
// which is 墨. A selection is still 潮: it can move, and it may yet come to nothing. Drawing
// both the same shape would leave the reader unable to tell "I marked this" from "I am about to"
// (CONTEXT.md 〈接管選取〉), and indigo against tide is the closest pair of colours in the app.
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
      point: ends.start,
      label: t({
        message: "Selection start",
        comment:
          "Screen-reader name for the draggable handle at the beginning of a passage the reader is selecting by touch. Dragging it moves that end of the selection.",
      }),
    },
    {
      end: "end" as const,
      point: ends.end,
      label: t({
        message: "Selection end",
        comment:
          "Screen-reader name for the draggable handle at the end of a passage the reader is selecting by touch. Dragging it moves that end of the selection.",
      }),
    },
  ];

  return (
    <div className="selection-layer">
      {rects.map((rect, index) => (
        <div
          key={index}
          className="selection-wash"
          aria-hidden
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        />
      ))}
      {handles.map(({ end, point, label }) => (
        <button
          key={end}
          type="button"
          className="selection-handle"
          data-end={end}
          data-axis={axis}
          aria-label={label}
          style={{ left: point.x, top: point.y }}
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
