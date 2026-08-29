/**
 * ⚠️ PROTOTYPE — throwaway. Not production code, not translated, not tested.
 *
 * Question it answers: what does the revisit card look like once it stops being the place where
 * revisiting *happens* and becomes only the way in? A notes screen is coming; when it does, the
 * card's whole job is to raise one passage and hand the reader somewhere to go. Until that screen
 * exists, every "go" here lands on the passage inside its book — the same place `mark-quote`
 * already goes.
 *
 * Variants of the shelf's card, on the shelf itself, switched by `?variant=` in the address bar
 * (a query, deliberately, so it does not touch the app's own hash routing).
 *
 *   A  — quote only. One passage, one press. No note, no writing, no controls.
 *   B  — quote plus the reader's own note. Both held to the reading ceiling, nothing beside them.
 *   B2 — the same reading, with the book in one margin and a draw pinned in the corner.
 *   B3 — the same reading, with both margins spent on the one book it came from.
 *   C  — no passage at all: a count and the covers it came from, as a doorway.
 *
 * ⚠️ **The ceiling is `LINE_LENGTH`, not a number written here** (ADR-0012, and the shipping card
 * already reads it). 40 ems of ideographs or 30 of Latin, measured in the quote's own type size,
 * so a passage of Chinese and a passage of English each get the line their script reads at. Once
 * it bites there is room left over on a wide screen, and B, B2 and B3 are three answers to what
 * that room is for — nothing, the day's pile, or this one book.
 *
 * Everything is inert except the presses that leave the shelf. No note writing, no
 * `Another five`, no `lastShownAt` bookkeeping — those belong to whatever wins, written properly.
 */

import { useEffect, useState } from "react";
import { detectScript, LINE_LENGTH } from "../lib/line-length";
import { relativeAge, type RelativeAge } from "../lib/revisit";
import type { Annotation, BookRecord } from "../lib/types";

export const VARIANTS = ["A", "B", "B2", "B3", "C", "current"] as const;
export type Variant = (typeof VARIANTS)[number];

const NAMES: Record<Variant, string> = {
  A: "Quote only",
  B: "Quote + note, margins empty",
  B2: "…book left, draw in the corner",
  B3: "…the one book, both sides",
  C: "Doorway, no quote",
  current: "Today's card, unchanged",
};

/** `?variant=` off the real address bar. Anything unreadable means the card as it ships. */
export function readVariant(): Variant {
  const asked = new URLSearchParams(window.location.search).get("variant");
  return VARIANTS.includes(asked as Variant) ? (asked as Variant) : "current";
}

const AGE_WORDS: Record<RelativeAge, string> = {
  justNow: "Just now",
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  lastWeek: "Last week",
  thisMonth: "This month",
  lastMonth: "Last month",
  thisYear: "This year",
  lastYear: "Last year",
  longAgo: "Years ago",
};

function ageOf(mark: Annotation): string {
  return AGE_WORDS[relativeAge(Date.now(), mark.createdAt)];
}

/**
 * A — the passage, and nothing else.
 *
 * The whole card is one target. There is no way to move through the five from here: the count on
 * the right is a fact, and pressing anywhere goes to where the passage lives, which is where the
 * other four will be reachable once the notes screen exists.
 */
function VariantA({ batch, books, onOpenPassage }: VariantProps) {
  const mark = batch[0]!;
  return (
    <section className="proto-card" data-testid="mark-card">
      <button className="proto-hit" onClick={() => onOpenPassage(mark.bookId, mark.cfiRange)}>
        <p className="proto-quote">{mark.text}</p>
        <p className="proto-meta">
          <span className="proto-book">{books.get(mark.bookId)?.title}</span>
          <span className="proto-dot">·</span>
          <span>{ageOf(mark)}</span>
          <span className="proto-more">{batch.length} marked →</span>
        </p>
      </button>
    </section>
  );
}

/**
 * The reading itself, shared by B, B2 and B3 — and the only part of them that is shared.
 *
 * Two voices, so it has to say which is which without a label: the book's words are set against
 * the card, the reader's are indented behind a rule. When there is no note the second half is
 * simply absent — an empty box here would be the writing surface coming back, which is the thing
 * these variants are trying to move off the shelf.
 *
 * **Two ceilings rather than one**, and they are both `LINE_LENGTH`. The quote takes the ceiling
 * for its own script, measured in its own type size; the note takes the same rule at the smaller
 * size it is set in, so it comes out narrower than the passage and sits inside it. One shared
 * pixel width would have set the note 12 words to the line.
 */
