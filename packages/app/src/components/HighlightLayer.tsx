import type { CSSProperties } from "react";
import { markVar, type HighlightBox } from "../lib/highlights";
import type { Annotation } from "../lib/types";

export interface PaintedHighlight {
  annotation: Annotation;
  /** The strips of wave to draw — one per line of the passage. */
  strips: HighlightBox[];
  /** Where a tap counts as landing on this passage. Not the same boxes: see `Reader.tsx`. */
  targets: HighlightBox[];
  /** The passage itself, filled in while the notes panel points at it. Also not the same boxes. */
  wash: HighlightBox[];
}

// The highlight layer, drawn over the book.
//
// frond renders no highlights — it reports where a CFI range currently sits and when that
// geometry went stale, and the drawing is ours (frond ADR-0002). This component is deliberately
// the dumb half of that: the Reader computes which boxes are on the page in front of the
// reader (`highlights.ts`'s `visibleBoxes`) and this paints them.
//
// **It takes no pointer events.** Tapping a highlight to open its note is handled from
// frond's `pointerup`, which arrives in these very coordinates, so the layer can stay
// `pointer-events: none` — otherwise it would sit between the reader and the page, swallowing
// the taps that turn it.
// The theme is not a prop: each box carries the name of its ink and `styles/tokens.css` decides
// what
// that ink looks like on a light page and on a dark one. A highlight drawn before the reader
// switched themes redraws in the right one without this component hearing about it.
//
// **Each box *is* a mark, not the text a mark belongs to.** `markStrips` has already decided
// where the wave goes — outside the outermost ink on its line, one strip per line — because
// that placement needs the ink extents and the line grouping, and CSS can see neither. All
// that is left here is which of the two tiles to fill it with.
//
// **The writing mode is a prop, because CSS cannot see it from here either.** Which edge of
// the text a mark runs along depends on how the book is set: under the line in a horizontal
// book, down the right-hand side in a vertical one, where a Chinese reader expects 傍線. A
// strip is axis-aligned either way, so nothing about its geometry says which. `Reader.tsx`
// already holds the answer, from frond's `writingMode` event.
//
// **The `ref` is how a page turn moves it.** A turn slides the page under this layer, and the
// marks have to travel with the text they belong to; `Reader.tsx` writes the transform straight
// onto this element once per animation frame rather than through a prop, because re-rendering
// the reader sixty times a second to move one box is the whole tree paying for a transform.
// **`selectedId` fills in one passage, and it is not the same thing as a mark.** The reader
// pressed that passage in the notes panel and the panel stayed open, so nothing else on screen
// says which of the marks on this page they asked for. The wave alone cannot: every mark wears
// one. What is being answered is "this passage", not "a mark runs beside these lines", so the
// filling follows the words themselves — its own set of boxes, `textBoxes`, which is neither
// the strips nor the tap targets.
export default function HighlightLayer({
  ref,
  painted,
  vertical = false,
  selectedId = null,
}: {
  ref?: React.Ref<HTMLDivElement>;
  painted: readonly PaintedHighlight[];
  vertical?: boolean;
  selectedId?: string | null;
}) {
  return (
    <div className="highlight-layer" ref={ref} aria-hidden>
      {painted.map(({ annotation, wash }) =>
        annotation.id !== selectedId
          ? null
          : wash.map((box, index) => (
              <div
                key={`wash-${annotation.id}-${index}`}
                className="highlight-wash"
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
      {painted.map(({ annotation, strips }) =>
        strips.map((strip, index) => (
          <div
            key={`${annotation.id}-${index}`}
            className="highlight-box"
            data-axis={vertical ? "v" : "h"}
            style={
              {
                left: strip.left,
                top: strip.top,
                width: strip.width,
                height: strip.height,
                "--mark": markVar(annotation.color),
              } as CSSProperties
            }
          />
        )),
      )}
    </div>
  );
}
