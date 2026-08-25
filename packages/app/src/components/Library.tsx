import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { currentlyReading, statusLines } from "../lib/book-status";
import { db } from "../lib/db";
import { importEpubFile } from "../lib/epub";
import { markVar } from "../lib/highlights";
import { detectScript, LINE_LENGTH } from "../lib/line-length";
import { loadShelfOrder, saveShelfOrder, sortShelf, type ShelfOrder } from "../lib/shelf-order";
import { SHELF_ORDERS } from "../lib/shelf-order-choices";
import { scheduleSync, subscribeSync } from "../lib/sync";
import type { Annotation, BookRecord, Progress, ReadingSession } from "../lib/types";
import { Wordmark } from "./Wordmark";

interface Shelf {
  books: BookRecord[];
  progress: Map<string, Progress>;
  sessions: Map<string, ReadingSession[]>;
  /** Every passage the reader has marked, newest first. See `MarkCard`. */
  marks: Annotation[];
}

export default function Library({
  onOpen,
  onOpenSettings,
  onOpenAbout,
  reloadToken,
}: {
  onOpen: (bookId: string) => void;
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

  // Ordering happens below, in `sortShelf`, so the query no longer asks for one: the default
  // order reads `progress` as well as `books`, which no single Dexie index can answer.
  async function reload() {
    const [allBooks, progress, sessions, annotations] = await Promise.all([
      db.books.toArray(),
      db.progress.toArray(),
      db.readingSessions.toArray(),
      db.annotations.toArray(),
    ]);
    const books = allBooks.filter((b) => !b.deletedAt);
    const sessionMap = new Map<string, ReadingSession[]>();
    for (const s of sessions) {
      sessionMap.set(s.bookId, [...(sessionMap.get(s.bookId) ?? []), s]);
    }
    // A mark belongs to a book, so a deleted book takes its marks off the shelf with it — the
    // rows are still there as tombstones until sync has carried them away.
    const onTheShelf = new Set(books.map((b) => b.id));
    setShelf({
      books,
      progress: new Map(progress.map((p) => [p.bookId, p])),
      sessions: sessionMap,
      marks: annotations
        .filter((a) => a.deletedAt === null && onTheShelf.has(a.bookId))
        .sort((a, b) => b.createdAt - a.createdAt),
    });
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
            <MarkCard marks={shelf.marks} books={byId} onNote={saveNote} />
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
 * One marked passage at a time, with a way back and forward through the rest.
 *
 * **This is the shelf's main block**, and it is here because a marked passage otherwise only
 * exists inside the book it came from: the notes panel shows one book's marks and only while
 * that book is open, so a sentence the reader thought worth keeping was never in front of them
 * again unless they went back for it.
 *
 * One at a time rather than three across, and that is a layout decision rather than a
 * preference: three columns show at a glance that the passages come from different books, and
 * they cut each passage to a third of the width, which a long one does not survive.
 *
 * **The source carries the same weight as a title on this screen.** The cover and the bold
 * title are what keep the passage attached to the book it is from — a small grey line of
 * attribution beside a larger title elsewhere on the screen hands the sentence to the wrong
 * book, and the reader has no way to know.
 */
function MarkCard({
  marks,
  books,
  onNote,
}: {
  marks: Annotation[];
  books: Map<string, BookRecord>;
  onNote: (id: string, note: string) => void;
}) {
  const { t } = useLingui();
  // Where in the list, counted without a bound: the modulo below turns it into a position, so
  // walking off either end comes back round rather than stopping. Wrapping is a placeholder for
  // a decision that needs a shelf with more marks on it than this one has to make.
  const [at, setAt] = useState(0);
  // Which mark is open for writing, rather than a bare flag: the flag would follow the reader
  // onto the next card and open its note as well.
  const [editingId, setEditingId] = useState<string | null>(null);

  const index = ((at % marks.length) + marks.length) % marks.length;
  // In range by construction — the modulo above says so, and the caller renders an empty line
  // instead of this card when there is nothing to show.
  const mark = marks[index]!;
  const book = books.get(mark.bookId);
  const coverUrl = useCoverUrl(book?.cover ?? null);

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
    >
      <p className="mark-source">
        <span className="mark-cover">{coverUrl !== null && <img src={coverUrl} alt="" />}</span>
        <strong data-testid="mark-book">{book?.title}</strong>
      </p>
      {/* The book's own words, so the reader's own line-length ceiling applies — the same
          number the page they marked it on was set to, read off `line-length.ts` rather than
          written out here. */}
      <blockquote
        className="mark-quote"
        data-testid="mark-quote"
        style={{ maxWidth: `${LINE_LENGTH[detectScript(mark.text)].ceiling}em` }}
      >
        {mark.text}
      </blockquote>
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
          onClick={() => setAt(at - 1)}
          aria-label={t({
            message: "Previous passage",
            comment:
              "Screen-reader name for the ‹ button on the shelf's card, which steps back to the passage marked after this one. 'Passage' is a stretch of the book the reader marked.",
          })}
        >
          ‹
        </button>
        <span className="mark-count" data-testid="mark-count">
          {t({
            message: `${{ position: index + 1 }} of ${{ total: marks.length }}`,
            comment:
              "Where the reader is in their marked passages, between the two arrows on the shelf's card. Both values are counts; the first is the one on screen, the second is how many there are.",
          })}
        </span>
        <button
          className="ghost"
          onClick={() => setAt(at + 1)}
          aria-label={t({
            message: "Next passage",
            comment:
              "Screen-reader name for the › button on the shelf's card, which steps on to the passage marked before this one. 'Passage' is a stretch of the book the reader marked.",
          })}
        >
          ›
        </button>
      </div>
    </section>
  );
}

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
