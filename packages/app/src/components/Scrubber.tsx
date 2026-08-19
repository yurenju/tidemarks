import { useRef, useState } from "react";

import { keyToFraction, pointerToFraction, scrubberGeometry, snapToChapter } from "../lib/scrubber";

// The draggable position axis at the bottom of the reader. Owns only pointer
// interaction and layout; the fraction/geometry math lives in lib/scrubber.ts and
// the epub reach-through (jump target, chapter label) is injected by the parent.
//
// Commit-on-release (Q3): dragging only moves a preview bubble; the real jump
// fires on pointer-up. A plain tap is just a down+up with no move, so it commits
// to the tapped position too. Geometry is emitted as percentages (width = 1) so
// the bar needs no width measurement to render.

interface ScrubberProps {
  fraction: number; // current reading position, 0..1
  rtl: boolean; // right-to-left book: the axis mirrors, head on the right (Q5)
  disabled: boolean; // locations not generated yet (Q4)
  chapterFor: (fraction: number) => string | null;
  /**
   * Where the chapters start, as whole-book fractions, for a finger to land on. Empty until
   * frond has an index — and until then the axis is disabled anyway.
   */
  chapterStarts: readonly number[];
  onCommit: (fraction: number) => void;
}

export default function Scrubber({
  fraction,
  rtl,
  disabled,
  chapterFor,
  chapterStarts,
  onCommit,
}: ScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const dragging = preview !== null;

  // horizontal inset of the rail (matches --scrubber-inset in CSS); the usable
  // track for dragging is [inset, width - inset] so 0%/100% land on the end caps.
  function insetPx(el: HTMLElement): number {
    return parseFloat(getComputedStyle(el).getPropertyValue("--scrubber-inset")) || 0;
  }

  function fractionFromEvent(e: React.PointerEvent): number {
    const el = trackRef.current!;
    const rect = el.getBoundingClientRect();
    const inset = insetPx(el);
    const at = pointerToFraction(e.clientX - (rect.left + inset), rect.width - 2 * inset, rtl);
    // A fingertip covers about 2% of this rail, so it is given the chapter it was aiming at.
    // A mouse is not: 1px is 1px, and a position chosen precisely is kept.
    //
    // **The event says which, not a media query** (ADR-0023). `any-pointer: coarse` answers
    // "could a finger reach this screen", which is the right question for how big a target has
    // to be and the wrong one for a drag that is happening right now: on a touch laptop it is
    // true while the hand is on the trackpad, and the mouse would start snapping.
    const finger = e.pointerType !== "mouse";
    // Snapped here rather than on release, so the preview bubble names the chapter the reader
    // is about to get. A bubble that says one thing and a jump that does another is worse than
    // no snapping at all.
    return finger ? snapToChapter(at, chapterStarts) : at;
  }

  // CSS position of a fraction (0..1) within the inset rail, and the width of a
  // fractional span — so the fill/thumb/bubble align with the end caps.
  const railPos = (f: number) =>
    `calc(var(--scrubber-inset) + ${f} * (100% - 2 * var(--scrubber-inset)))`;
  const railSpan = (w: number) => `calc(${w} * (100% - 2 * var(--scrubber-inset)))`;

  function onPointerDown(e: React.PointerEvent) {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setPreview(fractionFromEvent(e));
  }

  function onPointerMove(e: React.PointerEvent) {
    if (preview === null) return;
    setPreview(fractionFromEvent(e));
  }

  function onPointerUp(e: React.PointerEvent) {
    if (preview === null) return;
    const target = fractionFromEvent(e);
    setPreview(null);
    onCommit(target);
  }

  /**
   * The keyboard's way onto the axis.
   *
   * There is no commit-on-release here and nothing is missing: a key press *is* its release,
   * so each one jumps. What a drag defers is the jump the reader has not finished aiming, and
   * a press has nothing left to aim.
   *
   * **The propagation stop is load-bearing.** The reader listens for the arrow keys on the
   * document and turns a page with them, so without this a reader driving the axis would turn
   * a page for every step they took along it.
   */
  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    const target = keyToFraction(e.key, fraction, rtl);
    if (target === null) return;
    e.preventDefault();
    e.stopPropagation();
    onCommit(target);
  }

  // The other half of the same stop: the page turn listens on `keyup`, and the press that
  // moved the axis must not arrive there either.
  function onKeyUp(e: React.KeyboardEvent) {
    if (disabled) return;
    if (keyToFraction(e.key, fraction, rtl) !== null) e.stopPropagation();
  }

  const shown = preview ?? fraction;
  const geo = scrubberGeometry(shown, 1, rtl); // width = 1 → geometry in 0..1 (as %)
  const pct = Math.round(shown * 100);
  const chapter = preview !== null ? chapterFor(preview) : null;

  return (
    <div
      className={["scrubber", rtl && "scrubber-rtl", dragging && "dragging", disabled && "disabled"]
        .filter(Boolean)
        .join(" ")}
    >
      {dragging && (
        <div className="scrubber-preview" style={{ left: railPos(geo.thumbX) }}>
          {chapter && <span className="scrubber-chapter">{chapter}</span>}
          <span className="scrubber-pct">{pct}%</span>
        </div>
      )}
      <div
        ref={trackRef}
        className="scrubber-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        data-testid="scrubber-track"
        /* `slider`, not `progressbar`: this axis is driven, and a progressbar is a readout.
           Announcing it as one told a screen-reader reader that the one control they had for
           moving through the book was something to look at. */
        role="slider"
        aria-label="閱讀進度"
        aria-orientation="horizontal"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${pct}%`}
        /* Focusable even while disabled, so it can say so. Dropping out of the tab order
           until the index is built would instead have it appear from nowhere mid-chapter. */
        tabIndex={0}
        aria-disabled={disabled}
      >
        <div
          className="scrubber-fill"
          style={{ left: railPos(geo.fillStart), width: railSpan(geo.fillWidth) }}
        />
        {/* head = filled, tail = hollow; CSS swaps their ends for rtl books */}
        <span className="scrubber-cap scrubber-cap-head" aria-hidden />
        <span className="scrubber-cap scrubber-cap-tail" aria-hidden />
        <div className="scrubber-thumb" style={{ left: railPos(geo.thumbX) }} />
      </div>
    </div>
  );
}
