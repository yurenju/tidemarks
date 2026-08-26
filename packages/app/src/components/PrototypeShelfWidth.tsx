/* PROTOTYPE — shelf width evaluation. Throwaway code on a throwaway branch; delete it whole.
   ==========================================================================================
   The question: `.library` stops widening at 736px, a figure measured back from the mark card's
   quote (40 ideographs at `--type-body`, plus the card's padding — `docs/specs/device-sizing/`).
   The quote's own ceiling is not up for debate; what is, is whether the *cover wall* has to
   inherit it. Today it does, so a 2560px display gets five columns of covers.

   Four variants on the real shelf, switchable with `?proto=`, plus a live width slider (`?w=`)
   so the answer can be dragged rather than guessed. DEV only — mounted from `Library.tsx`. */

import { useEffect, useState } from "react";

const VARIANTS = [
  { key: "A", name: "736 cap (today)" },
  { key: "B", name: "Whole page widens" },
  { key: "C", name: "Only the wall widens" },
  { key: "D", name: "Card beside the wall" },
];

/* Written as attribute selectors on `.library` so no variant needs its own JSX — the thing under
   evaluation is the container, and duplicating the shelf four times would only add ways to drift. */
const CSS = `
.library[data-proto="B"],
.library[data-proto="C"],
.library[data-proto="D"] { max-width: var(--proto-w); }

/* C — the wall takes the whole width, everything that carries reading stays at 736 and keeps
   the left edge, so the quote is not stranded in the middle of a wide page. */
.library[data-proto="C"] .mark-card,
.library[data-proto="C"] .reading-now,
.library[data-proto="C"] .shelf-actions { max-width: 736px; }

/* D — two columns above 1000px: the card and the row on the left, the wall filling the rest.
   Below that it falls back to B's stack, because a 26rem column would squeeze the quote. */
@media (min-width: 1000px) {
  .library[data-proto="D"] .shelf {
    display: grid;
    grid-template-columns: minmax(0, 26rem) minmax(0, 1fr);
    align-items: start;
    column-gap: var(--space-4);
  }
  .library[data-proto="D"] .mark-card,
  .library[data-proto="D"] .marks-empty { grid-column: 1; grid-row: 1; margin-inline: var(--space-4); }
  .library[data-proto="D"] .reading-now { grid-column: 1; grid-row: 2; }
  .library[data-proto="D"] .cover-wall { grid-column: 2; grid-row: 1 / span 2; }
}

.proto-bar {
  position: fixed;
  z-index: 9999;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 999px;
  background: #111;
  color: #fff;
  font: 12px/1.4 ui-monospace, monospace;
  box-shadow: 0 4px 16px rgb(0 0 0 / 35%);
}
.proto-bar button {
  min-height: 0;
  padding: 2px 8px;
  color: #fff;
  background: #333;
  border: 0;
  border-radius: 6px;
  font: inherit;
}
.proto-bar b { min-width: 15ch; }
.proto-bar i { opacity: 0.6; font-style: normal; }
`;

/** What the variant actually produced, read back off the page after it settled. */
function measure() {
  const library = document.querySelector<HTMLElement>(".library");
  const wall = document.querySelector<HTMLElement>(".cover-wall");
  const quote = document.querySelector<HTMLElement>(".mark-quote");
  const columns = wall ? getComputedStyle(wall).gridTemplateColumns.split(" ").length : 0;
  return {
    page: Math.round(library?.getBoundingClientRect().width ?? 0),
    columns,
    quote: Math.round(quote?.getBoundingClientRect().width ?? 0),
  };
}

export function PrototypeShelfWidth() {
  const params = new URLSearchParams(location.search);
  const [variant, setVariant] = useState(params.get("proto") ?? "A");
  const [width, setWidth] = useState(Number(params.get("w")) || 1100);
  const [state, setState] = useState(measure);

  useEffect(() => {
    const library = document.querySelector<HTMLElement>(".library");
    if (!library) return;
    library.dataset.proto = variant;
    library.style.setProperty("--proto-w", `${width}px`);

    const next = new URLSearchParams(location.search);
    next.set("proto", variant);
    next.set("w", String(width));
    history.replaceState(null, "", `?${next}`);

    // One frame later, so the numbers are what the browser laid out and not what it was about to.
    const frame = requestAnimationFrame(() => setState(measure()));
    return () => cancelAnimationFrame(frame);
  }, [variant, width]);

  // Polled rather than observed: the shelf arrives from Dexie a moment after this mounts, and the
  // wall's column count changes without the elements around it changing size. A prototype readout
  // can afford a timer; wiring an observer per element cannot be afforded to get wrong.
  useEffect(() => {
    const timer = setInterval(() => setState(measure()), 400);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      // Arrows belong to whatever the reader is typing in — including this bar's own slider.
      if (el instanceof HTMLElement && (el.isContentEditable || /INPUT|TEXTAREA/.test(el.tagName)))
        return;
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      const at = VARIANTS.findIndex((v) => v.key === variant);
      setVariant(VARIANTS[(at + step + VARIANTS.length) % VARIANTS.length]!.key);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant]);

  const current = VARIANTS.find((v) => v.key === variant) ?? VARIANTS[0]!;
  const cycle = (step: number) => {
    const at = VARIANTS.findIndex((v) => v.key === variant);
    setVariant(VARIANTS[(at + step + VARIANTS.length) % VARIANTS.length]!.key);
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="proto-bar">
        <button onClick={() => cycle(-1)}>←</button>
        <b>
          {current.key} — {current.name}
        </b>
        <button onClick={() => cycle(1)}>→</button>
        <input
          type="range"
          min={736}
          max={2000}
          step={4}
          value={width}
          disabled={variant === "A"}
          onChange={(e) => setWidth(Number(e.target.value))}
        />
        <i>
          slider {width} · page {state.page} · {state.columns} cols · quote {state.quote}
        </i>
      </div>
    </>
  );
}
