// Scrubber — the draggable position axis. Owns the pure math of "where along the
// track is this pointer" and "where do the thumb and fill sit for a given
// progress fraction". Direction inversion for right-to-left books lives
// here, mirroring the axis so the book's head is on the right. React glue stays in
// Reader.tsx, and the chapter its preview bubble names comes from lib/toc.ts —
// that answer belongs to the table of contents, not to this axis.

// A reading fraction in [0, 1]: 0 = book start (head), 1 = book end (tail),
// regardless of visual direction.
export function pointerToFraction(x: number, width: number, rtl: boolean): number {
  if (width <= 0) return 0;
  const raw = clamp01(x / width);
  // A right-to-left book starts at the right, so x=width is 0% and the fraction grows leftwards.
  return rtl ? 1 - raw : raw;
}

export interface ScrubberGeometry {
  thumbX: number; // pixels from the track's left edge to the thumb centre
  fillStart: number; // left edge of the filled (already-read) region
  fillWidth: number;
}

// Where the thumb and the "already read" fill sit, in left-origin pixels. The
// fill always grows from the book's head end (left for a left-to-right book, right
// for a right-to-left one), and the thumb rides its leading edge.
export function scrubberGeometry(fraction: number, width: number, rtl: boolean): ScrubberGeometry {
  const fillWidth = clamp01(fraction) * width;
  // A right-to-left book starts at the right: the fill hugs that end and its origin backs off
  // leftwards by `fillWidth`.
  const fillStart = rtl ? width - fillWidth : 0;
  const thumbX = rtl ? fillStart : fillWidth;
  return { thumbX, fillStart, fillWidth };
}

/** One arrow key's worth of the book. A hundred presses cross it, which is about right. */
const KEY_STEP = 0.01;

/**
 * Where a key press moves the axis to, or `null` for a key this axis has nothing to do with.
 *
 * **The arrows follow the axis, not the fraction.** A right-to-left book is drawn mirrored, so
 * its head is on the right and pressing → walks towards it, which is backwards through the
 * book. Anyone can see which way the thumb went; nobody can see which way the fraction went.
 *
 * Up and down do not mirror: they are not on the axis at all, and the convention that up means
 * more holds whichever way the book opens.
 *
 * Returning the destination rather than a delta is what keeps this the same kind of answer as
 * `pointerToFraction`: the caller commits to a fraction, and where that fraction came from is
 * not its business.
 */
export function keyToFraction(key: string, fraction: number, rtl: boolean): number | null {
  const forward = rtl ? -KEY_STEP : KEY_STEP;
  switch (key) {
    case "ArrowRight":
      return clamp01(fraction + forward);
    case "ArrowLeft":
      return clamp01(fraction - forward);
    case "ArrowUp":
      return clamp01(fraction + KEY_STEP);
    case "ArrowDown":
      return clamp01(fraction - KEY_STEP);
    case "Home":
      return 0;
    case "End":
      return 1;
    default:
      return null;
  }
}

/**
 * How near a chapter's start a finger has to get before the axis lands on it.
 *
 * 2% of the book, which on a phone is about the width of the fingertip covering the rail. It is
 * a number about the hand rather than about the book, which is why it does not scale with how
 * long the book is.
 */
export const SNAP_TOLERANCE = 0.02;

/**
 * The position a drag settles on, given where the chapters start.
 *
 * **Only the coarse branch calls this** (ADR-0023): with a mouse, 1px is 1px, and a reader who
 * put the thumb somewhere on purpose gets to keep it there. A fingertip cannot aim that finely,
 * and "the start of the chapter" is the thing it was almost certainly aiming at.
 *
 * The two ends of the book are never given away. A last chapter that starts at 97% is ordinary,
 * and without this a reader dragging to the end would keep landing on its first page instead —
 * the final pages would have no way to reach them by drag at all.
 */
export function snapToChapter(
  fraction: number,
  starts: readonly number[],
  tolerance = SNAP_TOLERANCE,
): number {
  if (fraction <= tolerance || fraction >= 1 - tolerance) return fraction;

  let nearest = fraction;
  let best = tolerance;
  for (const start of starts) {
    const distance = Math.abs(start - fraction);
    if (distance <= best) {
      best = distance;
      nearest = start;
    }
  }
  return nearest;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
