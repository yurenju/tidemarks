import { compareCfi, parseCfi, type Cfi } from "@yurenju/frond/epub";
import type { Annotation, BookRecord, Progress, ReadingSession } from "./types";

const EXPORT_VERSION = 1;

/** What every epub is, and the only reason this file still has the word "type" in it. */
const EPUB_MEDIA_TYPE = "application/epub+zip";

// Highlights listed in the order they appear in the book, which is what a notes sidebar and
// a markdown export both want.
//
// The comparison used to be ours: digits pulled out of the CFI with a regular expression,
// which ignored step assertions and could not tell a character offset from a step. frond
// exports the real thing, so what is left here is deciding what to do with its answer.
//
// Parsed once per annotation rather than once per comparison — a sort makes O(n log n)
// comparisons, and parsing inside the comparator would parse the same string repeatedly.
export function sortByBookOrder(annotations: Annotation[]): Annotation[] {
  const parsed = new Map<string, Cfi | undefined>();
  for (const annotation of annotations) {
    if (!parsed.has(annotation.cfiRange)) {
      parsed.set(annotation.cfiRange, tryParseCfi(annotation.cfiRange));
    }
  }

  return [...annotations].sort((a, b) => {
    const left = parsed.get(a.cfiRange);
    const right = parsed.get(b.cfiRange);
    // A CFI that will not parse, or one frond calls incomparable (the two sit either side of
    // an indirection boundary), is left where it is rather than thrown to an end — the list
    // is a reader's own highlights, and dropping one out of place is more visible than a
    // pair whose order nobody can determine.
    if (!left || !right) return 0;

    const verdict = compareCfi(left, right);
    return verdict === "before" ? -1 : verdict === "after" ? 1 : 0;
  });
}

function tryParseCfi(cfi: string): Cfi | undefined {
  try {
    return parseCfi(cfi);
  } catch {
    return undefined;
  }
}

export function annotationsToMarkdown(
  book: { title: string; author: string },
  annotations: Annotation[],
): string {
  const lines = [`# ${book.title}`, "", book.author ? `${book.author}` : "", ""];
  for (const a of sortByBookOrder(annotations)) {
    lines.push(`> ${a.text.replace(/\n/g, "\n> ")}`);
    lines.push("");
    if (a.note) {
      lines.push(a.note);
      lines.push("");
    }
  }
  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export interface ExportBundle {
  books: BookRecord[];
  progress: Progress[];
  annotations: Annotation[];
  sessions: ReadingSession[];
}

interface SerializedBook {
  id: string;
  title: string;
  author: string;
  addedAt: number;
  fileType: string;
  fileBase64: string;
  coverType: string | null;
  coverBase64: string | null;
}

export async function serializeExport(bundle: ExportBundle): Promise<string> {
  // books without a downloaded epub body (lazy download) cannot be exported
  const books: SerializedBook[] = await Promise.all(
    bundle.books
      .filter((b): b is BookRecord & { file: ArrayBuffer } => b.file !== null && !b.deletedAt)
      .map(async (b) => ({
        id: b.id,
        title: b.title,
        author: b.author,
        addedAt: b.addedAt,
        // **Still written, still the constant it always was.** The record stopped carrying a
        // media type for the epub because an epub only has the one (`lib/types.ts`), but the
        // backup format is unchanged — a file written by an older build has this field, and
        // dropping it would make this version's exports unreadable to that one for no gain.
        fileType: EPUB_MEDIA_TYPE,
        fileBase64: bytesToBase64(b.file),
        coverType: b.cover?.type ?? null,
        coverBase64: b.cover ? bytesToBase64(b.cover.bytes) : null,
      })),
  );
  return JSON.stringify({
    version: EXPORT_VERSION,
    books,
    progress: bundle.progress.map(({ dirtyAt: _d, ...p }) => p),
    annotations: bundle.annotations.filter((a) => !a.deletedAt).map(({ dirtyAt: _d, ...a }) => a),
    sessions: bundle.sessions.map(
      ({ id, bookId, startedAt, endedAt, startFraction, endFraction }) => ({
        id,
        bookId,
        startedAt,
        endedAt,
        startFraction,
        endFraction,
      }),
    ),
  });
}

export async function parseImport(json: string): Promise<ExportBundle> {
  const data = JSON.parse(json);
  if (data?.version !== EXPORT_VERSION) {
    throw new Error(`Unsupported export version: ${data?.version}`);
  }
  const now = Date.now();
  const books: BookRecord[] = (data.books as SerializedBook[]).map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    addedAt: b.addedAt,
    // `fileType` is read past: every epub is `application/epub+zip`, so the field says nothing
    // the record needs. A cover's type does vary, and is kept.
    file: base64ToBytes(b.fileBase64),
    cover:
      b.coverBase64 != null
        ? { bytes: base64ToBytes(b.coverBase64), type: b.coverType ?? "" }
        : null,
    updatedAt: now,
    deletedAt: null,
    dirtyAt: now,
  }));
  const annotations: Annotation[] = (data.annotations ?? []).map((a: Annotation) => ({
    ...a,
    // pre-v2 exports lack these fields
    updatedAt: a.updatedAt ?? a.createdAt,
    deletedAt: a.deletedAt ?? null,
    dirtyAt: now,
  }));
  const sessions: ReadingSession[] = (data.sessions ?? []).map(
    (s: {
      id?: string;
      bookId: string;
      startedAt: number;
      endedAt: number;
      startFraction?: number | null;
      endFraction?: number | null;
    }) => ({
      // pre-v2 exports have no session ids
      id: s.id ?? crypto.randomUUID(),
      bookId: s.bookId,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      // A backup taken before a sitting carried its place in the book: the duration is real,
      // where it happened is not recoverable, and `stats.ts` leaves those out of the speed.
      startFraction: s.startFraction ?? null,
      endFraction: s.endFraction ?? null,
      dirtyAt: now,
    }),
  );
  return {
    books,
    progress: (data.progress ?? []).map((p: Progress) => ({
      ...p,
      chapterLabel: p.chapterLabel ?? null,
      dirtyAt: now,
    })),
    annotations,
    sessions,
  };
}
