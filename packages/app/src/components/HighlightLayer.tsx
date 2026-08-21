import type { CSSProperties } from "react";
import { markVar, type HighlightBox } from "../lib/highlights";
import type { Annotation } from "../lib/types";

export interface PaintedHighlight {
  annotation: Annotation;
  boxes: HighlightBox[];
}

// The highlight layer, drawn over the book.
//
// frond renders no highlights — it reports where a CFI range currently sits and when that
// geometry went stale, and the drawing is ours (its ADR-0002). This component is deliberately
// the dumb half of that: the Reader computes which boxes are on the page in front of the
// reader (`highlights.ts`'s `visibleBoxes`) and this paints them.
//
// **It takes no pointer events.** Tapping a highlight to open its note is handled from
// frond's `pointerup`, which arrives in these very coordinates, so the layer can stay
// `pointer-events: none` — otherwise it would sit between the reader and the page, swallowing
// the taps that turn it.
// The theme is not a prop: each box carries the name of its ink and `index.css` decides what
// that ink looks like on a light page and on a dark one. A highlight drawn before the reader
// switched themes redraws in the right one without this component hearing about it.
//
// **The writing mode is a prop, because CSS cannot see it from here.** A mark is a wavy line
// along the edge of the text, and which edge that is depends on how the book is set: under the
// baseline in a horizontal book, down the right-hand side in a vertical one — where a Chinese
// reader expects 傍線. The box itself is axis-aligned either way, so nothing about its geometry
// says which. `Reader.tsx` already holds the answer, from frond's `writingMode` event.
export default function HighlightLayer({
  painted,
  vertical = false,
}: {
  painted: readonly PaintedHighlight[];
  vertical?: boolean;
}) {
  return (
    <div className="highlight-layer" aria-hidden>
      {painted.map(({ annotation, boxes }) =>
        boxes.map((box, index) => (
          <div
            key={`${annotation.id}-${index}`}
            className="highlight-box"
            data-axis={vertical ? "v" : "h"}
            style={
              {
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
                "--mark": markVar(annotation.color),
              } as CSSProperties
            }
          />
        )),
      )}
    </div>
  );
}
