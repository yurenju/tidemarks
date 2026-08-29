export interface BookMeta {
  id: string;
  title: string;
  author: string;
  addedAt: number;
}

export interface BookRecord extends BookMeta {
  // null until the epub is downloaded from the server (lazy download)
  file: Blob | null;
  cover: Blob | null;
  updatedAt: number;
  deletedAt: number | null;
  /**
   * What the server last said about this book having a cover, kept so that `cover` being null
   * can be read as "still owed" rather than "there is none".
   *
   * **This is the retry ledger for cover downloads.** A cover is fetched outside the sync
   * payload, and the fetch can fail; without this the only record that one was owed lived in a
   * local variable inside the pull that saw the row, and the cursor moved past that row anyway,
   * so the book kept an empty card until something else happened to touch it.
   *
   * Missing on a book this device imported (it has the blob) and on rows written before the
   * field existed.
   */
  hasCover?: boolean;
  dirtyAt?: number;
}

// book metadata as it travels over the sync wire (no blobs)
export interface SyncBook extends BookMeta {
  updatedAt: number;
  deletedAt: number | null;
  hasCover?: boolean;
}

export interface Progress {
  bookId: string;
  cfi: string;
  /**
   * The range CFI covering the page that was on screen, which `cfi` alone cannot give: `cfi` is
   * a point (where the reader is), a page is a stretch (what they can see), and a page is a
   * product of layout, so only the renderer knows its extent — and only while it is on screen.
   * Carrying it is what lets an agent answer "explain the passage I am looking at" later, from
   * a Worker with no browser.
   *
   * `null` when this page holds no characters (a full-page image), and on rows written before
   * this field existed.
   */
  pageRange: string | null;
  percentage: number;
  /**
   * The chapter this position falls in, as the book's own table of contents names it.
   *
   * Written here because the shelf cannot work it out: naming the chapter means the table of
   * contents and the section boundaries, and that means opening the epub — twenty of them, to
   * draw one screen. The reader has the book open and knows the answer already.
   *
   * `null` for a position written before this field existed, and for a book whose table of
   * contents does not reach the section the reader is in (a cover, a colophon).
   */
  chapterLabel: string | null;
  lastReadAt: number;
  dirtyAt?: number;
}

export interface Annotation {
  id: string;
  bookId: string;
  cfiRange: string;
  text: string;
  note: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  /**
   * When the shelf's revisit card last put this passage in front of the reader.
   *
   * `null` (or missing, on a row written before this field existed) means it never has, and
   * `revisit.ts` reads that as the front of the queue rather than the back — a passage marked
   * this morning and a passage imported from years ago are both unseen, and both are owed a
   * turn before anything the card has already shown.
   *
   * ⚠️ **Showing a card does not touch `updatedAt`, and this field does not merge with the
   * rest of the row.** Annotations are last-write-wins on `updatedAt`, so if looking at a card
   * counted as a write, opening the shelf on one device would beat a note written on another.
   * `mergeAnnotation` takes the later of the two `lastShownAt` values independently of who won
   * the row; seeing is monotonic, so the later one is always right.
   */
  lastShownAt?: number | null;
  dirtyAt?: number;
}

export interface ReadingSession {
  id: string;
  bookId: string;
  startedAt: number;
  endedAt: number;
  /**
   * Where in the book this sitting began and ended, as whole-book fractions.
   *
   * The pair is what makes a reading speed possible at all: the duration alone says how long
   * the reader sat there, and a book is not read at a rate of minutes. Both are `null` when the
   * device never had a fraction to record — the whole-book index had not finished building
   * (frond reports no fraction until it has), or the row was written before these fields
   * existed. `stats.ts` leaves those sittings out of the speed rather than reading them as
   * "moved nowhere".
   */
  startFraction: number | null;
  endFraction: number | null;
  dirtyAt?: number;
}
