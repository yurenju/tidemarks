// Sync engine: push dirty rows, pull deltas, clear dirty. Local Dexie stays
// the source of truth; the server is a hub. Sync failure never blocks the UI.
import { msg } from "@lingui/core/macro";
import { i18n } from "./i18n";
import { db, getSyncCursor, setSyncCursor } from "./db";
import {
  annotationRowLost,
  clearableDirty,
  dedupeSessions,
  mergeAnnotation,
  mergeBook,
  mergeProgress,
} from "./merge";
import {
  isEmptyPayload,
  syncPayload,
  toSyncBook,
  withinQuota,
  type Quota,
  type SyncPayload,
} from "./sync-payload";
import type { Progress, ReadingSession } from "./types";
import { apiFetch } from "./api";
import { isSignedIn, setSignedIn } from "./session";

export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "unauthenticated" | "error";

export interface SyncState {
  status: SyncStatus;
  lastSyncAt: number | null;
  error: string | null;
  /**
   * The server's word on which books it holds for this account (`sync-payload.ts`). `null`
   * until it has spoken this session, and again after signing out: the list lives and dies with
   * the session, so a shelf with no account never marks a book "only on this device".
   */
  quota: Quota | null;
}

let state: SyncState = { status: "idle", lastSyncAt: null, error: null, quota: null };
const listeners = new Set<(s: SyncState) => void>();

export function getSyncState(): SyncState {
  return state;
}

export function subscribeSync(cb: (s: SyncState) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  for (const cb of listeners) cb(state);
}

interface PullResponse extends SyncPayload {
  cursor: number;
}

