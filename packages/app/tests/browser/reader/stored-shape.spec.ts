// The one-way door in `lib/db.ts`: a device that already holds books written as Blobs has to
// come out the other side holding bytes, with the books still openable. Nothing below the
// browser can answer this — it is IndexedDB's own structured clone, a real Dexie upgrade, and a
// real reload.
//
// **`testWithProfile`, because the setup writes a Blob**, which is the thing an ephemeral WebKit
// session cannot do (`storage.spec.ts`). That is not a workaround here, it is the case: a reader
// on Safari has a profile, so their old rows really do hold Blobs, and this is what happens to
// them.
//
// IndexedDB is driven directly rather than through Dexie. The suite runs against a built bundle
// (`playwright.config.ts`), where there is no module path to import `lib/db.ts` from — and the
// store names are the one thing about Dexie this needs.
import { expect, testWithProfile as test } from "../support/fixtures.js";
import { BOOKS, openBook, settled, visibleText } from "../support/library.js";

test("a book stored as Blobs comes back as bytes, still readable", async ({ page }) => {
  // The real import path, so the row is a real row — then put it back into the shape v5 is
  // written for. Rewriting the row rather than checking out an older build: what has to be
  // exercised is the conversion, and an old build would give a different app as well.
  // Alice rather than the vertical book: this needs a fixture that carries a cover, because
  // the cover is the half of the conversion with a media type to lose.
  await openBook(page, BOOKS.horizontal);
  const before = await visibleText(page);

  const rewritten = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      // No version: open whatever this device is on, which is the version the app just created.
      const request = indexedDB.open("tidemarks");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const run = <T>(
      store: string,
      mode: IDBTransactionMode,
      act: (s: IDBObjectStore) => IDBRequest,
    ) =>
      new Promise<T>((resolve, reject) => {
        const request = act(db.transaction(store, mode).objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      });

    const books = await run<
      { id: string; file: ArrayBuffer; cover: { bytes: ArrayBuffer; type: string } | null }[]
    >("books", "readonly", (s) => s.getAll());
    const book = books[0];
    if (!book?.file) throw new Error("the import left no bytes to put back");

    await run("books", "readwrite", (s) =>
      s.put({
        ...book,
        file: new Blob([book.file], { type: "application/epub+zip" }),
        cover: book.cover ? new Blob([book.cover.bytes], { type: book.cover.type }) : null,
      }),
    );
    // The flag v5's upgrade leaves. Written by hand because it stands in for having arrived on
    // this build from an older one, and Dexie will not re-run an upgrade this device has passed.
    await run("meta", "readwrite", (s) => s.put({ key: "booksInBlobs", value: 1 }));

    const stored = await run<{ file: unknown; cover: unknown }>("books", "readonly", (s) =>
      s.get(book.id),
    );
    db.close();
    return { file: stored.file instanceof Blob, cover: stored.cover instanceof Blob };
  });
  // The setup has to have taken, or everything below would pass on a row that was never in the
  // old shape.
  expect(rewritten).toEqual({ file: true, cover: true });

  await page.reload();
  await expect(page.locator(".reader")).toBeVisible();
  await settled(page);

  // The book still opens, on the same page, which is the whole claim: the bytes survived the
  // conversion rather than being dropped and re-fetched from a server this reader never had.
  expect(await visibleText(page)).toBe(before);

  const after = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tidemarks");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const get = <T>(store: string, act: (s: IDBObjectStore) => IDBRequest) =>
      new Promise<T>((resolve, reject) => {
        const request = act(db.transaction(store, "readonly").objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      });

    const books = await get<{ file: unknown; cover: { bytes: unknown; type: string } | null }[]>(
      "books",
      (s) => s.getAll(),
    );
    const flag = await get<unknown>("meta", (s) => s.get("booksInBlobs"));
    const book = books[0];
    db.close();
    return {
      fileBytes: book?.file instanceof ArrayBuffer ? book.file.byteLength : null,
      coverBytes: book?.cover?.bytes instanceof ArrayBuffer ? book.cover.bytes.byteLength : null,
      coverType: book?.cover?.type ?? null,
      flagCleared: flag === undefined,
    };
  });

  expect(after.fileBytes).toBeGreaterThan(0);
  expect(after.coverBytes).toBeGreaterThan(0);
  // The cover's media type is the one part of it that is not derivable, so losing it in the
  // conversion would lose the whole reason `StoredCover` carries two fields.
  expect(after.coverType).toMatch(/^image\//);
  // Cleared, or every start from here on walks the whole shelf again.
  expect(after.flagCleared).toBe(true);
});
