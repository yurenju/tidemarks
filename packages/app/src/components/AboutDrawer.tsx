import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";
import { db } from "../lib/db";
import { downloadBlob } from "../lib/download";
import { annotationsToMarkdown } from "../lib/export";
import { formatDuration, totalReadingMs } from "../lib/stats";
import { scheduleSync } from "../lib/sync";
import type { BookRecord } from "../lib/types";
import Drawer from "./Drawer";

interface Details {
  book: BookRecord;
  readingMs: number;
  sessionCount: number;
  /** Whole-book fraction, or `null` for a book that has never been opened. */
  percentage: number | null;
}

/**
 * 〈書的詳情〉: what this one book has cost the reader, and the two things they can do to it.
 *
 * The numbers used to sit on the card, under every cover on the shelf. They answer 「這本我讀了
 * 多少」, which is looking back — the shelf is for picking what to open next, so a whole wall of
 * them was the wrong question asked twenty times over. They are worth reading once, on purpose,
 * which is what a drawer is for.
 */
export default function AboutDrawer({
  bookId,
  onClose,
  onDeleted,
}: {
  /** The book to describe, or `null` when this drawer is not the one the hash names. */
  bookId: string | null;
  onClose: () => void;
  onDeleted: (bookId: string) => void;
}) {
  const [details, setDetails] = useState<Details | null>(null);

  useEffect(() => {
    if (bookId === null) {
      setDetails(null);
      return;
    }
    let live = true;
    void (async () => {
      const [book, sessions, progress] = await Promise.all([
        db.books.get(bookId),
        db.readingSessions.where("bookId").equals(bookId).toArray(),
        db.progress.get(bookId),
      ]);
      if (!live) return;
      // Gone, or a tombstone from another device's deletion arriving mid-look.
      if (!book || book.deletedAt) {
        onClose();
        return;
      }
      setDetails({
        book,
        readingMs: totalReadingMs(sessions),
        sessionCount: sessions.length,
        percentage: progress?.percentage ?? null,
      });
    })();
    return () => {
      live = false;
    };
  }, [bookId]);

  async function exportMarkdown(book: BookRecord) {
    const annotations = (await db.annotations.where("bookId").equals(book.id).toArray()).filter(
      (a) => !a.deletedAt,
    );
    downloadBlob(
      new Blob([annotationsToMarkdown(book, annotations)], { type: "text/markdown" }),
      `${book.title}.md`,
    );
  }

  async function removeBook(book: BookRecord) {
    // A tombstone, not a hard delete: the deletion has to reach the other devices, and a row
    // that merely vanished here would come back on the next pull.
    const now = Date.now();
    await db.transaction("rw", [db.books, db.annotations], async () => {
      await db.books.put({
        ...book,
        file: null,
        cover: null,
        deletedAt: now,
        updatedAt: now,
        dirtyAt: now,
      });
      await db.annotations
        .where("bookId")
        .equals(book.id)
        .modify({ deletedAt: now, updatedAt: now, dirtyAt: now });
    });
    scheduleSync();
    onDeleted(book.id);
  }

  return (
    <Drawer
      open={bookId !== null}
      onClose={onClose}
      title={details?.book.title ?? "書的詳情"}
      testId="drawer-about"
    >
      {details !== null && (
        <>
          <section className="drawer-section" data-testid="about-numbers">
            <p className="drawer-note">{details.book.author}</p>
            <ul className="drawer-list">
              {/* The three numbers that used to sit under every cover on the shelf: how far,
                  how long, how many times. */}
              {details.percentage !== null && (
                <li>
                  <span>讀到</span>
                  <span className="drawer-note" data-testid="about-percentage">
                    {Math.round(details.percentage * 100)}%
                  </span>
                </li>
              )}
              <li>
                <span>累計時長</span>
                <span className="drawer-note" data-testid="about-reading-time">
                  {formatDuration(details.readingMs)}
                </span>
              </li>
              <li>
                <span>場次</span>
                <span className="drawer-note" data-testid="about-sessions">
                  {details.sessionCount} 場
                </span>
              </li>
            </ul>
          </section>

          <section className="drawer-section">
            <div className="drawer-actions">
              <button onClick={() => void exportMarkdown(details.book)}>筆記 .md</button>
              <DeleteBook book={details.book} onConfirm={() => void removeBook(details.book)} />
            </div>
          </section>
        </>
      )}
    </Drawer>
  );
}

/**
 * 刪除, and the question before it.
 *
 * The question used to be the browser's own `confirm()`, which blocks the whole page, comes in
 * the browser's words rather than Folis's, and on a phone arrives as a system sheet with the
 * origin printed across it. This one says what else goes with the book, which is the part the
 * reader cannot see from the shelf.
 *
 * **`Dialog` rather than `AlertDialog`, and that is the a11y-correct choice here rather than a
 * shortcut.** Base UI's `AlertDialog` is modal by construction — it does not take `modal`, so
 * it renders the `position: fixed; inset: 0` interception layer and, on desktop, writes
 * `height: 100dvh; overflow: hidden` onto `<body>`. This drawer opens over the reader as well
 * as over the shelf (`#/book/abc?d=about/abc`), and that body write repaginates the book behind
 * it — the reader answers a question and comes back to a different page. `disablePointerDismissal`
 * restores the one behaviour that actually matters (a click outside does not count as an answer)
 * and `role="alertdialog"` restores the announcement, without the layer.
 */
function DeleteBook({ book, onConfirm }: { book: BookRecord; onConfirm: () => void }) {
  return (
    <Dialog.Root modal="trap-focus" disablePointerDismissal>
      <Dialog.Trigger className="danger" data-testid="about-delete">
        刪除
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="drawer-backdrop" />
        <Dialog.Popup className="alert-popup" role="alertdialog" data-testid="delete-confirm">
          <Dialog.Title className="alert-title">刪除「{book.title}」？</Dialog.Title>
          <Dialog.Description className="drawer-note">
            這本書的重點與筆記會一起刪掉，其他裝置上的也會。
          </Dialog.Description>
          <div className="drawer-actions">
            <Dialog.Close className="ghost">留著</Dialog.Close>
            <Dialog.Close className="danger" onClick={onConfirm} data-testid="delete-confirmed">
              刪除
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
