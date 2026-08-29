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
 *   B2-1 — B2 with the frame pulled in to the reading instead of running the shelf's width.
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

import { useEffect, useRef, useState } from "react";
import { detectScript, LINE_LENGTH } from "../lib/line-length";
import { relativeAge, type RelativeAge } from "../lib/revisit";
import type { Annotation, BookRecord } from "../lib/types";

export const VARIANTS = ["A", "B", "B2", "B2-1", "B3", "C", "current"] as const;
export type Variant = (typeof VARIANTS)[number];

const NAMES: Record<Variant, string> = {
  A: "Quote only",
  B: "Quote + note, margins empty",
  B2: "…book left, draw in the corner",
  "B2-1": "…the same, frame hugging the reading",
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

/** Han, kana, hangul, and the full-width punctuation that sets with them. */
const WIDE = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-｠]/u;

/**
 * Drop the row's optional parts, in order, until the book's title stops being cut off.
 *
 * ⚠️ **The trigger is the title truncating, not a screen width.** A breakpoint answers "how wide
 * is the window", and the question here is "is this row full", which is a different one: the same
 * card at the same width has room to spare for 《微光集》 and none at all for
 * 《原子習慣：細微改變帶來巨大成就的實證法則》. Keyed to a width, a card with a short title loses
 * its label for nothing.
 *
 * The order is `data-optional`, low first, and the two survivors are the title and the draw: the
 * title is what tells a reader whose words these are, and the draw is the only thing on the row
 * anyone presses.
 *
 * Dropped rather than wrapped, because a row that wraps is two rows — and three lines of grey
 * label over a two-line passage is the card growing back the height these variants gave up.
 *
 * Done to the DOM rather than through state on purpose: hiding a part changes the row's size,
 * which is what the observer watches, so a render-and-remeasure loop would oscillate between two
 * stable answers forever. `busy` closes that loop — our own writes land in the same frame and are
 * ignored.
 */
