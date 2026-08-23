// The flag that decides whether sync opens its mouth at all. What a browser can show is the
// promise itself — no requests without registering, in
// tests/browser/library/signed-out.spec.ts. What it cannot show is this module's behaviour when
// storage refuses, because every engine in that suite has working storage: so the branch that
// keeps a signed-in reader syncing in private mode is proved here or nowhere.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "tidemarks-signed-in";

/**
 * Loads a fresh copy of the module.
 *
 * It holds two module-level values — the in-memory copy and whether writes are landing — so a
 * second test importing the first one's module would inherit both, and the interesting cases are
 * exactly the ones about that state.
 */
async function loadSession() {
  vi.resetModules();
  return import("./session");
}

/** A working localStorage. */
function stubStorage(store = new Map<string, string>()) {
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  return store;
}

beforeEach(() => stubStorage());

afterEach(() => {
  // @ts-expect-error putting the environment back the way it was found
  delete globalThis.localStorage;
});

describe("with storage that works", () => {
  it("starts signed out, so a browser that has never been used sends nothing", async () => {
    const { isSignedIn } = await loadSession();
    expect(isSignedIn()).toBe(false);
  });

  it("remembers signing in, and forgets it on the way out", async () => {
    const { isSignedIn, setSignedIn } = await loadSession();

    setSignedIn(true);
    expect(isSignedIn()).toBe(true);

    setSignedIn(false);
    expect(isSignedIn()).toBe(false);
  });

  it("answers from storage rather than from memory, so another tab's sign-out is seen", async () => {
    const store = stubStorage();
    const { isSignedIn, setSignedIn } = await loadSession();
    setSignedIn(true);

    // What signing out in a second tab leaves behind: this tab's copy still says true.
    store.delete(KEY);

    expect(isSignedIn()).toBe(false);
  });
});

describe("with storage that refuses", () => {
  /**
   * The shape private mode actually takes: reads are fine and answer `null`, writes throw.
   *
   * Keying the fallback off a throwing *read* would miss this entirely — which is the whole
   * reason this case is written down.
   */
  function stubReadOnlyStorage() {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("QuotaExceededError");
      },
      removeItem: () => {
        throw new DOMException("QuotaExceededError");
      },
      clear: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage;
  }

  it("keeps a reader who just signed in syncing, when the write could not land", async () => {
    stubReadOnlyStorage();
    const { isSignedIn, setSignedIn } = await loadSession();

    setSignedIn(true);

    expect(isSignedIn()).toBe(true);
  });

  it("still sends nothing for a reader who never signed in", async () => {
    stubReadOnlyStorage();
    const { isSignedIn } = await loadSession();

    expect(isSignedIn()).toBe(false);
  });

  it("falls back when the read itself throws, which is the other way storage is refused", async () => {
    globalThis.localStorage = {
      getItem: () => {
        throw new DOMException("SecurityError");
      },
      setItem: () => {
        throw new DOMException("SecurityError");
      },
    } as unknown as Storage;
    const { isSignedIn, setSignedIn } = await loadSession();

    setSignedIn(true);

    expect(isSignedIn()).toBe(true);
  });
});
