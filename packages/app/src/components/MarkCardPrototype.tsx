/**
 * ⚠️ PROTOTYPE — throwaway. Not production code, not translated, not tested.
 *
 * Question it answers: what does the revisit card look like once it stops being the place where
 * revisiting *happens* and becomes only the way in? A notes screen is coming; when it does, the
 * card's whole job is to raise one passage and hand the reader somewhere to go. Until that screen
 * exists, every "go" here lands on the passage inside its book — the same place `mark-quote`
 * already goes.
 *
 * Three variants of the shelf's card, on the shelf itself, switched by `?variant=` in the address
 * bar (a query, deliberately, so it does not touch the app's own hash routing).
 *
 *   A — quote only. One passage, one press. No note, no writing, no controls.
 *   B — quote plus the reader's own note, stacked. Still no writing here.
 *   C — no passage at all: a count and the covers it came from, as a doorway.
 *
 * Everything is inert except the two presses that leave the shelf. No note writing, no
 * `Another five`, no `lastShownAt` bookkeeping — those belong to whatever wins, written properly.
 */

import { useEffect, useState } from "react";
import { relativeAge, type RelativeAge } from "../lib/revisit";
import type { Annotation, BookRecord } from "../lib/types";

export const VARIANTS = ["A", "B", "C", "current"] as const;
export type Variant = (typeof VARIANTS)[number];

const NAMES: Record<Variant, string> = {
  A: "Quote only",
  B: "Quote + note",
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
 * B — the passage with the reader's own note under it.
 *
 * Two voices, so the card has to say which is which without a label: the book's words are set in
 * the reading face against the card, the reader's are indented behind a rule. When there is no
 * note the second half is simply absent — an empty box here would be the writing surface coming
 * back, which is the thing this variant is trying to move off the shelf.
 */
function VariantB({ batch, books, onOpenPassage }: VariantProps) {
  const mark = batch[0]!;
  return (
    <section className="proto-card" data-testid="mark-card">
      <button className="proto-hit" onClick={() => onOpenPassage(mark.bookId, mark.cfiRange)}>
        <p className="proto-quote">{mark.text}</p>
        {mark.note !== "" && <p className="proto-note">{mark.note}</p>}
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

function Cover({ book }: { book: BookRecord | undefined }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!book?.cover) return;
    const made = URL.createObjectURL(book.cover);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [book?.cover]);
  return (
    <span className="proto-cover">
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
