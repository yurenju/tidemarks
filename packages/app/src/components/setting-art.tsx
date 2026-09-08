import { fontStack } from "../lib/chinese";
import type { FontChoice } from "../lib/settings";

/**
 * The pictures on the tiles, and nothing else.
 *
 * A tile earns its extra height by **drawing the thing it sets** — two columns as two columns,
 * a typeface as its own letters (ADR-0050). A tile whose picture is a generic icon is a button
 * with decoration, and would be better off as a cell.
 *
 * Stroked rather than filled, at `currentColor`, so each one takes the tile's own state: muted
 * while the tile is unchosen, tide while it is, and both themes for free.
 *
 * ⚠️ **No two of these may be the same drawing.** [[Theme]]'s "System" and [[Columns]]' "Auto"
 * both mean "you decide", and the obvious half-filled circle for one of them was already the
 * other's — two settings drawn identically is exactly the failure a tile has and a cell does
 * not.
 */

const box = { viewBox: "0 0 34 26", fill: "none", stroke: "currentColor", width: 34, height: 26 };
const round = { viewBox: "0 0 26 26", fill: "none", stroke: "currentColor", width: 24, height: 24 };

/** Whatever the operating system is set to, as a disc half in each. */
export const themeSystem = (
  <svg {...round}>
    <circle cx="13" cy="13" r="9" />
    <path d="M13 4a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
  </svg>
);

export const themeLight = (
  <svg {...round}>
    <circle cx="13" cy="13" r="5" />
    <path d="M13 2v3M13 21v3M2 13h3M21 13h3M5 5l2 2M19 19l2 2M21 5l-2 2M7 19l-2 2" />
  </svg>
);

export const themeDark = (
  <svg {...round}>
    <path d="M17 3a10 10 0 1 0 6 15A11 11 0 0 1 17 3z" />
  </svg>
);

/**
 * Let the line length decide (ADR-0012), drawn as a page that is one column at the top and two
 * lower down — the only one of the three that shows both answers at once.
 */
export const columnsAuto = (
  <svg {...box}>
    <path d="M4 5h26M4 10h26M4 15h12M4 20h12M19 15h11M19 20h11" />
  </svg>
);

export const columnsOne = (
  <svg {...box}>
    <path d="M4 5h26M4 10h26M4 15h26M4 20h20" />
  </svg>
);

export const columnsTwo = (
  <svg {...box}>
    <path d="M3 5h12M3 10h12M3 15h12M3 20h9M19 5h12M19 10h12M19 15h12M19 20h9" />
  </svg>
);

/**
 * A typeface tile, set in the face it chooses — the one picture in here that is not a drawing,
 * because the letters *are* the thing being chosen.
 *
 * "Book's" has no face of its own to show: what it means is "whatever this book asked for", and
 * that is different in every book. It inherits, so it shows the panel's own face, which is the
 * honest answer to a question that has no single one.
 */
export function faceArt(choice: FontChoice) {
  // `false` is "not simplified", which only orders the two CJK faces inside the stack. The tile
  // shows two Latin letters, so the order cannot show — and there is no book here to ask.
  const family = choice === "publisher" ? undefined : fontStack(choice, false);
  return (
    <span className="tile-face" style={family === undefined ? undefined : { fontFamily: family }}>
      Aa
    </span>
  );
}
