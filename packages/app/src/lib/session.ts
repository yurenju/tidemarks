/**
 * Whether this device believes it is signed in — a local fact, kept so that a reader who never
 * registered never talks to the server at all.
 *
 * ## Why a flag rather than asking
 *
 * The session lives in an HttpOnly cookie, which is the right place for it and unreadable from
 * here. So the only way to ask "am I signed in" is to make a request — and a request is the very
 * thing that must not happen. CONTEXT.md's [[Exit]] promises that without registering, not one
 * byte of a book, a note or a reading position leaves the device; sync used to push first and
 * learn from the 401 afterwards, which meant the payload had already left. This is what turns
 * that promise into something a reader can check with a network panel.
 *
 * **Not a security boundary.** It is local, and a reader can set it by hand. The server still
 * refuses every request it should refuse; what this decides is only whether one is sent.
 *
 * ## The in-memory fallback
 *
 * A browser that refuses storage (private mode, or the reader blocked it) leaves a reader who
 * *did* sign in unable to sync at all if the answer is simply `false`. So a write also keeps a
 * copy in this module, which the read falls back to.
 *
 * **The fallback turns on when a write fails, not when a read throws**, because the common shape
 * of refused storage is not an exception on the way out: `setItem` throws while `getItem` goes on
 * answering `null` quite happily. Keying off the read alone would leave that reader signed in
 * according to this module and signed out according to every question anyone asks it.
 *
 * ⚠️ **A fallback, not a cache.** As long as writes are landing, localStorage is the answer —
 * otherwise signing out in one tab would leave another tab still pushing.
 */
const KEY = "tidemarks-signed-in";

let inMemory = false;
let storageWrites = true;

export function isSignedIn(): boolean {
  try {
    const stored = localStorage.getItem(KEY) === "1";
    return storageWrites ? stored : inMemory;
  } catch {
    return inMemory;
  }
}

export function setSignedIn(signedIn: boolean): void {
  inMemory = signedIn;
  try {
    if (signedIn) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
    storageWrites = true;
  } catch {
    storageWrites = false;
  }
}
