import { useEffect, useRef, useState } from "react";
import { currentlyReading, statusLines } from "../lib/book-status";
import { db } from "../lib/db";
import { importEpubFile } from "../lib/epub";
import { UI_LANGUAGE } from "../lib/language";
import {
  loadShelfOrder,
  saveShelfOrder,
  SHELF_ORDERS,
  sortShelf,
  type ShelfOrder,
} from "../lib/shelf-order";
import { scheduleSync, subscribeSync } from "../lib/sync";
import type { BookRecord, Progress, ReadingSession } from "../lib/types";

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

  async function addFiles(files: FileList | File[]) {
    setError(null);
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        try {
          const record = await importEpubFile(file);
          await db.books.put(record);
        } catch (e) {
          setError(
            `無法匯入 ${file.name}：${e instanceof Error ? e.message : "不是有效的 epub 檔"}`,
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

  const ordered = sortShelf(shelf.books, shelf.progress, order, UI_LANGUAGE);
  // The one book the reader is in the middle of. Picked from the whole shelf rather than from
  // the order in front of them: 書名排序 changes where a book sits on the wall, not which one
  // they were reading last night.
  const reading = currentlyReading(shelf.books, shelf.progress);
  const wall = reading === null ? ordered : ordered.filter((b) => b.id !== reading.id);
  const now = Date.now();

  function lines(book: BookRecord): string[] {
    return statusLines(shelf.progress.get(book.id), shelf.sessions.get(book.id) ?? [], now);
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
      {/* One door and the name, and nothing else. 〈帳號〉 used to be a second button up here;
          it is a tab of 〈設定〉 now, so asking the reader whether an account counts as a setting
          is a question that no longer arises (ADR-0026). */}
      <header className="library-header">
        <h1>Folis</h1>
        <div className="library-actions">
          <button className="ghost" onClick={onOpenSettings} data-testid="open-settings">
            設定
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {/* Adding a book and choosing an order are the shelf's own two verbs, so they sit with
          the shelf rather than in the header the drawers now own. */}
      <div className="shelf-actions">
        <button onClick={() => fileInput.current?.click()} disabled={busy}>
          匯入 epub
        </button>
        {shelf.books.length > 0 && (
          <label className="shelf-order" data-testid="shelf-order">
            排序
            <select value={order} onChange={(e) => changeOrder(e.target.value as ShelfOrder)}>
              {SHELF_ORDERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
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
          還沒有書。把 epub 放進來，就從這裡開始。
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
          {/* Covers, at the size a cover is for. What used to be here was 43% · 1h 12m · 5 場
              under every one of them — three numbers answering 「我讀了多少」, twenty times
              over, on the screen whose question is 「接下來讀哪一本」. */}
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
  const coverUrl = useCoverUrl(book.cover);

  return (
    <section className="reading-now" data-testid="reading-now" data-book-id={book.id}>
      <button
        className="book-cover reading-now-cover"
        onClick={onOpen}
        title={`開啟 ${book.title}`}
      >
        {coverUrl ? <img src={coverUrl} alt={book.title} /> : <span>{book.title}</span>}
      </button>
      <div className="reading-now-info">
        <h2 data-testid="reading-now-title">{book.title}</h2>
        <p className="reading-now-author">{book.author}</p>
        <StatusLines lines={lines} testId="reading-now-status" />
        <div className="reading-now-actions">
          <button className="primary" onClick={onOpen} data-testid="continue-reading">
            繼續讀
          </button>
          <button className="ghost" onClick={onAbout} aria-label={`${book.title} 的詳情`}>
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
  const coverUrl = useCoverUrl(book.cover);

  return (
    <div className="book-card" data-testid="book-card" data-book-id={book.id}>
      <button
        className="book-cover"
        onClick={onOpen}
        title={`開啟 ${book.title}`}
        data-testid="book-open"
      >
        {coverUrl ? <img src={coverUrl} alt={book.title} /> : <span>{book.title}</span>}
      </button>
      <div className="book-info">
        <strong data-testid="book-title">{book.title}</strong>
        <StatusLines lines={lines} testId="book-status" />
      </div>
      {/* The one door to everything else this book can do. It is a door rather than a row of
          buttons because 筆記 .md and 刪除 are not things anyone does while choosing what to
          read, and a wall of covers with two buttons under each is not a wall of covers. */}
      <button
        className="ghost book-more"
        onClick={onAbout}
        aria-label={`${book.title} 的詳情`}
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
