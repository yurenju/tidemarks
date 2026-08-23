import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { currentlyReading, statusLines } from "../lib/book-status";
import { db } from "../lib/db";
import { importEpubFile } from "../lib/epub";

import { loadShelfOrder, saveShelfOrder, sortShelf, type ShelfOrder } from "../lib/shelf-order";
import { SHELF_ORDERS } from "../lib/shelf-order-choices";
import { scheduleSync, subscribeSync } from "../lib/sync";
import type { BookRecord, Progress, ReadingSession } from "../lib/types";
import { Wordmark } from "./Wordmark";

interface Shelf {
  books: BookRecord[];
  progress: Map<string, Progress>;
  sessions: Map<string, ReadingSession[]>;
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
  });
  const [order, setOrder] = useState<ShelfOrder>(loadShelfOrder);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Ordering happens below, in `sortShelf`, so the query no longer asks for one: the default
  // order reads `progress` as well as `books`, which no single Dexie index can answer.
  async function reload() {
    const [allBooks, progress, sessions] = await Promise.all([
      db.books.toArray(),
      db.progress.toArray(),
      db.readingSessions.toArray(),
    ]);
    const books = allBooks.filter((b) => !b.deletedAt);
    const sessionMap = new Map<string, ReadingSession[]>();
    for (const s of sessions) {
      sessionMap.set(s.bookId, [...(sessionMap.get(s.bookId) ?? []), s]);
    }
    setShelf({
      books,
      progress: new Map(progress.map((p) => [p.bookId, p])),
      sessions: sessionMap,
    });
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

  const ordered = sortShelf(shelf.books, shelf.progress, order, i18n.locale);
  // The one book the reader is in the middle of. Picked from the whole shelf rather than from
  // the order in front of them: ordering by title changes where a book sits on the wall, not
  // which one they were reading last night.
  const reading = currentlyReading(shelf.books, shelf.progress);
  const wall = reading === null ? ordered : ordered.filter((b) => b.id !== reading.id);
  const now = Date.now();

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
        // One box around the two, so a wide window can put them side by side. Below 1280 it is
        // a plain block and the two stack exactly as they did; there is no second layout to
        // keep in step, only a grid that switches on when there is room for one.
        <div className="shelf">
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
 * The book the reader is in the middle of, large enough that choosing it is not a decision.
 *
 * It is the whole answer to the shelf's question most of the time — a reader with one book on
 * the go opens that one — so it gets the cover at a size worth looking at, the two lines that
 * say where they are, and a verb.
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
        className="book-cover reading-now-cover"
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
        <p className="reading-now-author">{book.author}</p>
        <StatusLines lines={lines} testId="reading-now-status" />
        <div className="reading-now-actions">
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
        </div>
      </div>
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