function Reading({ mark }: { mark: Annotation }) {
  const ceiling = LINE_LENGTH[detectScript(mark.text)].ceiling;
  return (
    <>
      <p className="proto-quote" style={{ maxWidth: `${ceiling}em` }}>
        {mark.text}
      </p>
      {mark.note !== "" && (
        <p
          className="proto-note"
          style={{ maxWidth: `${LINE_LENGTH[detectScript(mark.note)].ceiling}em` }}
        >
          {mark.note}
        </p>
      )}
    </>
  );
}

/**
 * B — the reading, and two empty margins.
 *
 * The baseline the other two are judged against. Once the ceiling bites, a wide screen leaves
 * room on both sides and this variant spends none of it: the passage sits in the middle of the
 * card with white on either side. Worth having on the switcher because "nothing" is a real
 * answer — a card whose margins are quiet is not obviously worse than one that fills them.
 */
function VariantB({ batch, books, onOpenPassage }: VariantProps) {
  const mark = batch[0]!;
  return (
    <section className="proto-card" data-testid="mark-card">
      <button className="proto-hit" onClick={() => onOpenPassage(mark.bookId, mark.cfiRange)}>
        <div className="proto-measure">
          <span className="proto-side" />
          <div className="proto-column">
            <Reading mark={mark} />
            <p className="proto-meta">
              <span className="proto-book">{books.get(mark.bookId)?.title}</span>
              <span className="proto-dot">·</span>
              <span>{ageOf(mark)}</span>
              <span className="proto-more">{batch.length} marked →</span>
            </p>
          </div>
          <span className="proto-side" />
        </div>
      </button>
    </section>
  );
}

/**
 * B2 — the book in the margin, and a way to draw another passage in the corner.
 *
 * The margin the ceiling leaves holds the cover, which is the fastest way anyone recognises a
 * book, so the attribution stops being a line of credits under the passage.
 *
 * ⚠️ **The corner control is pinned to the card, not placed after the reading.** A passage is
 * two lines or six depending on the passage, so anything that follows it lands somewhere new on
 * every draw — and this is the one control a reader presses repeatedly. Pinned, it is in the same
 * place before and after every press. Padding on both sides of the grid keeps the reading clear
 * of it without pulling the centred column off centre.
 *
 * ⚠️ **Two presses, so the card is not one button.** The control used to be a word inside the
 * same button as the passage, which meant it went where the passage goes — into the book. It
 * draws another of the day's passages instead, and a control that does something else cannot be
 * nested inside one that leaves the screen. The cover and the reading are the press that leaves.
 *
 * ⚠️ **The margin is decoration below the ceiling's reach.** It is hidden outright on a narrow
 * screen rather than stacked, because a cover stacked above a passage is the big card coming back
 * one row at a time. The corner control stays: it is the only thing on here that does something.
 */
function VariantB2({ batch, books, onOpenPassage }: VariantProps) {
  const [at, setAt] = useState(0);
  const index = Math.min(at, batch.length - 1);
  const mark = batch[index]!;

  // Another of today's, drawn rather than stepped to. Nothing on the card says what order the
  // five are in, so "next" would be a promise it cannot keep — and they are a pile to reach into,
  // which is the same argument the shipping card makes for its own draw.
  const another = () => {
    const others = batch.map((_, i) => i).filter((i) => i !== index);
    if (others.length === 0) return;
    setAt(others[Math.floor(Math.random() * others.length)]!);
  };

  return (
    <section className="proto-card" data-testid="mark-card">
      <div className="proto-measure proto-hit-pad">
        <button
          className="proto-hit proto-hit-inline proto-side proto-side-end"
          onClick={() => onOpenPassage(mark.bookId, mark.cfiRange)}
          tabIndex={-1}
          aria-hidden="true"
        >
          <Cover book={books.get(mark.bookId)} size="large" />
        </button>
        <button
          className="proto-hit proto-hit-inline proto-column"
          onClick={() => onOpenPassage(mark.bookId, mark.cfiRange)}
        >
          <Reading mark={mark} />
          <p className="proto-meta">
            <span className="proto-book">{books.get(mark.bookId)?.title}</span>
            <span className="proto-dot">·</span>
            <span>{ageOf(mark)}</span>
          </p>
        </button>
        {/* The margin opposite the cover is left empty on purpose: what stood in it was the four
            other covers, and a passage read beside a stack of other books is a passage read next
            to an inbox. */}
        <span className="proto-side" />
      </div>
      <button
        className="proto-corner"
        onClick={another}
        title="Another of today's passages"
        aria-label="Another of today's passages"
      >
        ↻
      </button>
    </section>
  );
}

