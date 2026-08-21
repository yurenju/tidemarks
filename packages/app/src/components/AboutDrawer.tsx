import { Plural, Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
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
 * The numbers used to sit on the card, under every cover on the shelf. They answer "how much
 * of this one have I read", which is looking back — the shelf is for picking what to open next,
 * so a whole wall of
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

  const sittings = details?.sessionCount ?? 0;

  return (
    <Drawer
      open={bookId !== null}
      onClose={onClose}
      title={
        details?.book.title ??
        msg({
          message: "About this book",
          comment:
            "Title of the book-details drawer, used only in the moment before the book itself has loaded — after that the drawer wears the book's own title. Shares its entry with the reader's bar button that opens it.",
        })
      }
      testId="drawer-about"
    >
      {details !== null && (
        <>
          {/* Named rather than read inline, so the catalog carries `{sittings}` instead of a
              bare `{0}` that says nothing to whoever translates it. */}
          <section className="drawer-section" data-testid="about-numbers">
            <p className="drawer-note">{details.book.author}</p>
            <ul className="drawer-list">
              {/* The three numbers that used to sit under every cover on the shelf: how far,
                  how long, how many times. */}
              {details.percentage !== null && (
                <li>
                  <span>
                    <Trans comment="Label of the how-far number in the book-details drawer. The value beside it is a percentage.">
                      Read to
                    </Trans>
                  </span>
                  <span className="drawer-note" data-testid="about-percentage">
                    {Math.round(details.percentage * 100)}%
                  </span>
                </li>
              )}
              <li>
                <span>
                  <Trans comment="Label of the total-reading-time number in the book-details drawer.">
                    Time spent
                  </Trans>
                </span>
                <span className="drawer-note" data-testid="about-reading-time">
                  {formatDuration(details.readingMs)}
                </span>
              </li>
              <li>
                <span>
                  <Trans comment="Label of the how-many-times number in the book-details drawer. A sitting is one continuous stretch of reading.">
                    Sittings
                  </Trans>
                </span>
                <span className="drawer-note" data-testid="about-sessions">
                  <Plural
                    value={sittings}
                    one="# sitting"
                    other="# sittings"
                    comment="The how-many-times number in the book-details drawer, with its unit. A sitting is one continuous stretch of reading."
                  />
                </span>
              </li>
            </ul>
          </section>

          <section className="drawer-section">
            <div className="drawer-actions">
              <button onClick={() => void exportMarkdown(details.book)}>
                <Trans comment="Button that writes this book's marks and notes out as a Markdown file. '.md' is the file extension and stays as it is.">
                  Notes .md
                </Trans>
              </button>
              <DeleteBook book={details.book} onConfirm={() => void removeBook(details.book)} />
            </div>
          </section>
        </>
      )}
    </Drawer>
  );
}

/**
 * Deletion, and the question before it.
 *
 * The question used to be the browser's own `confirm()`, which blocks the whole page, is worded
 * by the browser rather than by us, and on a phone arrives as a system sheet with the origin
 * printed across it. This one says what else goes with the book, which is the part the
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
  const title = book.title;

  return (
    <Dialog.Root modal="trap-focus" disablePointerDismissal>
      <Dialog.Trigger className="danger" data-testid="about-delete">
        <Trans comment="Button in the book-details drawer that opens the delete confirmation. Shares its entry with the confirming button inside that dialog.">
          Delete
        </Trans>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="drawer-backdrop" />
        <Dialog.Popup className="alert-popup" role="alertdialog" data-testid="delete-confirm">
          <Dialog.Title className="alert-title">
            <Trans comment="Title of the delete confirmation. The value is the book's own title; the quotation marks around it are this language's — Chinese uses 「」.">
              Delete “{title}”?
            </Trans>
          </Dialog.Title>
          <Dialog.Description className="drawer-note">
            <Trans comment="The one thing a reader cannot see from the shelf, and the reason this question is asked at all: deleting takes the marks and notes with it, everywhere.">
              This book's marks and notes go with it, on your other devices too.
            </Trans>
          </Dialog.Description>
          <div className="drawer-actions">
            <Dialog.Close className="ghost">
              <Trans comment="The way out of the delete confirmation: change nothing. Deliberately not 'Cancel' — it says what happens to the book, which is that it stays.">
                Keep it
              </Trans>
            </Dialog.Close>
            <Dialog.Close className="danger" onClick={onConfirm} data-testid="delete-confirmed">
              <Trans comment="The button that actually deletes, inside the confirmation. Shares its entry with the button that opened the dialog.">
                Delete
              </Trans>
            </Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
