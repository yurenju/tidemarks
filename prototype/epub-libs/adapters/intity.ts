// PROTOTYPE — @intity/epub-js (active fork of epub.js, API compatibility
// deliberately broken upstream). Loaded from esm.sh so the repo's package.json
// stays untouched. Every step logs, so whatever diverges from the epub.js API
// shows up as a visible failure instead of a silent one.
import type { Adapter, AdapterHandle, TocEntry } from "../adapter";

const CDN = "https://esm.sh/@intity/epub-js";

export const intityAdapter: Adapter = {
  id: "intity",
  label: "intity/epub-js",
  async load(mount, data, { vertical, log, onRelocate }) {
    const mod = await import(/* @vite-ignore */ CDN);
    log(`import ok, exports: ${Object.keys(mod).join(", ")}`);
    // the fork may export ePub as default (like upstream) or as Book class
    const factory = (mod.default ?? mod.ePub ?? mod.Epub) as
      ((d: ArrayBuffer, o?: object) => unknown) | undefined;
    if (!factory) throw new Error("no callable default export — API surface changed");

    // upstream-style: ePub(arrayBuffer) → Book
    const book = factory(data) as {
      opened?: Promise<unknown>;
      ready?: Promise<unknown>;
      renderTo: (
        el: HTMLElement,
        o: object,
      ) => {
        display: (t?: string) => Promise<unknown>;
        next: () => void;
        prev: () => void;
        on: (ev: string, cb: (...a: unknown[]) => void) => void;
        destroy: () => void;
        annotations?: { highlight: (...a: unknown[]) => void };
      };
      loaded?: {
        navigation?: Promise<{ toc: { label: string; href: string; subitems?: unknown }[] }>;
      };
      navigation?: { toc: { label: string; href: string; subitems?: unknown }[] };
      locations?: { generate: (n: number) => Promise<unknown> };
      spine?: { hooks?: { content?: { register: (fn: (doc: Document) => void) => void } } };
      destroy: () => void;
    };
    await (book.opened ?? book.ready);
    log("book opened");

    if (vertical) {
      if (book.spine?.hooks?.content) {
        book.spine.hooks.content.register((doc) => {
          doc.documentElement.style.writingMode = "vertical-rl";
        });
        log("vertical hook registered (upstream-style spine.hooks.content)");
      } else {
        log("WARN: spine.hooks.content missing — cannot promote writing-mode; observe rendering");
      }
    }

    const rendition = book.renderTo(mount, { width: "100%", height: "100%", flow: "paginated" });
    let lastCfi: string | null = null;
    let lastCfiRange: string | null = null;
    rendition.on("relocated", (...args: unknown[]) => {
      const loc = args[0] as { start?: { cfi?: string; percentage?: number } } | undefined;
      lastCfi = loc?.start?.cfi ?? null;
      onRelocate({ fraction: loc?.start?.percentage ?? null, raw: loc });
    });
    rendition.on("selected", (...args: unknown[]) => {
      lastCfiRange = (args[0] as string) ?? null;
      log(`selected: ${lastCfiRange}`);
    });
    await rendition.display();
    log("display ok");
    book.locations
      ?.generate(600)
      .then(() => log("locations generated"))
      .catch((e: unknown) => log(`locations.generate FAILED: ${e}`));

    let flat: TocEntry[] = [];
    try {
      const nav = book.loaded?.navigation ? await book.loaded.navigation : book.navigation;
      const walk = (items: { label: string; href: string; subitems?: unknown }[], d: number) => {
        for (const it of items) {
          flat.push({ label: "　".repeat(d) + (it.label ?? "").trim(), target: it.href });
          if (Array.isArray(it.subitems)) walk(it.subitems as never, d + 1);
        }
      };
      if (nav?.toc) walk(nav.toc, 0);
      log(`toc: ${flat.length} entries`);
    } catch (e) {
      log(`toc FAILED: ${e}`);
      flat = [];
    }

    const handle: AdapterHandle = {
      next: () => rendition.next(),
      prev: () => rendition.prev(),
      toc: () => flat,
      goTo: (t) => rendition.display(t as string),
      currentLocator: () => lastCfi,
      goToLocator: (l) => rendition.display(l as string),
      async highlight() {
        if (!rendition.annotations) throw new Error("rendition.annotations 不存在");
        if (!lastCfiRange) throw new Error("先在內文選取文字");
        rendition.annotations.highlight(lastCfiRange, {}, () => {}, "proto-hl", {
          fill: "#f7e463",
          "fill-opacity": "0.45",
        });
        return `annotations.highlight(${lastCfiRange})`;
      },
      destroy: () => {
        rendition.destroy();
        book.destroy();
      },
    };
    return handle;
  },
};