/**
 * B3 — both margins spent on the one book this passage came from.
 *
 * B2 puts two subjects either side of the reading, and a passage with a stack of other books
 * beside it is a passage being read next to an inbox. This one keeps the margins on a single
 * subject: the cover on one side, and on the other the same book's name, author and how long ago
 * this was marked, set as a column rather than as a line of credits. Nothing under the passage at
 * all — the attribution *is* the margin.
 */
function VariantB3({ batch, books, onOpenPassage }: VariantProps) {
  const mark = batch[0]!;
  const book = books.get(mark.bookId);
  return (
    <section className="proto-card" data-testid="mark-card">
      <button className="proto-hit" onClick={() => onOpenPassage(mark.bookId, mark.cfiRange)}>
        <div className="proto-measure">
          <span className="proto-side proto-side-end">
            <Cover book={book} size="large" />
          </span>
          <div className="proto-column">
            <Reading mark={mark} />
          </div>
          <span className="proto-side proto-side-start proto-credit">
            <strong>{book?.title}</strong>
            {book?.author && <span>{book.author}</span>}
            <span>{ageOf(mark)}</span>
            <span className="proto-more">{batch.length} marked →</span>
          </span>
        </div>
      </button>
    </section>
  );
}

/**
 * C — a doorway, with no passage on it at all.
 *
 * The other two still quote the book, which is what makes them a card. This one quotes nothing:
 * it says how many are waiting and which books they came from, and the covers do the recognising
 * that a sentence would otherwise have to do. Cheapest of the three in height, and the only one
 * that is honest about being a link rather than a reading.
 */
function VariantC({ batch, books, onOpenPassage }: VariantProps) {
  const covers = [...new Set(batch.map((m) => m.bookId))].slice(0, 4);
  const mark = batch[0]!;
  return (
    <section className="proto-card proto-door" data-testid="mark-card">
      <button className="proto-hit" onClick={() => onOpenPassage(mark.bookId, mark.cfiRange)}>
        <span className="proto-covers">
          {covers.map((id) => (
            <Cover key={id} book={books.get(id)} />
          ))}
        </span>
        <span className="proto-door-text">
          <strong>{batch.length} passages waiting</strong>
          {/* The books by name, because the covers are too small to read as titles and the count
              alone gives the reader nothing to recognise. */}
          <span className="proto-meta">
            {covers
              .map((id) => books.get(id)?.title)
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <span className="proto-more">→</span>
      </button>
    </section>
  );
}

function Cover({ book, size }: { book: BookRecord | undefined; size?: "large" }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!book?.cover) return;
    const made = URL.createObjectURL(book.cover);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [book?.cover]);
  return (
    <span className={size === "large" ? "proto-cover proto-cover-large" : "proto-cover"}>
      {url !== null ? <img src={url} alt="" /> : <span>{book?.title?.slice(0, 1)}</span>}
    </span>
  );
}

interface VariantProps {
  batch: Annotation[];
  books: Map<string, BookRecord>;
  onOpenPassage: (bookId: string, cfiRange: string) => void;
}

export function PrototypeCard({ variant, ...props }: VariantProps & { variant: Variant }) {
  if (props.batch.length === 0) return null;
  return (
    <>
      <style>{CSS}</style>
      {variant === "A" && <VariantA {...props} />}
      {variant === "B" && <VariantB {...props} />}
      {variant === "B2" && <VariantB2 {...props} />}
      {variant === "B3" && <VariantB3 {...props} />}
      {variant === "C" && <VariantC {...props} />}
    </>
  );
}