interface PushResponse {
  conflicts: Pick<SyncPayload, "books" | "progress" | "annotations">;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init);
  if (res.status === 401) throw Object.assign(new Error("unauthenticated"), { auth: true });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url}: ${res.status}`);
  return res.json();
}

async function readDirty(snapshotAt: number) {
  const [books, progress, annotations, readingSessions] = await Promise.all([
    db.books.where("dirtyAt").aboveOrEqual(0).toArray(),
    db.progress.where("dirtyAt").aboveOrEqual(0).toArray(),
    db.annotations.where("dirtyAt").aboveOrEqual(0).toArray(),
    db.readingSessions.where("dirtyAt").aboveOrEqual(0).toArray(),
  ]);
  return {
    books: clearableDirty(books, snapshotAt),
    progress: clearableDirty(progress, snapshotAt),
    annotations: clearableDirty(annotations, snapshotAt),
    readingSessions: clearableDirty(readingSessions, snapshotAt),
  };
}

async function pushDirty(snapshotAt: number) {
  // Only what the server will take. A refused book keeps its `dirtyAt` by never being cleared
  // below, and that flag is what sends it again once a delete frees a slot.
  const dirty = withinQuota(await readDirty(snapshotAt), state.quota);
  const {
    books: dirtyBooks,
    progress: dirtyProgress,
    annotations: dirtyAnnotations,
    readingSessions: dirtySessions,
  } = dirty;

  const payload = syncPayload(dirty);
  if (isEmptyPayload(payload)) return;

  const { conflicts } = await fetchJson<PushResponse>("/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Upload epub bodies for freshly imported books (metadata row now exists server-side).
  //
  // ⚠️ **A body that does not go up is this book's problem and nothing else's.** These are the
  // largest requests the app makes — a whole epub, on whatever connection the reader has — so
  // they are the ones that drop. Letting that throw took the rest of the sync with it: the pull
  // that follows never ran, and the book stayed dirty, so *every* later sync queued behind the
  // same failing upload and the reader stopped hearing from their other devices entirely.
  //
  // The book keeps its `dirtyAt` instead, which is what brings it back here next time — see
  // `pull`, which has to be told not to clear it.
  //
  // **A refusal counts as a drop.** `apiFetch` is a bare `fetch`, so a 401 from an expired
  // session or a 413 from a body the server will not take resolves like a success; only a
  // socket dying rejects. The three mean the same thing here — the body is not up there — and
  // reading them the same way is the difference between a retry and silence.
  //
  // **The cover is in the same breath as the file, though it costs a repeat of the epub to
  // retry.** It looks like the cheap thing to shrug off, and it is not: the server reports a
  // cover by whether it holds one, so a cover that never lands makes every other device certain
  // this book has none, and none of them ever asks again. Cosmetic and lost for good is still
  // lost for good, and `dirtyAt` is the only handle on "come back to this".
  //
  // ponytail: one flag for both halves, so a dropped thumbnail re-sends the whole book. Split
  // them when a reader is on a connection where that is the difference.
  //
  // ponytail: no ceiling on the retries and nothing on screen while they go on. Give it a
  // backoff and a word to the reader when someone reports a book that will not leave a device.
  const bodyStuck = new Set<string>();
  for (const b of dirtyBooks) {
    if (b.deletedAt || !b.file) continue;
    try {
      const file = await apiFetch(`/api/books/${b.id}/file`, { method: "PUT", body: b.file });
      if (!file.ok) throw new Error(`PUT /api/books/${b.id}/file: ${file.status}`);
      if (b.cover) {
        // The bytes, with no `Content-Type` behind them where a Blob used to put one there.
        // Nothing read it: the Worker hands `request.body` straight to R2 without recording a
        // type, and answers every cover as `application/octet-stream` on the way back.
        const cover = await apiFetch(`/api/books/${b.id}/cover`, {
          method: "PUT",
          body: b.cover.bytes,
        });
        if (!cover.ok) throw new Error(`PUT /api/books/${b.id}/cover: ${cover.status}`);
      }
    } catch {
      bodyStuck.add(b.id);
    }
  }

  await db.transaction(
    "rw",
    [db.books, db.progress, db.annotations, db.readingSessions],
    async () => {
      // server rejected these in favor of its own version: adopt it, drop dirty — unless the
      // body is still on this device only, which the metadata's losing has no bearing on.
      for (const remote of conflicts.books) {
        const local = await db.books.get(remote.id);
        await db.books.put({
          ...remote,
          file: local?.file ?? null,
          cover: local?.cover ?? null,
          dirtyAt: bodyStuck.has(remote.id) ? local?.dirtyAt : undefined,
        });
      }
      for (const remote of conflicts.progress) await db.progress.put(remote);
      for (const remote of conflicts.annotations) await db.annotations.put(remote);

      const conflicted = {
        books: new Set(conflicts.books.map((b) => b.id)),
        progress: new Set(conflicts.progress.map((p) => p.bookId)),
        annotations: new Set(conflicts.annotations.map((a) => a.id)),
      };
      for (const b of dirtyBooks) {
        if (!conflicted.books.has(b.id) && !bodyStuck.has(b.id)) {
          await db.books.update(b.id, { dirtyAt: undefined });
        }
      }
      for (const p of dirtyProgress) {
        if (!conflicted.progress.has(p.bookId)) {
          await db.progress.update(p.bookId, { dirtyAt: undefined });
        }
      }
      for (const a of dirtyAnnotations) {
        if (!conflicted.annotations.has(a.id)) {
          await db.annotations.update(a.id, { dirtyAt: undefined });
        }
      }
      for (const s of dirtySessions) await db.readingSessions.update(s.id, { dirtyAt: undefined });
    },
  );
}

const progressListeners = new Set<(rows: Progress[]) => void>();

/**
 * The positions a pull just wrote, handed to whoever is showing one.
 *
 * The reader asks where the book was left **once**, when it opens, and after that nothing tells
 * it that a position arrived from another device — the row lands in Dexie and the page on
 * screen stays where it was. Worse, the next page turn writes a newer `lastReadAt` over it, so
 * what the other device read is gone without either screen mentioning it (`lib/elsewhere.ts`).
 *
 * **Every pull, not only the one a return to the foreground triggers.** The question the
 * subscriber asks is "is this position somewhere other than the page I am on", and that is
 * neither more nor less true for a pull the debounce started — while a tab left open on one
 * device is read from another, which is the whole case.
 *
 * Only the rows that won their merge are passed on: a remote position that lost to the local
 * one was never written, and offering it would be offering the reader a position behind the
 * one they are sitting at.
 */
export function subscribePulledProgress(cb: (rows: Progress[]) => void): () => void {
  progressListeners.add(cb);
  return () => progressListeners.delete(cb);
}

const annotationListeners = new Set<(bookIds: Set<string>) => void>();

/**
 * The books a pull just wrote marks for, handed to whoever is showing them.
 *
 * Same shape of problem as the positions above, and the same reason for existing: the reader's
 * copy of a book's marks is read when the book opens, and a note made on another device lands in
 * Dexie with nothing on screen mentioning it (`components/Reader.tsx`).
 *
 * **Which books rather than which rows.** A subscriber has to re-read the whole table for its
 * book anyway — a mark deleted elsewhere has to leave the panel, and that is an absence no
 * arriving row can express — so the rows themselves would be thrown away. What the subscriber
 * cannot work out for itself is whether this round wrote anything at all, and that is what stops
 * a re-read from replacing state on every empty round: several a minute, each one a fresh array
 * that sends the highlight layer measuring rectangles again.
 *
 * A tombstone is a row like any other, so a mark deleted elsewhere names its book here too.
 */
export function subscribePulledAnnotations(cb: (bookIds: Set<string>) => void): () => void {
  annotationListeners.add(cb);
  return () => annotationListeners.delete(cb);
}

async function pull() {
  const cursor = await getSyncCursor();
  const remote = await fetchJson<PullResponse>(`/api/sync?since=${cursor}`);

  const arrivedProgress: Progress[] = [];
  const markedBooks = new Set<string>();
  await db.transaction(
    "rw",
    [db.books, db.progress, db.annotations, db.readingSessions],
    async () => {
      for (const rb of remote.books) {
        const local = await db.books.get(rb.id);
        const localMeta = local ? toSyncBook(local) : undefined;
        const winner = mergeBook(localMeta, rb);
        if (winner !== rb) continue; // local (dirty) version is newer; next push decides
        await db.books.put({
          id: rb.id,
          title: rb.title,
          author: rb.author,
          addedAt: rb.addedAt,
          updatedAt: rb.updatedAt,
          deletedAt: rb.deletedAt,
          file: rb.deletedAt ? null : (local?.file ?? null),
          cover: rb.deletedAt ? null : (local?.cover ?? null),
          hasCover: !!rb.hasCover,
          // ⚠️ **Whatever the row already said, not `undefined`.** A pull sends nothing, so it
          // is in no position to declare a book's business finished — clearing dirty is the
          // push's job and the push does it. What used to be cleared here was the flag saying
          // an epub body never made it up (`pushDirty`): the push kept it, and the pull two
          // statements later wiped it, so the book was never tried again and the other device
          // was left with a shelf card whose file 404s for good.
          //
          // A row that lost its metadata to this remote one still gets `dirtyAt` back, and the
          // cost of that is one more push of fields the server already agrees with, which the
          // next round clears.
          dirtyAt: local?.dirtyAt,
        });
      }
      for (const rp of remote.progress) {
        const local = await db.progress.get(rp.bookId);
        const winner = mergeProgress(local, rp);
        if (winner === rp) {
          await db.progress.put(rp);
          arrivedProgress.push(rp);
        }
      }
      for (const ra of remote.annotations) {
        const local = await db.annotations.get(ra.id);
        const winner = mergeAnnotation(local, ra);
        // **Written and announced are two different questions**, because an annotation now has
        // two halves that are settled apart from each other (`mergeAnnotation`).
        //
        // Written: anything the local row does not already say. Not `winner === ra` — a pull can
        // lose the words and still carry a later viewing of them, and the merge then returns
        // neither of its two arguments. When the local row won, the merge kept its `dirtyAt`
        // with it, so it still goes up on the next push.
        if (winner !== local) await db.annotations.put(winner);
        // Announced: only when the words themselves changed. A subscriber wakes to re-read a
        // whole book's marks and re-measure their rectangles, and a passage the shelf's card
        // happened to show on another device looks no different on this one.
        if (!annotationRowLost(local, ra)) markedBooks.add(ra.bookId);
      }
      const ids = new Set((await db.readingSessions.toCollection().primaryKeys()) as string[]);
      for (const rs of dedupeSessions(ids, remote.readingSessions as ReadingSession[])) {
        await db.readingSessions.put(rs);
      }
    },
  );

  // After the transaction, so a subscriber reading Dexie back sees what it is being told about.
  if (arrivedProgress.length > 0) {
    for (const cb of progressListeners) cb(arrivedProgress);
  }
  if (markedBooks.size > 0) {
    for (const cb of annotationListeners) cb(markedBooks);
  }

  // Covers are part of shelf sync (small images); epub bodies stay lazy.
  //
  // **Every book still owed one, not the ones this round happened to mention.** The cursor moves
  // below whatever happens here, so a row that arrived and failed is a row no later pull will
  // send again; kept as a list built while reading the round, the retry it promised could never
  // happen and the card stayed blank until something else touched the book (#120). The question
  // the row itself answers — `hasCover` with no `cover` — is asked of the whole table instead,
  // so a failure comes back around however it failed: a 5xx never reached the `catch` below,
  // and now it does not have to.
  //
  // ponytail: no ceiling. A cover the server promises and cannot serve (its object lost, the
  // column still set) is asked for on every round, for as long as the book is on the shelf. Give
  // it a backoff when someone reports the requests.
  //
  // ponytail: a filtered Dexie collection cannot use the keys-only path, so this walks the whole
  // books table and deserializes each record — blobs by reference, but still every row, every
  // round. Index the field if a shelf ever gets big enough to feel it.
  const coversToFetch = (await db.books
    .filter((b) => !!b.hasCover && !b.cover && !b.deletedAt)
    .primaryKeys()) as string[];
  for (const id of coversToFetch) {
    try {
      const res = await apiFetch(`/api/books/${id}/cover`);
      if (res.ok) {
        // `application/octet-stream`, because that is all the Worker says — the type an epub
        // declared for its cover never leaves the device that imported it. The same string a
        // pulled cover has always carried; `<img>` sniffs the bytes regardless.
        const type = res.headers.get("content-type") ?? "";
        await db.books.update(id, { cover: { bytes: await res.arrayBuffer(), type } });
      }
    } catch {
      // cover is cosmetic; the row keeps saying it is owed one, so the next sync tries again
    }
  }

  await setSyncCursor(remote.cursor);
}

/** What `/auth/me` answers: who this browser is, and the server's word on the quota. */
export interface Account {
  userId: string;
  /** How many books this account may sync; `null` for no limit (ADR-0011). */
  limit: number | null;
  /** The ids of the books the server currently holds for it, deleted and frozen ones left out. */
  synced: string[];
}

/** Ask the server which books it holds, after a push, because the push's reply does not say. */
async function readQuota(at: number) {
  const { limit, synced } = await fetchJson<Account>("/auth/me");
  setState({ quota: { limit, synced, at } });
}

/** Signing out, or the server saying the session is gone: the list goes with it. */
export function forgetQuota(): void {
  setState({ quota: null });
}

let running = false;
let rerun = false;

export async function syncNow(): Promise<void> {
  // A reader who never registered has nowhere to sync to, and finding that out from a 401 would
  // mean the books and notes had already been sent (`lib/session.ts`). App open and every return
  // to the foreground land here, so this is the door.
  //
  // **The state is left exactly as it was.** Setting `idle` here would wipe the
  // `unauthenticated` an expired session has just left behind — the next visibility change would
  // erase [[Account]]'s "sign in again", which is the one thing that path has to say.
  if (!isSignedIn()) return;

  if (running) {
    rerun = true;
    return;
  }
  running = true;
  setState({ status: "syncing", error: null });
  try {
    const snapshotAt = Date.now();
    // Before the first push of a session as well as after every one: with nothing known yet,
    // the push would send every book and epub body, and on a full account all of that is
    // dropped on arrival. Stamped at zero rather than now, so no book on the shelf reads as
    // refused before this session has tried to send it — the read after the push says which.
    if (state.quota === null) await readQuota(0);
    await pushDirty(snapshotAt);
    await pull();
    await readQuota(snapshotAt);
    setState({ status: "synced", lastSyncAt: Date.now() });
  } catch (e) {
    if ((e as { auth?: boolean }).auth) {
      // The session ran out (they last 90 days) or was revoked elsewhere. The flag said signed
      // in and the server disagrees, so the server wins — and the status stays on screen until
      // signing in sets it again, because nothing below clears it.
      setSignedIn(false);
      setState({ status: "unauthenticated", quota: null });
    } else if (!navigator.onLine) {
      setState({ status: "offline" });
    } else {
      setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      void syncNow();
    }
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

// write-triggered sync: debounce so page turns don't hammer the server.
//
// ⚠️ `tests/browser/library/signed-out.spec.ts` waits this out before asserting that nothing was
// sent, with a fixed 4s. Raising the default past that would make it pass without ever reaching
// the trigger it is about. It cannot import this module — Dexie and a Lingui macro do not survive
// that runner's transform — so the two are tied by this note.
export function scheduleSync(delayMs = 3000): void {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void syncNow(), delayMs);
}

// Where each book was last left, kept in memory as well as in Dexie. See `beaconPositions`
// for why a copy up here earns its keep.
const latestPositions = new Map<string, Progress>();

/** Called on every page turn, alongside the Dexie write. */
export function notePosition(position: Progress): void {
  latestPositions.set(position.bookId, position);
}

/**
 * Push the reader's position **as they leave**, without waiting for the debounce.
 *
 * This is the whole reason an agent can be asked about the current page. A page turn only
 * schedules a sync three seconds out; switch to another app immediately and that timer is
 * running in a backgrounded tab, which mobile browsers throttle and eventually freeze. The
 * agent would then be handed the page *before* the one on screen, and the reader would
 * conclude the feature is inaccurate — nobody guesses "sync timing" from that.
 *
 * Two things make this different from calling `syncNow()` on the way out, and both matter:
 *
 * `sendBeacon` rather than `fetch`, because the request has to outlive the page: a fetch in
 * flight when the tab is frozen or discarded is cancelled, a beacon is handed to the browser
 * to deliver.
 *
 * **Synchronous, from the in-memory copy rather than from Dexie.** Reading IndexedDB first
 * would mean the beacon is issued after an `await` — outside the `visibilitychange` handler,
 * back in the same suspendable ground this exists to get off. The read is fast, but "fast" is
 * not the property being bought here.
 *
 * Only positions travel. Highlights and imports keep the ordinary debounce: nothing about them
 * expires in the seconds after the reader switches app, and a smaller body is one less thing
 * between the position and the server.
 *
 * The response is unreadable, so dirty flags stay set and the next real sync pushes the same
 * rows again. Harmless: progress merges last-writer-wins, so re-sending lands on the same
 * answer.
 */
export function beaconPositions(): boolean {
  // The same door as `syncNow`, and the one that needed it most: a beacon's response is
  // unreadable, so a 401 here was never even seen — the position simply left the device.
  if (!isSignedIn()) return false;
  if (typeof navigator.sendBeacon !== "function") return false;
  const payload = syncPayload({
    books: [],
    progress: [...latestPositions.values()],
    annotations: [],
    readingSessions: [],
  });
  if (isEmptyPayload(payload)) return false;
  const body = new Blob([JSON.stringify(payload)], { type: "application/json" });
  return navigator.sendBeacon("/api/sync", body);
}

// download an epub body on demand (lazy download), storing it in Dexie
export async function downloadBookFile(id: string): Promise<ArrayBuffer> {
  const res = await apiFetch(`/api/books/${id}/file`);
  if (!res.ok) {
    throw new Error(
      i18n._(
        msg({
          message: `Download failed (${{ status: res.status }})`,
          comment:
            "Shown to the reader when the epub file behind a book on the shelf could not be fetched. The value is the HTTP status code, kept because it is the one clue worth reporting.",
        }),
      ),
    );
  }
  const bytes = await res.arrayBuffer();
  await db.books.update(id, { file: bytes });
  return bytes;
}
