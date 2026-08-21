// Sync engine: push dirty rows, pull deltas, clear dirty. Local Dexie stays
// the source of truth; the server is a hub. Sync failure never blocks the UI.
import { msg } from "@lingui/core/macro";
import { i18n } from "./i18n";
import { db, getSyncCursor, setSyncCursor } from "./db";
import { clearableDirty, dedupeSessions, mergeAnnotation, mergeBook, mergeProgress } from "./merge";
import { isEmptyPayload, syncPayload, toSyncBook, type SyncPayload } from "./sync-payload";
import type { Progress, ReadingSession } from "./types";
import { apiFetch } from "./api";

export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "unauthenticated" | "error";

export interface SyncState {
  status: SyncStatus;
  lastSyncAt: number | null;
  error: string | null;
}

let state: SyncState = { status: "idle", lastSyncAt: null, error: null };
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
  const dirty = await readDirty(snapshotAt);
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

  // upload epub bodies for freshly imported books (metadata row now exists server-side)
  for (const b of dirtyBooks) {
    if (b.deletedAt || !b.file) continue;
    await apiFetch(`/api/books/${b.id}/file`, { method: "PUT", body: b.file });
    if (b.cover) await apiFetch(`/api/books/${b.id}/cover`, { method: "PUT", body: b.cover });
  }

  await db.transaction(
    "rw",
    [db.books, db.progress, db.annotations, db.readingSessions],
    async () => {
      // server rejected these in favor of its own version: adopt it, drop dirty
      for (const remote of conflicts.books) {
        const local = await db.books.get(remote.id);
        await db.books.put({
          ...remote,
          file: local?.file ?? null,
          cover: local?.cover ?? null,
          dirtyAt: undefined,
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
        if (!conflicted.books.has(b.id)) await db.books.update(b.id, { dirtyAt: undefined });
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

async function pull() {
  const cursor = await getSyncCursor();
  const remote = await fetchJson<PullResponse>(`/api/sync?since=${cursor}`);

  const coversToFetch: string[] = [];
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
          dirtyAt: undefined,
        });
        if (!rb.deletedAt && rb.hasCover && !local?.cover) coversToFetch.push(rb.id);
      }
      for (const rp of remote.progress) {
        const local = await db.progress.get(rp.bookId);
        const winner = mergeProgress(local, rp);
        if (winner === rp) await db.progress.put(rp);
      }
      for (const ra of remote.annotations) {
        const local = await db.annotations.get(ra.id);
        const winner = mergeAnnotation(local, ra);
        if (winner === ra) await db.annotations.put(ra);
      }
      const ids = new Set((await db.readingSessions.toCollection().primaryKeys()) as string[]);
      for (const rs of dedupeSessions(ids, remote.readingSessions as ReadingSession[])) {
        await db.readingSessions.put(rs);
      }
    },
  );

  // covers are part of shelf sync (small images); epub bodies stay lazy
  for (const id of coversToFetch) {
    try {
      const res = await apiFetch(`/api/books/${id}/cover`);
      if (res.ok) await db.books.update(id, { cover: await res.blob() });
    } catch {
      // cover is cosmetic; next sync retries
    }
  }

  await setSyncCursor(remote.cursor);
}

let running = false;
let rerun = false;

export async function syncNow(): Promise<void> {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  setState({ status: "syncing", error: null });
  try {
    const snapshotAt = Date.now();
    await pushDirty(snapshotAt);
    await pull();
    setState({ status: "synced", lastSyncAt: Date.now() });
  } catch (e) {
    if ((e as { auth?: boolean }).auth) {
      setState({ status: "unauthenticated" });
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

// write-triggered sync: debounce so page turns don't hammer the server
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
export async function downloadBookFile(id: string): Promise<Blob> {
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
  const blob = await res.blob();
  await db.books.update(id, { file: blob });
  return blob;
}