/**
 * The bar that flips between them. Dev builds only, and loud on purpose — it must never be
 * mistaken for part of the design being judged.
 */
export function PrototypeSwitcher({ variant }: { variant: Variant }) {
  if (!import.meta.env.DEV) return null;

  const go = (d: number) => {
    const next = VARIANTS[(VARIANTS.indexOf(variant) + d + VARIANTS.length) % VARIANTS.length]!;
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.location.href = url.toString();
  };

  return (
    <>
      <style>{SWITCHER_CSS}</style>
      <div className="proto-switcher">
        <button onClick={() => go(-1)} aria-label="Previous variant">
          ←
        </button>
        <span>
          {variant} — {NAMES[variant]}
        </span>
        <button onClick={() => go(1)} aria-label="Next variant">
          →
        </button>
      </div>
    </>
  );
}

/** Arrow keys turn the variant too, unless the reader is typing. */
export function usePrototypeKeys(variant: Variant) {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        (t instanceof HTMLElement && t.isContentEditable)
      ) {
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const d = e.key === "ArrowLeft" ? -1 : 1;
      const next = VARIANTS[(VARIANTS.indexOf(variant) + d + VARIANTS.length) % VARIANTS.length]!;
      const url = new URL(window.location.href);
      url.searchParams.set("variant", next);
      window.location.href = url.toString();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant]);
}

