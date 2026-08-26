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
  { key: "E", name: "Wall-wide box, rule at the page edge" },
  { key: "F", name: "Wall-wide box, rule at the reading" },
  { key: "G", name: "Wall-wide box, reading left with the wall" },
  { key: "H", name: "Card at 736, centred" },
  { key: "I", name: "F, quote marks instead of the rule" },
  { key: "K", name: "I + the note on its own surface" },
  { key: "L", name: "I + the ink moves to the note" },
  { key: "M", name: "I + the note in the interface's voice" },
];

/* Written as attribute selectors on `.library` so no variant needs its own JSX — the thing under
   evaluation is the container, and duplicating the shelf four times would only add ways to drift. */
const CSS = `
.library[data-proto="B"],
.library[data-proto="C"],
.library[data-proto="E"],
.library[data-proto="F"],
.library[data-proto="G"],
.library[data-proto="H"],
.library[data-proto="I"],
.library[data-proto="K"],
.library[data-proto="L"],
.library[data-proto="M"] { max-width: var(--proto-w); }

/* The row and the shelf's two verbs stay at 736 in every variant from C on, so what changes
   between them is the card and nothing else. */
.library[data-proto="C"] .reading-now,
.library[data-proto="C"] .shelf-actions,
.library[data-proto="E"] .reading-now,
.library[data-proto="E"] .shelf-actions,
.library[data-proto="F"] .reading-now,
.library[data-proto="F"] .shelf-actions,
.library[data-proto="G"] .reading-now,
.library[data-proto="G"] .shelf-actions,
.library[data-proto="H"] .reading-now,
.library[data-proto="H"] .shelf-actions,
.library[data-proto="I"] .reading-now,
.library[data-proto="I"] .shelf-actions,
.library[data-proto="K"] .reading-now,
.library[data-proto="K"] .shelf-actions,
.library[data-proto="L"] .reading-now,
.library[data-proto="L"] .shelf-actions,
.library[data-proto="M"] .reading-now,
.library[data-proto="M"] .shelf-actions { max-width: 736px; }

/* C — the card keeps its whole box at 736 and its left edge, so it lines up with the covers
   below it and the wall widens alone. */
.library[data-proto="C"] .mark-card { max-width: 736px; }

/* E — the box runs the wall's full width and the reading is held in the middle of it. The rule
   stays out at the far edge, which is the thing to judge: it says which colour the passage was
   marked in, and from there it is no longer pointing at anything. */
.library[data-proto="E"] .mark-card {
  padding-inline: max(var(--space-6), calc((100% - 736px) / 2));
}

/* F — E with the rule brought in to stand at the left of the reading, where it points at the
   words again. Drawn as a pseudo-element because the box's own border can only sit on the box's
   edge; \`border-left-color: inherit\` picks up the mark's own ink, which \`MarkCard\` sets on the
   element, so a passage marked in another colour still comes out in that colour. */
.library[data-proto="F"] .mark-card {
  position: relative;
  padding-inline: max(var(--space-6), calc((100% - 736px) / 2));
  border-left-style: none;
  border-radius: var(--radius-surface);
}
.library[data-proto="F"] .mark-card::before {
  content: "";
  position: absolute;
  top: var(--space-4);
  bottom: var(--space-4);
  left: calc(max(var(--space-6), (100% - 736px) / 2) - 0.9rem);
  border-left: 3px solid;
  border-left-color: inherit;
}

/* G — the box runs full width and the reading sits at its left edge rather than in the middle,
   so the rule is where it always was and the quote starts on the same line as the first cover.
   The empty half is on the right, which is where the wall's own leftover strip is. */
.library[data-proto="G"] .mark-card > * { max-width: 704px; }

/* I, K, L — F's geometry, and the rule replaced by a pair of directional quotation marks: one
   hung off the top-left of the reading, one under its right end. They are the ink's colour, so
   what the rule used to say — which colour the reader marked this in — is still on the card,
   said by the punctuation instead of by a line down the side.

   The closing mark's top is added up from the same tokens the card is built from: its own
   padding, the source line, the gap, and the quote's held-open height. Written out rather than
   measured because nothing here is the browser's to decide. */
.library[data-proto="I"] .mark-card,
.library[data-proto="K"] .mark-card,
.library[data-proto="L"] .mark-card,
.library[data-proto="M"] .mark-card {
  position: relative;
  padding-inline: max(var(--space-6), calc((100% - 736px) / 2));
  border-left-style: none;
  border-radius: var(--radius-surface);
}

.library[data-proto="I"] .mark-card::before,
.library[data-proto="K"] .mark-card::before,
.library[data-proto="L"] .mark-card::before,
.library[data-proto="M"] .mark-card::before,
.library[data-proto="I"] .mark-card::after,
.library[data-proto="K"] .mark-card::after,
.library[data-proto="L"] .mark-card::after,
.library[data-proto="M"] .mark-card::after {
  position: absolute;
  font-size: 3.5rem;
  line-height: 1;
  color: var(--mark-ink);
  opacity: 0.55;
  pointer-events: none;
}

.library[data-proto="I"] .mark-card::before,
.library[data-proto="K"] .mark-card::before,
.library[data-proto="L"] .mark-card::before,
.library[data-proto="M"] .mark-card::before {
  content: "\\201C";
  top: calc(var(--space-4) - 0.6rem);
  left: calc(max(var(--space-6), (100% - 736px) / 2) - 2.2rem);
}

.library[data-proto="I"] .mark-card::after,
.library[data-proto="K"] .mark-card::after,
.library[data-proto="L"] .mark-card::after,
.library[data-proto="M"] .mark-card::after {
  content: "\\201D";
  top: calc(
    var(--space-4) + var(--type-lede) * var(--leading-title) + 0.5rem +
      var(--mark-quote-lines) * var(--leading-text) * var(--type-body) - 1.6rem
  );
  right: calc(max(var(--space-6), (100% - 736px) / 2) - 2.2rem);
}

/* K — the reader's words on their own piece of paper. The passage is the book's and stays on the
   card's own surface; the note is lifted onto the page's surface with a rule of space above it,
   so the two stop reading as one column of text in two sizes. */
.library[data-proto="K"] .mark-note,
.library[data-proto="K"] .mark-note-input {
  margin-top: 0.4rem;
  padding: 0.7rem 0.9rem;
  height: calc(var(--mark-note-lines) * var(--leading-text) * 1em + 1.4rem);
  background: var(--surface-page);
  border: 1px solid var(--line-hair);
  border-radius: var(--radius-surface);
}

/* L — the rule is not deleted, it is moved. It leaves the card, where it bracketed the book's
   words, and goes to the note, where it brackets the reader's — and the quotation marks take
   over saying which colour the passage was marked in. */
.library[data-proto="L"] .mark-note,
.library[data-proto="L"] .mark-note-input {
  margin-top: 0.4rem;
  padding-left: 0.8rem;
  border-left: 3px solid var(--mark-ink);
}

/* M — the two are told apart by voice rather than by a box or a rule. The passage stays in the
   book's serif; the note goes into the face the interface speaks in, above a hair rule that says
   where the book stops and the reader starts. No italic: CJK has no italic, so a browser asked
   for one slants the glyphs itself, and a synthesised slant on Chinese is worse than no signal. */
.library[data-proto="M"] .mark-note,
.library[data-proto="M"] .mark-note-input {
  margin-top: 0.6rem;
  padding-top: 0.7rem;
  border-top: 1px solid var(--line-hair);
  font-family: var(--font-control);
}

/* H — no stretching at all: the same card as today, centred in the wide page instead of held to
   the left. The rule stays against the reading, and nothing lines up with the wall below. */
.library[data-proto="H"] .mark-card { max-width: 736px; margin-inline: auto; }

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
