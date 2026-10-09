import { useLingui } from "@lingui/react/macro";
import type { CSSProperties } from "react";
import {
  markVar,
  noteDotName,
  NOTE_DOT_SIZE,
  type HighlightBox,
  type NoteDotGroup,
} from "../lib/highlights";
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
//
// **The [[Note dot]]s are on this layer too, and are the one part of it that is not hidden.** They
// are drawn here so a turn slides them with the marks (`slideMarks` moves this element and nothing
// else). Each group is a button, so it is reached by Tab in book order and named for the screen
// reader; the marks around them are decoration and stay `aria-hidden`. A press with the pointer
// still goes through frond's `pointerup` like a press on a mark (`Reader.tsx`'s `markAt`), since
// the buttons take no pointer events either: what they add is the keyboard's way in.
export default function HighlightLayer({
  ref,
  painted,
  dots = [],
  onDot,
  vertical = false,
  selectedId = null,
}: {
  ref?: React.Ref<HTMLDivElement>;
  painted: readonly PaintedHighlight[];
  dots?: readonly NoteDotGroup[];
  onDot?: (id: string) => void;
  vertical?: boolean;
  selectedId?: string | null;
}) {
  const { t } = useLingui();
  const passage = (id: string) =>
    painted.find((entry) => entry.annotation.id === id)?.annotation.text ?? "";

  return (
    <div className="highlight-layer" ref={ref}>
      <div aria-hidden>
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
        {/* **While one passage is selected, it is the wash and nothing else.** A wave over the
          wash said "a mark" a second time in the colour that was already saying "this one". The
          other marks stay exactly as they were: the wash is enough to tell the selected one
          apart, and fading the rest made the page look as if they had been half taken back. The
          same rule for a vertical book — the wave runs down the side there, and the wash is the
          same block on the words. */}
        {painted.map(({ annotation, strips }) =>
          annotation.id === selectedId
            ? null
            : strips.map((strip, index) => (
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
      {dots.map(({ dots: pair, target }) => {
        const first = pair[0]!;
        const excerpt = noteDotName(passage(first.id));
        return (
          <button
            key={`dot-${first.id}`}
            type="button"
            className="note-dot"
            data-testid="note-dot"
            style={{
              left: target.left,
              top: target.top,
              width: target.width,
              height: target.height,
            }}
            aria-label={t({
              message: `Note: ${excerpt}`,
              comment:
                "Screen-reader name of a [[Note dot]], the small dot in the page margin beside a marked passage that has a note. The placeholder is the first few characters of the marked passage, so the reader knows which note it is. Pressing it opens [[Reflect]] on that note.",
            })}
            onClick={() => onDot?.(first.id)}
          >
            {pair.map((dot) => (
              <span
                key={dot.id}
                className="note-dot-ink"
                style={
                  {
                    left: dot.x - target.left - NOTE_DOT_SIZE / 2,
                    top: dot.y - target.top - NOTE_DOT_SIZE / 2,
                    "--mark": markVar(dot.color),
                  } as CSSProperties
                }
              />
            ))}
          </button>
        );
      })}
    </div>
  );
}
