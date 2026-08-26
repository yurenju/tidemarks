import { Trans, useLingui } from "@lingui/react/macro";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentlyReading, statusLines } from "../lib/book-status";
import { db } from "../lib/db";
import { importEpubFile } from "../lib/epub";
import { markVar } from "../lib/highlights";
import { detectScript, LINE_LENGTH } from "../lib/line-length";
import { pickBatch, relativeAge, restoreBatch, localDay, type RelativeAge } from "../lib/revisit";
import { loadStoredBatch, noteShown, saveStoredBatch } from "../lib/revisit-store";
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
   * Today's five, held as ids rather than rows.
   *
   * The rows are looked up out of `shelf.marks` on every render, so a note written on a card
   * shows up on it without the batch being drawn again — and being drawn again is exactly what
   * must not happen while the reader is part-way through the five. `null` means not yet drawn
   * this visit, which is different from an empty batch.
   */
  const [batchIds, setBatchIds] = useState<string[] | null>(null);

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
    // Handed back as well as set, because a draw needs the rows *now*: `lastShownAt` was
    // written to Dexie while the reader flicked through the last five, and state here is a
    // render behind. Drawing from what is in state would deal the same five again.
    return next;
  }

  /** The note on one marked passage, written from the shelf rather than from inside the book. */
  async function saveNote(id: string, note: string) {
    const now = Date.now();
    await db.annotations.update(id, { note, updatedAt: now, dirtyAt: now });
    await reload();
    scheduleSync();
  }

  useEffect(() => {
    reload();
    // refresh the shelf whenever a sync round lands new data
    return subscribeSync((s) => {
      if (s.status === "synced") reload();
    });
  }, [reloadToken]);

  /**
   * Today's five: the ones already drawn today if there are any, and a fresh draw if not.
   *
   * Held to for the rest of the day on purpose. The reader may not be able to say yet why a
   * passage stayed with them, and a card that changed under them every time they came back to
   * the shelf would never give them the chance to.
   */
  useEffect(() => {
    if (batchIds !== null || shelf.marks.length === 0) return;
    let cancelled = false;
    void (async () => {
      const kept = restoreBatch(await loadStoredBatch(), shelf.marks, localDay(Date.now()));
      if (cancelled) return;
      if (kept) {
        setBatchIds(kept.map((m) => m.id));
        return;
      }
      const drawn = pickBatch(shelf.marks);
      await saveStoredBatch(drawn, Date.now());
      if (!cancelled) setBatchIds(drawn.map((m) => m.id));
    })();
    return () => {
      cancelled = true;
    };
  }, [shelf.marks, batchIds]);

  /** The reader asking for another five. Not a way to clear the ones showing — see `MarkCard`. */
  async function repick() {
    const fresh = await reload();
    const drawn = pickBatch(fresh.marks);
    await saveStoredBatch(drawn, Date.now());
    setBatchIds(drawn.map((m) => m.id));
  }

  // Stable, because the card records a viewing from an effect keyed on which passage is showing:
  // a new function every render would record one on every render instead.
  const markShown = useCallback((id: string) => {
    void noteShown(id, Date.now()).then(() => scheduleSync());
  }, []);

  const marksById = new Map(shelf.marks.map((m) => [m.id, m]));
  // A mark can go between the draw and the render — deleted, or its book was. Dropping it is
  // not a reason to redraw the other four.
  const batch = (batchIds ?? [])
    .map((id) => marksById.get(id))
    .filter((m): m is Annotation => m !== undefined);

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
          here; it is a tab of 〈設定〉 now, so asking the reader whether an account counts as a
          setting is a question that no longer arises (ADR-0026). */}
      <header className="library-header">
        <h1>
          <Wordmark />
        </h1>
        <div className="library-actions">
          <button className="ghost" onClick={onOpenSettings} data-testid="open-settings">
            <Trans comment="The one door out of the shelf, in the header beside the app's name. Opens 〈設定〉.">
              Settings
            </Trans>
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {/* Adding a book and choosing an order are the shelf's own two verbs, so they sit with
          the shelf rather than in the header the drawers now own. */}
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
        <p className="empty" data-testid="shelf-empty">
          <Trans comment="The whole of an empty shelf. Two short sentences: what is true, then what to do about it. It sits under the 'Import epub' button, so it points at that.">
            No books yet. Drop an epub in, and start here.
          </Trans>
        </p>
      ) : (
        // One column, and one large block in it. The marked passage is that block; a second one
        // under it read as "the notes on the book below" whatever the card said the source was,
        // because two blocks stacked in one column is itself the claim that they go together.
        <div className="shelf">
          {shelf.marks.length > 0 ? (
            // Nothing at all until the draw comes back, rather than a placeholder card: it is
            // one read of Dexie away, and a card that changes what it says a moment after it
            // appears is worse than one that appears a moment later.
            batch.length > 0 && (
              <MarkCard
                batch={batch}
                books={byId}
                onNote={saveNote}
                onShown={markShown}
                onRepick={repick}
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
 * The day's five marked passages, one at a time, with a way through the rest of them.
 *
 * **This is the shelf's main block**, and it is here because a marked passage otherwise only
 * exists inside the book it came from: the notes panel shows one book's marks and only while
 * that book is open, so a sentence the reader thought worth keeping was never in front of them
 * again unless they went back for it.
 *
 * ⚠️ **Five drawn by `revisit.ts`, not the five most recent.** The passages that most need to
 * come back are the ones the reader has forgotten, and those are the oldest — a list that began
 * at the newest put them at the far end, past a dozen presses nobody makes. What is on screen
 * is the front of a queue ordered by how long ago the card last showed each one, which is also
 * why a passage marked this morning arrives here tomorrow: it has never been shown at all.
 *
 * One at a time rather than five across, and that is a layout decision rather than a
 * preference: five columns show at a glance that the passages come from different books, and
 * they cut each passage to a fifth of the width, which a long one does not survive.
 *
 * **The source carries the same weight as a title on this screen.** The cover and the bold
 * title are what keep the passage attached to the book it is from — a small grey line of
 * attribution beside a larger title elsewhere on the screen hands the sentence to the wrong
 * book, and the reader has no way to know.
 *
 * **Two kinds of press, and the words say which is which**: the book's own words go back to the
 * book, and the reader's own note opens for writing. A card with one target would have to give
 * up one of them, and both are the point — the passage is here to be reached again, and the
 * thought it raises is worth catching while it is there.
 */
function MarkCard({
  batch,
  books,
  onNote,
  onShown,
  onRepick,
  onOpenPassage,
}: {
  batch: Annotation[];
  books: Map<string, BookRecord>;
  onNote: (id: string, note: string) => void;
  onShown: (id: string) => void;
  onRepick: () => void;
  onOpenPassage: (bookId: string, cfiRange: string) => void;
}) {
  const { t, i18n } = useLingui();
  const [at, setAt] = useState(0);
  // Which mark is open for writing, rather than a bare flag: the flag would follow the reader
  // onto the next card and open its note as well.
  const [editingId, setEditingId] = useState<string | null>(null);

  // In range by construction — `at` is only ever moved by `step`, and the caller renders an
  // empty line instead of this card when the batch is empty.
  const index = Math.min(at, batch.length - 1);
  const mark = batch[index]!;
  const book = books.get(mark.bookId);
  const coverUrl = useCoverUrl(book?.cover ?? null);

  // **Reaching a card is what counts as having seen it, not being dealt one.** Stamping all
  // five when the batch is drawn buries the four the reader never flicked to: they would sit at
  // the back of the queue for a full round having never been in front of anyone. This way an
  // unreached passage is still owed a turn, and comes back tomorrow.
  useEffect(() => {
    onShown(mark.id);
  }, [mark.id, onShown]);

  // No wrapping. The batch is five and it has two ends, and an arrow that comes back round
  // makes those ends unfindable — the reader cannot tell a full circuit from a stuck card.
  const step = (d: number) => setAt(Math.min(Math.max(index + d, 0), batch.length - 1));

  const notePlaceholder = t({
    message: "What did this make you think?",
    comment:
      "Placeholder in the empty note box under a marked passage on the shelf. An invitation to write, not a label — the box is empty because the reader has not written anything on this passage yet.",
  });

  return (
    <section
      className="mark-card"
      data-testid="mark-card"
      data-mark-id={mark.id}
      style={{ borderLeftColor: markVar(mark.color) }}
      {...useFlick(step)}
    >
      <p className="mark-source">
        <span className="mark-cover">{coverUrl !== null && <img src={coverUrl} alt="" />}</span>
        <strong data-testid="mark-book">{book?.title}</strong>
        <span className="mark-when" data-testid="mark-when">
          {i18n._(AGE_LABELS[relativeAge(Date.now(), mark.createdAt)])}
        </span>
      </p>
      {/* The book's own words, so the reader's own line-length ceiling applies — the same
          number the page they marked it on was set to, read off `line-length.ts` rather than
          written out here. Pressing it goes back to where it came from, which the saved
          position cannot do: that is where they stopped reading, not where this is. */}
      <button
        className="mark-quote"
        data-testid="mark-quote"
        style={{ maxWidth: `${LINE_LENGTH[detectScript(mark.text)].ceiling}em` }}
        onClick={() => onOpenPassage(mark.bookId, mark.cfiRange)}
      >
        {mark.text}
      </button>
      {editingId === mark.id || mark.note === "" ? (
        // Keyed on the mark, so flipping to the next card brings that card's note rather than
        // the text left in the box. Committed on the way out: there is no Save here, because
        // the card is not a form and leaving it is what finishing a thought looks like.
        <textarea
          key={mark.id}
          className="mark-note-input"
          data-testid="mark-note-input"
          defaultValue={mark.note}
          autoFocus={editingId === mark.id}
          placeholder={notePlaceholder}
          aria-label={notePlaceholder}
          onBlur={(e) => {
            if (e.target.value !== mark.note) onNote(mark.id, e.target.value);
            setEditingId(null);
          }}
        />
      ) : (
        <button className="mark-note" data-testid="mark-note" onClick={() => setEditingId(mark.id)}>
          {mark.note}
        </button>
      )}
      <div className="mark-nav">
        <button
          className="ghost"
          disabled={index === 0}
          onClick={() => step(-1)}
          aria-label={t({
            message: "Previous passage",
            comment:
              "Screen-reader name for the ‹ button on the shelf's card, which steps back to the passage before this one in today's five. 'Passage' is a stretch of the book the reader marked.",
          })}
        >
          ‹
        </button>
        <span className="mark-count" data-testid="mark-count">
          {t({
            message: `${{ position: index + 1 }} of ${{ total: batch.length }}`,
            comment:
              "Where the reader is in today's marked passages, between the two arrows on the shelf's card. Both values are counts; the first is the one on screen, the second is how many were drawn for today.",
          })}
        </span>
        <button
          className="ghost"
          disabled={index === batch.length - 1}
          onClick={() => step(1)}
          aria-label={t({
            message: "Next passage",
            comment:
              "Screen-reader name for the › button on the shelf's card, which steps on to the next passage in today's five. 'Passage' is a stretch of the book the reader marked.",
          })}
        >
          ›
        </button>
        {/* **A way to ask for more, and deliberately not a way to clear these away.** Anything
            that can be emptied becomes a thing owed, and a reader who falls behind on it starts
            avoiding the screen it lives on. Pressing this is the reader asking; not pressing it
            costs them nothing and leaves nothing behind. */}
        <button
          className="mark-repick"
          data-testid="mark-repick"
          onClick={() => {
            setAt(0);
            onRepick();
          }}
        >
          <Trans comment="Button at the foot of the shelf's card. Draws another set of marked passages to look through, in place of the ones showing. Not a refresh and not a dismissal — the reader is asking for more, and nothing is being cleared.">
            Show me another five
          </Trans>
        </button>
      </div>
    </section>
  );
}

/**
 * Turning the card with a thumb: a flick past the slop, in either direction along the row.
 *
 * `TAP_SLOP_PX` rather than a number of its own, because the question is the one the book asks
 * too — has this press become a drag — and two answers to it would let a movement be a flick
 * here and a tap there. Vertical travel is left alone entirely: the shelf scrolls, and a card
 * that claimed downward drags would stop it.
 */
function useFlick(step: (d: number) => void) {
  const from = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      from.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: React.PointerEvent) => {
      const start = from.current;
      from.current = null;
      if (!start) return;
      const dx = e.clientX - start.x;
      // A drag that went further down the page than along it was a scroll that happened to
      // begin on the card.
      if (Math.abs(dx) <= FLICK_MIN_PX || Math.abs(dx) <= Math.abs(e.clientY - start.y)) return;
      step(dx < 0 ? 1 : -1);
    },
  };
}

/**
 * How far a thumb travels before the card turns.
 *
 * Larger than `TAP_SLOP_PX`, which is the point where a press stops being a tap: between the
 * two, a movement is neither — not a press on the quote (which would leave the shelf) and not
 * yet a turn. That gap is deliberate, because both of the things it sits between are wrong to
 * do by accident.
 */
const FLICK_MIN_PX = 40;

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
 * **A row rather than a block, and the marked passage above it is why.** Two blocks in one
 * column read as one thing with a heading, whichever of them came first — the passage was read
 * as a note on the book beside it even when the card named a different book. Labels and rules
 * between them did not touch that, because the reading comes from the arrangement. One block
 * on the screen, and the question does not arise.
 *
 * The cover stays, small: it is still the fastest way to recognise a book. What goes is the
 * size — this is one action with the book's name on it, not a shelf of one.
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