const CSS = `
.proto-card {
  position: relative;
  margin: var(--space-5) var(--space-4) 0;
  border: 1px solid var(--line-firm);
  border-radius: var(--radius-surface);
  background: var(--surface-raised);
  overflow: hidden;
}
.proto-hit {
  display: block;
  width: 100%;
  text-align: start;
  /* controls.css sets \`white-space: nowrap\` on every button; the quote inside this one is a
     paragraph and has to wrap. */
  white-space: normal;
  padding: var(--space-4);
  background: none;
  border: none;
  border-radius: inherit;
  cursor: pointer;
}
.proto-hit:hover { background: var(--surface-page); }
/* B2 has two presses rather than one, so the padding moves off the button and onto the grid, and
   each button shrinks to the thing it is. The extra inline padding is the corner control's room,
   spent on **both** sides so the reading stays centred in the card rather than in what is left of
   it. */
.proto-hit-pad { padding: var(--space-4) calc(var(--space-4) + 28px); }

/* Pinned to the card's corner, because the passage above it changes height on every draw and this
   is the control a reader presses again and again. Quiet until pointed at: it is an offer. */
.proto-corner {
  position: absolute;
  inset-block-start: var(--space-3);
  inset-inline-end: var(--space-3);
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  font-size: var(--type-ui);
  line-height: 1;
  color: var(--text-faint);
  background: none;
  border: 1px solid transparent;
  border-radius: 999px;
  cursor: pointer;
}
.proto-corner:hover {
  color: var(--tide);
  border-color: var(--line-hair);
  background: var(--surface-page);
}
.proto-hit-inline {
  width: auto;
  padding: 0;
  background: none;
  border: none;
  border-radius: 0;
  text-align: start;
  white-space: normal;
  cursor: pointer;
}
.proto-hit-inline:hover { background: none; }
/* The passage says it is pressable the way the shipping card's does — a rule under the words,
   not a panel lighting up behind them. */
.proto-hit-inline:hover .proto-quote { text-decoration: underline; text-decoration-color: var(--line-actionable); }
/* **The reading in the middle, the leftover split either side.** Both margins are \`1fr\`, so they
   are exactly the room the ceiling did not take — when the card is narrower than the ceiling they
   are zero wide and nothing has to be turned off. What stands in them is another question, and
   B, B2 and B3 are the three answers. */
.proto-measure {
  display: grid;
  /* **The margins are capped and the whole group is centred**, rather than each margin taking
     half of whatever is left. Unbounded, a 1280px screen gives each side 320px to hold a 64px
     cover, and the filling reads as two things adrift at either end of an empty card. Capped,
     the reading and both margins travel together and the leftover goes outside them, where it is
     the card's own breathing room rather than a gap in the middle of it.

     An empty margin collapses to nothing on its own (\`minmax(0, …)\`), which is what lets B share
     this grid without turning anything off. */
  grid-template-columns: minmax(0, max-content) auto minmax(0, max-content);
  justify-content: center;
  align-items: start;
  gap: var(--space-5);
}
/* ⚠️ The 100% is load-bearing. A button shrink-wraps to its content even at display: block, so
   B2's reading — which is a button — sized itself to the passage's min-content and ran 48px past
   the padding, straight under the corner control. A CJK passage is where it showed: it has more
   min-content width to overflow with. */
.proto-column { min-width: 0; width: 100%; }
.proto-side {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  /* Wide enough for a cover and a short credit, and no wider: past this a margin stops being a
     margin and becomes a second column of the card. */
  max-width: 180px;
}
/* Each margin leans against the reading rather than against the card's own edge: what is in here
   belongs to the passage beside it, and pinned to the far edge it reads as a second thing. */
.proto-side-end { align-items: flex-end; }
.proto-side-start { align-items: flex-start; }
.proto-credit {
  font-family: var(--font-control);
  font-size: var(--type-eyebrow);
  line-height: 1.5;
  color: var(--text-muted);
  gap: var(--space-1);
}
.proto-credit strong { font-size: var(--type-note); color: var(--text-body); }
/* In a column the link starts on the same line as everything above it. The \`auto\` start margin
   below is for the row under the passage, where it has to reach the far end. */
.proto-credit .proto-more { margin-inline-start: 0; margin-block-start: var(--space-2); }

/* Below the width where the ceiling has anything to give back, the margins hold nothing: a cover
   stacked over a passage is the big card returning one row at a time. */
@media (max-width: 820px) {
  .proto-measure { display: block; }
  .proto-side { display: none; }
  /* Nothing is centred down here, so the corner's room comes out of one side only — spending it
     on both would cost 40px of a 390px passage to keep a symmetry no one can see. */
  .proto-hit-pad { padding-inline: var(--space-4) calc(var(--space-4) + 40px); }
}

.proto-quote {
  font-family: var(--font-ui);
  font-size: var(--type-lede);
  line-height: 1.6;
  color: var(--text-primary);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.proto-note {
  font-size: var(--type-note);
  line-height: var(--leading-text);
  color: var(--text-body);
  margin: var(--space-3) 0 0;
  padding-inline-start: var(--space-3);
  border-inline-start: 2px solid var(--line-firm);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.proto-meta {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: var(--space-3) 0 0;
  font-family: var(--font-control);
  font-size: var(--type-eyebrow);
  color: var(--text-muted);
}
/* Only the book's own name is allowed to run out of room, because it is the one thing here whose
   length is not ours to choose. Everything else keeps its whole word. */
.proto-book {
  font-weight: 600;
  color: var(--text-body);
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proto-meta > span:not(.proto-book) { white-space: nowrap; flex: none; }
.proto-dot { color: var(--text-faint); }
.proto-more { margin-inline-start: auto; color: var(--tide); white-space: nowrap; }

.proto-door .proto-hit {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}
.proto-covers { display: flex; }
.proto-cover {
  width: 34px;
  height: 48px;
  margin-inline-end: -12px;
  border: 1px solid var(--surface-raised);
  box-shadow: 0 0 0 1px var(--line-firm);
  border-radius: 2px;
  background: var(--surface-cover);
  overflow: hidden;
  display: grid;
  place-items: center;
  font-size: var(--type-eyebrow);
  color: var(--text-muted);
}
.proto-cover img { width: 100%; height: 100%; object-fit: cover; }
/* The one in the margin, at the size a cover is recognised at rather than the size a row can
   spare. It is the whole of the attribution in B3. */
.proto-cover-large {
  width: 64px;
  height: 92px;
  margin: 0;
  border-radius: 3px;
}
.proto-door-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.proto-door-text strong { font-size: var(--type-ui); color: var(--text-primary); }
.proto-door .proto-meta { margin: 0; }
`;

const SWITCHER_CSS = `
.proto-switcher {
  position: fixed;
  inset-block-end: 16px;
  inset-inline-start: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-radius: 999px;
  background: #14171c;
  color: #f2f1e9;
  font: 13px/1 var(--font-control), monospace;
  box-shadow: 0 6px 20px rgba(0,0,0,0.35);
}
.proto-switcher button {
  all: unset;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255,255,255,0.12);
}
`;