function useFitRow(row: React.RefObject<HTMLElement | null>, redo: unknown) {
  useEffect(() => {
    const node = row.current;
    const title = node?.querySelector<HTMLElement>(".proto-book");
    if (!node || !title) return;
    const optional = [...node.querySelectorAll<HTMLElement>("[data-optional]")].sort(
      (a, b) => Number(a.dataset.optional) - Number(b.dataset.optional),
    );

    let busy = false;
    const fit = () => {
      if (busy) return;
      busy = true;
      for (const el of optional) el.hidden = false;
      for (const el of optional) {
        // `scrollWidth > clientWidth` is the title asking for room it did not get — the ellipsis,
        // read off the element rather than off a guess about how long a title runs.
        if (title.scrollWidth <= title.clientWidth) break;
        el.hidden = true;
      }
      requestAnimationFrame(() => {
        busy = false;
      });
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    return () => observer.disconnect();
  }, [row, redo]);
}

/**
 * The passage as one run of prose, with the book's layout taken out of it.
 *
 * A mark can span paragraphs, and the card sets it as a single paragraph — so the line breaks are
 * already gone, and what they leave behind is what the book put around them: an indent at the head
 * of each paragraph, trailing space at the end of each line. Run together they read as holes in
 * the middle of a sentence.
 *
 * ⚠️ **Not every space is layout, which is why this is not `replace(/\s+/g, "")`.** Between two
 * Latin words a space is part of the language and taking it out destroys the text. Between two
 * ideographs there is no such space in the writing at all, so one standing there came from the
 * page rather than from the sentence. The rule is exactly that: **a run of whitespace closes up
 * when both of its neighbours are wide characters, and otherwise collapses to a single space.**
 *
 * Mixed neighbours keep the space on purpose — a Latin word quoted inside a Chinese sentence is
 * set with spaces around it, and that is the one case where the two rules disagree.
 */
function tidy(text: string): string {
  const trimmed = text.trim();
  return trimmed.replace(/\s+/gu, (run, offset: number) => {
    const before = trimmed[offset - 1] ?? "";
    const after = trimmed[offset + run.length] ?? "";
    return WIDE.test(before) && WIDE.test(after) ? "" : " ";
  });
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
  const text = tidy(mark.text);
  const ceiling = LINE_LENGTH[detectScript(text)].ceiling;
  return (
    <>
      <p className="proto-quote" style={{ maxWidth: `${ceiling}em` }}>
        {text}
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
function VariantB2({ batch, books, onOpenPassage, hug }: VariantProps & { hug?: boolean }) {
  const [at, setAt] = useState(0);
  const index = Math.min(at, batch.length - 1);
  const mark = batch[index]!;
  const head = useRef<HTMLParagraphElement>(null);
  // Re-fit on every draw: the next passage carries a different book, and a different title length.
  useFitRow(head, mark.id);

  // Another of today's, drawn rather than stepped to. Nothing on the card says what order the
  // five are in, so "next" would be a promise it cannot keep — and they are a pile to reach into,
  // which is the same argument the shipping card makes for its own draw.
  const another = () => {
    const others = batch.map((_, i) => i).filter((i) => i !== index);
    if (others.length === 0) return;
    setAt(others[Math.floor(Math.random() * others.length)]!);
  };

  return (
    <section className={hug ? "proto-card proto-card-hug" : "proto-card"} data-testid="mark-card">
      <div className="proto-measure proto-hit-pad">
        <button
          className="proto-hit proto-hit-inline proto-side proto-side-end"
          onClick={() => onOpenPassage(mark.bookId, mark.cfiRange)}
          tabIndex={-1}
          aria-hidden="true"
        >
          <Cover book={books.get(mark.bookId)} size="large" />
        </button>
        <div className="proto-column">
          {/* **One row of housekeeping, above the reading.** What this block is, which book it
              came from, and the way to another — the three things that are *about* the passage
              rather than part of it. It stands above rather than below because the note's indent
              is below: two lines that both start "at the left" would start a few pixels apart.

              It is also what lets the draw sit in the corner without a column reserved for it. Its
              place is fixed for the same reason as before — nothing above this row changes height
              — but now it costs a row it shares rather than a margin of its own. */}
          <p className="proto-head" ref={head}>
            <SourceLabel />
            <span className="proto-book">{books.get(mark.bookId)?.title}</span>
            {/* Dropped in this order when the title runs out of room (`useFitRow`). The label goes
                first: it repeats on every card, so it is learnt once and then only taking space.
                The age goes second — it is the one thing here nothing else says. */}
            <span className="proto-dot" data-optional="2">
              ·
            </span>
            <span data-optional="2">{ageOf(mark)}</span>
            <button
              className="proto-corner"
              onClick={another}
              title="Another of today's passages"
              aria-label="Another of today's passages"
            >
              ↻
            </button>
          </p>
          <button
            className="proto-hit proto-hit-inline proto-reading"
            onClick={() => onOpenPassage(mark.bookId, mark.cfiRange)}
          >
            <Reading mark={mark} />
          </button>
        </div>
        {/* The margin opposite the cover is left empty on purpose: what stood in it was the four
            other covers, and a passage read beside a stack of other books is a passage read next
            to an inbox. B2-1 has no such margin to leave empty — the frame stops at the reading —
            so it is not rendered there at all. */}
        {!hug && <span className="proto-side" />}
      </div>
    </section>
  );
}

/**
 * What this block is, said in front of the book's name — and the hard part is that the two are one
 * row of small grey text apart.
 *
 * Three signals at once, because any one of them alone is a difference a reader has to be told
 * about: **case and tracking** (the label is set as an eyebrow, which is a shape no title has),
 * **weight and colour** (the book's name is the darker, heavier thing in the row — it is the
 * subject), and **a separator** between them. Two of the three survive on their own, so a reader
 * who cannot see colour, or is reading a book whose title happens to be short and capitalised,
 * still has the others.
 *
 * The chip alternative is on a dial rather than argued for here: a filled pill says "label" at a
 * glance and cannot be mistaken for prose, and it also says "button", which this is not. Worth
 * seeing next to the eyebrow before deciding.
 */
function SourceLabel() {
  return (
    <>
      <span className="proto-label" data-optional="1">
        From your notes
      </span>
      <span className="proto-label-rule" data-optional="1" aria-hidden="true" />
    </>
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
      {variant === "B2-1" && <VariantB2 {...props} hug />}
      {variant === "B3" && <VariantB3 {...props} />}
      {variant === "C" && <VariantC {...props} />}
    </>
  );
}

/**
 * The three dials worth turning while looking at these — how many lines of the passage, how many
 * of the note, and where the cover sits against them.
 *
 * ⚠️ **They are written to the document root as custom properties, not passed down as props.**
 * The card and this bar are siblings under the shelf, so sharing React state between them would
 * mean lifting it into `Library` — a change to the app's own component for the sake of a
 * prototype's controls. The stylesheet already reads them (`var(--proto-…)`), so a dial turned
 * here reaches every variant at once, including the ones a later session adds.
 */
interface Dials {
  quoteLines: number;
  noteLines: number;
  coverCentred: boolean;
  /**
   * How the label in front of the book's name is told apart from it.
   *
   * `eyebrow` gives it a shape no book title has — small, upper case, widely tracked, faint — and
   * a hairline between the two. `chip` puts it in a filled pill, which cannot be read as prose at
   * all but does look like something to press.
   */
  labelStyle: "eyebrow" | "chip";
}

// What the reading of these settled on: two lines of the passage, one of the note, the cover level
// with the middle rather than the head.
const DIAL_DEFAULTS: Dials = {
  quoteLines: 2,
  noteLines: 1,
  coverCentred: true,
  labelStyle: "eyebrow",
};
const DIALS_KEY = "proto-dials";

function loadDials(): Dials {
  try {
    const stored = window.localStorage.getItem(DIALS_KEY);
    return stored ? { ...DIAL_DEFAULTS, ...JSON.parse(stored) } : DIAL_DEFAULTS;
  } catch {
    // A prototype's controls are not worth a broken shelf. Private windows throw on read.
    return DIAL_DEFAULTS;
  }
}

function applyDials(dials: Dials) {
  const root = document.documentElement;
  root.style.setProperty("--proto-quote-lines", String(dials.quoteLines));
  root.style.setProperty("--proto-note-lines", String(dials.noteLines));
  root.style.setProperty("--proto-cover-justify", dials.coverCentred ? "center" : "flex-start");
  // Zero lines has to be its own switch: -webkit-line-clamp: 0 is not "no lines", it is ignored,
  // and the note would come back at full height.
  root.style.setProperty("--proto-note-display", dials.noteLines === 0 ? "none" : "-webkit-box");
  // An attribute rather than a custom property: the setting names an arrangement, and the rules
  // that draw it change several things at once.
  root.dataset.protoLabel = dials.labelStyle;
  try {
    window.localStorage.setItem(DIALS_KEY, JSON.stringify(dials));
  } catch {
    // Not worth a broken shelf either — the dials just do not survive a reload.
  }
}

/**
 * The bar that flips between them. Dev builds only, and loud on purpose — it must never be
 * mistaken for part of the design being judged.
 */
export function PrototypeSwitcher({ variant }: { variant: Variant }) {
  const [dials, setDials] = useState(loadDials);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) applyDials(dials);
  }, [dials]);

  if (!import.meta.env.DEV) return null;

  const go = (d: number) => {
    const next = VARIANTS[(VARIANTS.indexOf(variant) + d + VARIANTS.length) % VARIANTS.length]!;
    const url = new URL(window.location.href);
    url.searchParams.set("variant", next);
    window.location.href = url.toString();
  };

  const turn = (change: Partial<Dials>) => setDials((d) => ({ ...d, ...change }));

  return (
    <>
      <style>{SWITCHER_CSS}</style>
      {open && (
        <div className="proto-dials">
          <label>
            Quote lines
            <input
              type="range"
              min={1}
              max={8}
              value={dials.quoteLines}
              onChange={(e) => turn({ quoteLines: Number(e.target.value) })}
            />
            <b>{dials.quoteLines}</b>
          </label>
          <label>
            Note lines
            <input
              type="range"
              min={0}
              max={6}
              value={dials.noteLines}
              onChange={(e) => turn({ noteLines: Number(e.target.value) })}
            />
            {/* Zero is a real setting, not an off switch by accident: it is what the card looks
                like with the reader's own words dropped altogether. */}
            <b>{dials.noteLines === 0 ? "off" : dials.noteLines}</b>
          </label>
          <label className="proto-dial-check">
            <input
              type="checkbox"
              checked={dials.coverCentred}
              onChange={(e) => turn({ coverCentred: e.target.checked })}
            />
            Cover centred against the reading
          </label>
          <label>
            Label
            <select
              value={dials.labelStyle}
              onChange={(e) => turn({ labelStyle: e.target.value as Dials["labelStyle"] })}
            >
              <option value="eyebrow">Eyebrow, with a hairline</option>
              <option value="chip">Filled chip</option>
            </select>
          </label>
          <button className="proto-dial-reset" onClick={() => setDials(DIAL_DEFAULTS)}>
            Reset
          </button>
        </div>
      )}
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
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Prototype dials"
          aria-expanded={open}
        >
          ⚙
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
.proto-hit-pad { padding: var(--space-4); }

/* **B2-1: the frame stops where the reading does.** B2's card runs the full width of the shelf,
   so the border and the ground stay put while the passage inside them shrinks and grows — on a
   short passage that is a lot of painted card around a little text. Here the frame is sized by
   what is in it (the quote's own ceiling caps how wide that can get), and centred.

   The reading goes back to shrink-to-fit for this one: the 100% that stops a button overflowing a
   fixed-width parent would, inside a parent sized by its children, be a width asking a width. */
.proto-card-hug {
  width: fit-content;
  max-width: 100%;
  margin-inline: auto;
}
.proto-card-hug .proto-column { width: auto; }
/* ⚠️ **Two columns here, not three.** B2-1 renders no margin on the far side, but the three-track
   template still counted one — an empty track plus its gap, which the frame then had to enclose.
   The reading sat 39px from the right edge against the cover's 17px on the left, and the card
   looked as though it had been pushed. */
.proto-card-hug .proto-measure {
  grid-template-columns: minmax(0, max-content) auto;
  justify-content: start;
}

/* **The housekeeping row**: what this is, which book, how long ago, and the way to another. Set
   in the label face at the smallest size the system has — everything on it is the interface
   talking, and the passage below is the only thing here that is a reading. */
.proto-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  font-family: var(--font-control);
  font-size: var(--type-eyebrow);
  color: var(--text-muted);
}
/* **The one thing on the row allowed to run out of room**, and the only one that shrinks: its
   length is the book's, not ours. Everything else keeps its whole word or leaves entirely (below).
   Without this a long title pushed the age onto a second line and the row stopped being a row. */
.proto-head .proto-book {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  color: var(--text-body);
}
.proto-head .proto-dot { color: var(--text-faint); }
.proto-head > span:not(.proto-book) { white-space: nowrap; flex: none; }

/* ⚠️ **What goes when the row runs short is decided by measuring, not by a breakpoint** — see
   useFitRow in this file. A width says nothing about whether this row is full: a card at 900px
   with a one-word title has room to spare, and the same card with a long one does not. */

/* **The label, told apart from the title three ways at once** — case and tracking, weight and
   colour, and a rule between them. Any one alone is a difference that has to be explained; three
   means a reader who misses one still has the others. */
.proto-label {
  text-transform: uppercase;
  letter-spacing: var(--type-eyebrow-tracking);
  color: var(--text-faint);
  white-space: nowrap;
}
.proto-label-rule {
  width: 1px;
  align-self: stretch;
  margin-inline: var(--space-1);
  background: var(--line-hair);
}
/* The alternative on the dial: unmistakably a label, at the cost of looking pressable. */
:root[data-proto-label="chip"] .proto-label {
  padding: 2px 8px;
  letter-spacing: 0.06em;
  text-transform: none;
  color: var(--text-on-tide);
  background: var(--tide);
  border-radius: 999px;
}
:root[data-proto-label="chip"] .proto-label-rule { display: none; }

.proto-column {
  display: flex;
  flex-direction: column;
}
/* The reading is the one press on this card, so it takes the whole width under the row. */
.proto-reading { display: block; width: 100%; }

/* **In the row rather than over the card.** It used to be pinned to the corner because a passage
   changes height on every draw and anything after it moves; the row it now shares is above the
   passage, so it is just as fixed and costs no column of its own. Wide rather than round: it is
   the one thing on this row anybody aims at, and a 32px circle is a small target for a thumb. */
.proto-corner {
  margin-inline-start: auto;
  min-width: 56px;
  min-height: 30px;
  display: grid;
  place-items: center;
  padding: 0 var(--space-3);
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
.proto-side-end {
  align-items: flex-end;
  /* The grid holds its items at the top; this one stretches so the dial has a full column height
     to place the cover in — head of the passage, or level with its middle. */
  align-self: stretch;
  justify-content: var(--proto-cover-justify, flex-start);
}
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
}

.proto-quote {
  font-family: var(--font-ui);
  font-size: var(--type-lede);
  line-height: 1.6;
  color: var(--text-primary);
  margin: 0;
  display: -webkit-box;
  /* The dial in the switcher writes this; 3 is what it starts on. */
  -webkit-line-clamp: var(--proto-quote-lines, 3);
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.proto-note {
  display: var(--proto-note-display, -webkit-box);
  font-size: var(--type-note);
  line-height: var(--leading-text);
  color: var(--text-body);
  margin: var(--space-3) 0 0;
  padding-inline-start: var(--space-3);
  border-inline-start: 2px solid var(--line-firm);
  -webkit-line-clamp: var(--proto-note-lines, 2);
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

/* Sits above the bar, in the same black so it reads as part of the rig rather than the design. */
.proto-dials {
  position: fixed;
  inset-block-end: 64px;
  inset-inline-start: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 280px;
  padding: 14px 16px;
  border-radius: 12px;
  background: #14171c;
  color: #f2f1e9;
  font: 13px/1.3 var(--font-control), monospace;
  box-shadow: 0 6px 20px rgba(0,0,0,0.35);
}
.proto-dials label {
  display: grid;
  grid-template-columns: 92px 1fr 32px;
  align-items: center;
  gap: 10px;
}
.proto-dials b { text-align: end; font-weight: 600; }
.proto-dials input[type="range"] { width: 100%; accent-color: #7aa2d6; }
.proto-dials select {
  grid-column: 2 / -1;
  padding: 3px 6px;
  color: inherit;
  background: rgba(255,255,255,0.12);
  border: none;
  border-radius: 6px;
  font: inherit;
}
.proto-dials select option { color: #14171c; }
.proto-dial-check { grid-template-columns: auto 1fr; }
.proto-dial-reset {
  align-self: flex-end;
  cursor: pointer;
  padding: 4px 10px;
  color: inherit;
  background: rgba(255,255,255,0.12);
  border: none;
  border-radius: 999px;
  font: inherit;
}
`;
