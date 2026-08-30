import { Trans, useLingui } from "@lingui/react/macro";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentlyReading, statusLines } from "../lib/book-status";
import { db } from "../lib/db";
import { importEpubFile } from "../lib/epub";
import { detectScript, LINE_LENGTH } from "../lib/line-length";
import { tidy } from "../lib/passage";
import { pickOne, relativeAge, restoreShown, localDay, type RelativeAge } from "../lib/revisit";
import { loadShownToday, noteShown, saveShownToday } from "../lib/revisit-store";
import { shelfProjection, type Shelf } from "../lib/shelf";
import { loadShelfOrder, saveShelfOrder, sortShelf, type ShelfOrder } from "../lib/shelf-order";
import { SHELF_ORDERS } from "../lib/shelf-order-choices";
import { scheduleSync, subscribeSync } from "../lib/sync";
import type { Annotation, BookRecord } from "../lib/types";
import { Wordmark } from "./Wordmark";

export default function Library({
  onOpen,
  onOpenSettings,
  onOpenAbout,
  reloadToken,
}: {
  /**
   * `cfiRange` when the reader asked for one passage in particular — a card on the shelf. The
   * book opens there instead of at the position it was left at, which is somewhere else
   * entirely once they have read on past it.
   */
  onOpen: (bookId: string, cfiRange?: string) => void;
  onOpenSettings: () => void;
  onOpenAbout: (bookId: string) => void;
  /** Changes when something outside the shelf wrote to the same rows — a restored backup. */
  reloadToken: number;
}) {
  const [shelf, setShelf] = useState<Shelf>({
    books: [],
    progress: new Map(),
    sessions: new Map(),
    marks: [],
  });
  const [order, setOrder] = useState<ShelfOrder>(loadShelfOrder);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  /**
   * Today's passage, held as an id rather than a row.
   *
   * The row is looked up out of `shelf.marks` on every render, so a note written inside the book
   * shows up here without a redraw — and a redraw is exactly what must not happen while the
   * reader is looking at it. `null` means not drawn yet this visit, which is not the same as
   * having nothing to draw.
   */
  const [shownId, setShownId] = useState<string | null>(null);
  /** Whether a draw is already in flight — see `drawAnother`. */
  const drawing = useRef(false);

  // Ordering happens below, in `sortShelf`, so the query no longer asks for one: the default
  // order reads `progress` as well as `books`, which no single Dexie index can answer. What the
  // four tables mean once they are here is `shelf.ts`.
  async function reload(): Promise<Shelf> {
    const [books, progress, sessions, annotations] = await Promise.all([
      db.books.toArray(),
      db.progress.toArray(),
      db.readingSessions.toArray(),
      db.annotations.toArray(),
    ]);
    const next = shelfProjection({ books, progress, sessions, annotations });
    setShelf(next);
    // Handed back as well as set, because a draw needs the rows *now* and state here is a render
    // behind.
    return next;
  }

  useEffect(() => {
    reload();
    // refresh the shelf whenever a sync round lands new data
    return subscribeSync((s) => {
      if (s.status === "synced") reload();
    });
  }, [reloadToken]);

  /**
   * The row today's id names, which is what the card is handed.
   *
   * A mark can go between the draw and the render — deleted, or its book was — and then this is
   * `null` and the effect below draws again. **Read before that effect** rather than beside the
   * card, because the effect's own condition is written in terms of it.
   */
  const shown = shelf.marks.find((m) => m.id === shownId) ?? null;

  /**
   * Today's passage: the one already drawn today if there is one, and a fresh draw if not.
   *
   * Held to for the rest of the day on purpose. The reader may not be able to say yet why a
   * passage stayed with them, and a card that changed under them every time they came back to
   * the shelf would never give them the chance to.
   */
  useEffect(() => {
    // ⚠️ **Keyed on the row, not on the id.** A mark can leave while the shelf is open — deleted
    // on another device, or its book was — and a sync round then takes it out of `shelf.marks`
    // while `shownId` still names it. Waiting on the id alone left the card gone and no draw due,
    // so the shelf held an empty gap until the reader navigated away and back.
    if (shown !== null || shelf.marks.length === 0) return;
    let cancelled = false;
    void (async () => {
      const kept = restoreShown(await loadShownToday(), shelf.marks, localDay(Date.now()));
      if (cancelled) return;
      const drawn = kept ?? pickOne(shelf.marks);
      if (!drawn) return;
      if (!kept) await saveShownToday(drawn.id, Date.now());
      if (!cancelled) setShownId(drawn.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [shelf.marks, shown]);

  /**
   * The reader asking for another passage.
   *
   * ⚠️ **It writes down what it drew**, so a reload comes back to the passage they last asked
   * for rather than to the one the day started on — pressing this and finding it undone by a
   * refresh would read as the press not having happened.
   */
  async function drawAnother() {
    // ⚠️ **One draw at a time.** Two presses in the same frame close over the same `shownId`, so
    // the second would exclude the passage the first one *left* rather than the one it drew — and
    // can hand back exactly what is already on screen, which reads as a button that did nothing.
    // The two writes to `meta` would race as well.
    if (drawing.current) return;
    drawing.current = true;
    try {
      const fresh = await reload();
      const next = pickOne(fresh.marks, shownId ?? undefined);
      if (!next) return;
      await saveShownToday(next.id, Date.now());
      setShownId(next.id);
    } finally {
      drawing.current = false;
    }
  }

  // Stable, because the card records a viewing from an effect keyed on which passage is showing:
  // a new function every render would record one on every render instead.
  const markShown = useCallback((id: string) => {
    void noteShown(id, Date.now()).then(() => scheduleSync());
  }, []);

  const { t, i18n } = useLingui();

  async function addFiles(files: FileList | File[]) {
    setError(null);
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        try {
          const record = await importEpubFile(file);
          await db.books.put(record);
        } catch (e) {
          const reason =
            e instanceof Error
              ? e.message
              : t({
                  message: "not a valid epub file",
                  comment:
                    "Slotted into the import failure message below when the failure carried no reason of its own. Lower case, mid-sentence.",
                });
          setError(
            t({
              message: `Could not import ${{ name: file.name }}: ${{ reason }}`,
              comment:
                "Shown above the shelf when an epub the reader dropped in could not be read. The first value is the file's own name; the second is why, and may be a message from deeper in the importer.",
            }),
          );
        }
      }
      await reload();
      scheduleSync();
    } finally {
      setBusy(false);
    }
  }

  function changeOrder(next: ShelfOrder) {
    setOrder(next);
    saveShelfOrder(next);
  }

  // The wall is every book, the one in progress included. It used to be filtered out to avoid
  // showing a book twice, and the filter was a silent exception to the shelf's default order,
  // which puts that book in the first square anyway. Nothing reads as a duplicate now that the
  // row above is a row: one is an action, the other is a book on a shelf.
  const wall = sortShelf(shelf.books, shelf.progress, order, i18n.locale);
  // The one book the reader is in the middle of. Picked from the whole shelf rather than from
  // the order in front of them: ordering by title changes where a book sits on the wall, not
  // which one they were reading last night.
  const reading = currentlyReading(shelf.books, shelf.progress);
  const now = Date.now();
  const byId = new Map(shelf.books.map((b) => [b.id, b]));

  function lines(book: BookRecord): string[] {
    return statusLines(i18n, shelf.progress.get(book.id), shelf.sessions.get(book.id) ?? [], now);
  }

  /**
   * Adding a book and choosing an order: the shelf's own two verbs.
   *
   * **They stand on the wall of covers, not at the top of the screen**, because the wall is the
   * only thing either of them touches — importing puts a book on it and the order is the order it
   * is in. Above the revisit card they read as the whole screen's controls, and the card is not
   * something you sort.
   *
   * Held in a variable rather than written twice: an empty shelf has no wall to stand them on, so
   * they go with the line that says the shelf is empty — which points at this button.
   */
  const shelfActions = (
    <div className="shelf-actions">
      <button onClick={() => fileInput.current?.click()} disabled={busy}>
        <Trans comment="The shelf's own verb: opens a file picker for epub files. 'epub' stays lower case, as the format spells itself.">
          Import epub
        </Trans>
      </button>
      {shelf.books.length > 0 && (
        <label className="shelf-order" data-testid="shelf-order">
          <Trans comment="Label in front of the shelf's order dropdown. A noun, not the verb 'to sort'.">
            Order
          </Trans>
          <select value={order} onChange={(e) => changeOrder(e.target.value as ShelfOrder)}>
            {SHELF_ORDERS.map((o) => (
              <option key={o.value} value={o.value}>
                {i18n._(o.label)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );

  return (
    <div
      className="library"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }}
    >
      {/* One door and the name, and nothing else. The account used to be a second button up
          here; it is a tab of [[Settings]] now, so asking the reader whether an account counts as a
          setting is a question that no longer arises (ADR-0005). */}
      <header className="library-header">
        <h1>
          <Wordmark />
        </h1>
        <div className="library-actions">
          <button className="ghost" onClick={onOpenSettings} data-testid="open-settings">
            <Trans comment="The one door out of the shelf, in the header beside the app's name. Opens [[Settings]].">
              Settings
            </Trans>
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <input
        ref={fileInput}
        type="file"
        accept=".epub"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {shelf.books.length === 0 ? (
        <>
          {shelfActions}
          <p className="empty" data-testid="shelf-empty">
            <Trans comment="The whole of an empty shelf. Two short sentences: what is true, then what to do about it. It sits under the 'Import epub' button, so it points at that.">
              No books yet. Drop an epub in, and start here.
            </Trans>
          </p>
        </>
      ) : (
        <div className="shelf">
          {shelf.marks.length > 0 ? (
            // Nothing at all until the draw comes back, rather than a placeholder card: it is
            // one read of Dexie away, and a card that changes what it says a moment after it
            // appears is worse than one that appears a moment later.
            shown !== null && (
              <MarkCard
                mark={shown}
                book={byId.get(shown.bookId)}
                onShown={markShown}
                onAnother={drawAnother}
                onOpenPassage={onOpen}
              />
            )
          ) : (
            <p className="empty" data-testid="marks-empty">
              <Trans comment="Stands where a marked passage would be, on a shelf that has books but nothing marked in any of them. It says what the slot is for rather than that it is empty.">
                Nothing marked yet. A passage you mark while reading comes back to you here.
              </Trans>
            </p>
          )}
          {shelfActions}
          {reading !== null && (
            <ReadingNow
              book={reading}
              lines={lines(reading)}
              onOpen={() => onOpen(reading.id)}
              onAbout={() => onOpenAbout(reading.id)}
            />
          )}
          {/* Covers, at the size a cover is for. What used to be here was 43% · 1h 12m · 5
              sittings under every one of them — three numbers answering "how much have I read",
              twenty times over, on the screen whose question is "which one next". */}
          <div className="cover-wall" data-testid="cover-wall">
            {wall.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                lines={lines(book)}
                progress={shelf.progress.get(book.id)?.percentage ?? null}
                onOpen={() => onOpen(book.id)}
                onAbout={() => onOpenAbout(book.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The cover this book carries, as an object URL that is revoked when it goes.
 *
 * A hook rather than a copy in each card: the wall and the large book both need one, and a
 * leaked `blob:` URL holds the whole image in memory for as long as the tab is open.
 */
function useCoverUrl(cover: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!cover) {
      setUrl(null);
      return;
    }
    const made = URL.createObjectURL(cover);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [cover]);
  return url;
}

/**
 * One marked passage, and the way back to where it came from.
 *
 * **The card is a way in, not the place revisiting happens.** A marked passage otherwise only
 * exists inside the book it came from — the notes panel shows one book's marks and only while
 * that book is open — so a sentence the reader thought worth keeping was never in front of them
 * again unless they went back for it. This puts one in front of them; reading the rest of it,
 * and writing about it, happen in the book.
 *
 * ⚠️ **One a day, drawn at random and held until tomorrow** (ADR-0038). It used to be five with
 * a way to leaf through them, and nothing on the card could answer why five, or why not more.
 *
 * **Two presses, and they do different things**, which is why this is not one button: the
 * reading goes back to the passage inside its book, and [[another]] draws a different passage
 * without leaving the shelf.
 */
function MarkCard({
  mark,
  book,
  onShown,
  onAnother,
  onOpenPassage,
}: {
  mark: Annotation;
  /** Absent when the mark has outlived the book's row — the passage still stands on its own. */
  book: BookRecord | undefined;
  onShown: (id: string) => void;
  onAnother: () => void;
  onOpenPassage: (bookId: string, cfiRange: string) => void;
}) {
  const { t, i18n } = useLingui();
  const coverUrl = useCoverUrl(book?.cover ?? null);
  const head = useRef<HTMLParagraphElement>(null);
  useFitRow(head, mark.id);
  // One descriptor spent on both attributes: written twice, the same comment lands twice in every
  // catalog, and a translator then sees the entry duplicated with nothing to tell the two apart.
  const anotherLabel = t({
    message: "Another passage",
    comment:
      "Tooltip and screen-reader name for the ↻ button at the top right of the shelf's card. Draws a different marked passage onto the card. Not a refresh and not a dismissal — the reader is asking, and nothing is being cleared.",
  });

  // The passage as one run of prose. What the book put around its paragraph breaks reads as holes
  // mid-sentence once the breaks themselves are gone — see `lib/passage.ts`.
  const text = tidy(mark.text);
  const note = tidy(mark.note);
  // How wide each is allowed to run, in ems of its own type size — the reader's ceiling for the
  // script it is written in (ADR-0012), the same number the page they marked it on was set to.
  // Two ceilings rather than one: the note is set smaller, so the same rule gives it a narrower
  // line, and it sits inside the passage instead of running past it.
  const quoteCeiling = LINE_LENGTH[detectScript(text)].ceiling;
  const noteCeiling = LINE_LENGTH[detectScript(note)].ceiling;

  // Being drawn is being seen: there is one passage and it is on screen. Nothing reads this back
  // yet — `revisit-store.ts` says why it is written anyway.
  useEffect(() => {
    onShown(mark.id);
  }, [mark.id, onShown]);

  return (
    <section className="mark-card" data-testid="mark-card" data-mark-id={mark.id}>
      {/* Absent rather than empty when the book has no cover of its own: a blank 64px column
          beside the reading is a hole, and the frame closes around whatever is here. */}
      {coverUrl !== null && (
        <span className="mark-cover">
          <img src={coverUrl} alt="" />
        </span>
      )}
      <div className="mark-column">
        {/* **One row of housekeeping, above the reading.** What this block is, which book it came
            from, how long ago, and the way to another — everything that is *about* the passage
            rather than part of it. Above rather than below because the note below is indented
            behind its rule: two lines that both begin "at the left" would begin a few pixels
            apart. It is also what lets [[another]] keep still — nothing above this row changes
            height, so the button does not move when a longer passage arrives. */}
        <p className="mark-head" ref={head}>
          <span className="mark-label" data-optional="1">
            <Trans comment="Eyebrow label at the top of the shelf's card, in front of the book's name. Says what the block is — a passage the reader marked, come back round. Lower case 'marks' is the same word the marking toolbar uses.">
              From your marks
            </Trans>
          </span>
          <span className="mark-label-rule" data-optional="1" aria-hidden="true" />
          <span className="mark-book" data-testid="mark-book">
            {book?.title}
          </span>
          {/* Dropped in this order when the title runs out of room (`useFitRow`). The label goes
              first: it repeats on every card, so it is learnt once and then only taking space. */}
          <span className="mark-dot" data-optional="2" aria-hidden="true">
            ·
          </span>
          <span data-optional="2" data-testid="mark-when">
            {i18n._(AGE_LABELS[relativeAge(Date.now(), mark.createdAt)])}
          </span>
          {/* **A way to ask for another, and deliberately not a way to clear this one away.**
              Anything that can be emptied becomes a thing owed, and a reader who falls behind on
              it starts avoiding the screen it lives on. Pressing this is the reader asking; not
              pressing it costs them nothing and leaves nothing behind. */}
          <button
            className="mark-another"
            data-testid="mark-another"
            onClick={onAnother}
            title={anotherLabel}
            aria-label={anotherLabel}
          >
            ↻
          </button>
        </p>

        {/* The one press that leaves the shelf. It goes to where the passage came from, which the
            saved position cannot do: that is where they stopped reading, not where this is. */}
        <button
          className="mark-reading"
          data-testid="mark-reading"
          onClick={() => onOpenPassage(mark.bookId, mark.cfiRange)}
        >
          <span
            className="mark-quote"
            data-testid="mark-quote"
            style={{ maxWidth: `${quoteCeiling}em` }}
          >
            {text}
          </span>
          {/* The reader's own words, behind a rule rather than behind a label: the indent is what
              says whose they are. Absent entirely when there are none — an empty box here would
              be the writing surface coming back, and writing happens in the book now. */}
          {note !== "" && (
            <span
              className="mark-note"
              data-testid="mark-note"
              style={{ maxWidth: `${noteCeiling}em` }}
            >
              {note}
            </span>
          )}
        </button>
      </div>
    </section>
  );
}

/**
 * Drop the head row's optional parts, in order, until the book's title stops being cut off.
 *
 * ⚠️ **The trigger is the title truncating, not a screen width.** A breakpoint answers "how wide
 * is the window", and the question here is "is this row full", which is a different one: the same
 * card at the same width has room to spare for a three-character title and none at all for a
 * fifteen-character one. Keyed to a width, a card with a short title loses its label for nothing.
 *
 * The order is `data-optional`, low first, and the two survivors are the title and [[another]]:
 * the title is what tells a reader whose words these are, and [[another]] is the only thing on the
 * row anyone presses.
 *
 * Dropped rather than wrapped, because a row that wraps is two rows — and three lines of grey
 * label over a two-line passage is the height this card exists to give up.
 *
 * ⚠️ **Written to the DOM rather than held in state.** Hiding a part changes the row's size,
 * which is one of the things the observer watches, so a render-and-remeasure loop would go round
 * for ever. What actually settles it is that `fit` starts by unhiding everything and recomputes
 * from there, so running it again on its own output changes nothing; `busy` only keeps it from
 * doing that work twice.
 *
 * ⚠️ **The page is watched as well as the row, and the row alone is not enough.** The card is
 * `width: fit-content`, so once the label has gone the card is as wide as what is left — and
 * widening the window past that does not change the row's size at all. Watching only the row, a
 * label dropped at 600px stayed dropped at 1400px until the next draw.
 */
function useFitRow(row: React.RefObject<HTMLElement | null>, redo: unknown) {
  useEffect(() => {
    const node = row.current;
    const title = node?.querySelector<HTMLElement>(".mark-book");
    if (!node || !title) return;
    // ⚠️ **Grouped by rank, not one element at a time.** The label is a word *and* the hairline
    // that separates it from the title, and dropping them one by one leaves the hairline standing
    // with nothing to its left — a rule against the edge of the card, which reads as a mistake.
    const ranks = new Map<string, HTMLElement[]>();
    for (const el of node.querySelectorAll<HTMLElement>("[data-optional]")) {
      const rank = el.dataset.optional!;
      ranks.set(rank, [...(ranks.get(rank) ?? []), el]);
    }
    const groups = [...ranks.entries()].sort(([a], [b]) => Number(a) - Number(b)).map(([, g]) => g);

    let busy = false;
    const fit = () => {
      if (busy) return;
      busy = true;
      for (const group of groups) for (const el of group) el.hidden = false;
      for (const group of groups) {
        // `scrollWidth > clientWidth` is the title asking for room it did not get — the ellipsis
        // itself, read off the element rather than guessed at from how long a title runs.
        if (title.scrollWidth <= title.clientWidth) break;
        for (const el of group) el.hidden = true;
      }
      requestAnimationFrame(() => {
        busy = false;
      });
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, [row, redo]);
}

/**
 * The words for each rung of `relativeAge`.
 *
 * Descriptors declared out here rather than `t({...})` calls inside the component, and that is
 * forced rather than chosen: lingui's macro only rewrites its own `t`, so a helper handed one
 * as an argument extracts nothing and the strings never reach a catalog. `Record<RelativeAge,
 * ...>` keeps the exhaustiveness a `switch` would have given — a new rung fails to compile.
 */
const AGE_LABELS: Record<RelativeAge, MessageDescriptor> = {
  justNow: msg({
    message: "Just now",
    comment:
      "How long ago the reader marked the passage showing on the shelf's card: within the hour. The card carries a distance rather than a date, because reaching back for what they were thinking then is what it is for.",
  }),
  today: msg({
    message: "Today",
    comment:
      "How long ago the reader marked the passage showing on the shelf's card: earlier today.",
  }),
  yesterday: msg({
    message: "Yesterday",
    comment:
      "How long ago the reader marked the passage showing on the shelf's card: the day before.",
  }),
  thisWeek: msg({
    message: "This week",
    comment:
      "How long ago the reader marked the passage showing on the shelf's card: two to seven days back.",
  }),
  lastWeek: msg({
    message: "Last week",
    comment:
      "How long ago the reader marked the passage showing on the shelf's card: one to two weeks back.",
  }),
  thisMonth: msg({
    message: "This month",
    comment:
      "How long ago the reader marked the passage showing on the shelf's card: two to four weeks back.",
  }),
  lastMonth: msg({
    message: "Last month",
    comment:
      "How long ago the reader marked the passage showing on the shelf's card: one to two months back.",
  }),
  thisYear: msg({
    message: "This year",
    comment:
      "How long ago the reader marked the passage showing on the shelf's card: two months to a year back.",
  }),
  lastYear: msg({
    message: "Last year",
    comment:
      "How long ago the reader marked the passage showing on the shelf's card: one to two years back.",
  }),
  longAgo: msg({
    message: "Years ago",
    comment:
      "How long ago the reader marked the passage showing on the shelf's card: more than two years, the far end of the scale. Vague on purpose \u2014 past a certain distance the exact count stops meaning anything.",
  }),
};

/**
 * The book the reader is in the middle of, as one row.
 *
 * **A row rather than a block**, and it now stands on its own reason rather than the card's. It
 * became a row because the card above it was a large block and two blocks stacked in one column
 * read as one thing with a heading — the passage was taken for a note on the book beside it even
 * when the card named a different book. The card is a row itself now, so that argument has
 * expired; what keeps this one a row is what it is: **one action with a book's name on it**, not
 * a shelf of one. Whether it should go back to being a block is a question for its own change,
 * not a side effect of the card shrinking.
 *
 * The cover stays, small: it is still the fastest way to recognise a book.
 */
function ReadingNow({
  book,
  lines,
  onOpen,
  onAbout,
}: {
  book: BookRecord;
  lines: string[];
  onOpen: () => void;
  onAbout: () => void;
}) {
  const { t } = useLingui();
  const coverUrl = useCoverUrl(book.cover);

  return (
    <section className="reading-now" data-testid="reading-now" data-book-id={book.id}>
      <button
        className="book-cover"
        onClick={onOpen}
        title={t({
          message: `Open ${{ title: book.title }}`,
          comment:
            "Tooltip on a book's cover. The value is the book's own title and is never translated.",
        })}
      >
        {coverUrl ? <img src={coverUrl} alt={book.title} /> : <span>{book.title}</span>}
      </button>
      <div className="reading-now-info">
        <h2 data-testid="reading-now-title">{book.title}</h2>
        {/* **The first line only**, which is where they are. The second is a sense of how long
            is left, and on a row it arrives as a fragment of a sentence with the end cut off —
            it belongs under the cover on the wall, where it has a line of its own. */}
        <StatusLines lines={lines.slice(0, 1)} testId="reading-now-status" />
      </div>
      <button className="primary" onClick={onOpen} data-testid="continue-reading">
        <Trans comment="The main button on the one book the reader is in the middle of. It reopens that book at the position they left.">
          Keep reading
        </Trans>
      </button>
      <button
        className="ghost"
        onClick={onAbout}
        aria-label={t({
          message: `About ${{ title: book.title }}`,
          comment:
            "Screen-reader name for the ⋯ button beside a book, which opens the drawer holding everything else that book can do. The value is the book's own title.",
        })}
      >
        ⋯
      </button>
    </section>
  );
}

function BookCard({
  book,
  lines,
  progress,
  onOpen,
  onAbout,
}: {
  book: BookRecord;
  lines: string[];
  /** How far through, 0–1, or `null` for a book never opened — which draws no line at all. */
  progress: number | null;
  onOpen: () => void;
  onAbout: () => void;
}) {
  const { t } = useLingui();
  const coverUrl = useCoverUrl(book.cover);

  return (
    <div className="book-card" data-testid="book-card" data-book-id={book.id}>
      <button
        className="book-cover"
        onClick={onOpen}
        title={t({
          message: `Open ${{ title: book.title }}`,
          comment:
            "Tooltip on a book's cover. The value is the book's own title and is never translated.",
        })}
        data-testid="book-open"
      >
        {coverUrl ? <img src={coverUrl} alt={book.title} /> : <span>{book.title}</span>}
      </button>
      {/* The tide line: how far in they are, right under the cover it belongs to. A number in
          words is still under the title — this is the same fact at a glance, for a wall being
          scanned rather than read. Nothing is drawn for a book never opened, because an empty
          rail under every new book reads as a row of things owed. */}
      {progress !== null && (
        <div className="book-tide" data-testid="book-tide">
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      <div className="book-info">
        <strong data-testid="book-title">{book.title}</strong>
        <StatusLines lines={lines} testId="book-status" />
      </div>
      {/* The one door to everything else this book can do. It is a door rather than a row of
          buttons because exporting notes and deleting are not things anyone does while choosing
          what to read, and a wall of covers with two buttons under each is not a wall of
          covers. */}
      <button
        className="ghost book-more"
        onClick={onAbout}
        aria-label={t({
          message: `About ${{ title: book.title }}`,
          comment:
            "Screen-reader name for the ⋯ button beside a book, which opens the drawer holding everything else that book can do. The value is the book's own title.",
        })}
        data-testid="book-more"
      >
        ⋯
      </button>
    </div>
  );
}

/** One line per thing there is to say, and no empty line held open for one there is not. */
function StatusLines({ lines, testId }: { lines: string[]; testId: string }) {
  return (
    <p className="book-status" data-testid={testId}>
      {lines.map((line, i) => (
        <span key={i}>{line}</span>
      ))}
    </p>
  );
}
