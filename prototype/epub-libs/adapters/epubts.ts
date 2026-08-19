// PROTOTYPE — baseline: the library the app already uses (@likecoin/epub-ts).
// Mirrors the essential moves of src/components/Reader.tsx so the other
// adapters are compared against reality, not against a strawman.
import ePub from "@likecoin/epub-ts";
import { verticalColumnCss, zeroBodyPadding } from "../../../src/lib/vertical-layout";
import { resolveSpineHref } from "../../../src/lib/toc";
import type { Adapter, AdapterHandle, TocEntry } from "../adapter";

export const epubtsAdapter: Adapter = {
  id: "epubts",
  label: "epub-ts（現用）",
  async load(mount, data, { vertical, log, onRelocate }) {
    const book = ePub(data);
    await book.opened;
    log("book.opened ok");

    if (vertical) {
      const spine = book.spine as unknown as {
        hooks: { content: { register: (fn: (doc: Document) => void) => void } };
      };
      spine.hooks.content.register((doc) => {
        doc.documentElement.style.writingMode = "vertical-rl";
      });
    }

    const rendition = book.renderTo(mount, { width: "100%", height: "100%", spread: "none" });
    let lastCfiRange: string | null = null;
    rendition.hooks.content.register(
      (contents: { addStylesheetCss: (css: string, key: string) => void; document?: Document }) => {
        if (vertical) {
          zeroBodyPadding(contents.document);
          contents.addStylesheetCss(verticalColumnCss(mount.clientHeight), "proto");
        }
      },
    );
    rendition.on("selected", (cfiRange: string) => {
      lastCfiRange = cfiRange;
      log(`selected: ${cfiRange}`);
    });
    let lastCfi: string | null = null;
    rendition.on("relocated", (loc: { start: { cfi: string; percentage?: number } }) => {
      lastCfi = loc.start.cfi;
      onRelocate({ fraction: loc.start.percentage ?? null, raw: loc.start.cfi });
    });
    await rendition.display();
    log("rendition.display ok");
    if (vertical) {
      // epub.js re-applies its own inline column styles on relayout; re-inject
      // (same dance as Reader.tsx does on 'resized'/'rendered')
      const reinject = () => {
        for (const c of rendition.getContents() as unknown as {
          addStylesheetCss: (css: string, key: string) => void;
          document?: Document;
        }[]) {
          zeroBodyPadding(c.document);
          c.addStylesheetCss(verticalColumnCss(mount.clientHeight), "proto");
        }
      };
      rendition.on("resized", reinject);
      rendition.on("rendered", reinject);
    }
    book.locations
      .generate(600)
      .then(() => log("locations generated (percentage now meaningful)"))
      .catch((e: unknown) => log(`locations.generate FAILED: ${e}`));

    const nav = await book.loaded.navigation;
    const flat: TocEntry[] = [];
    const walk = (items: { label: string; href: string; subitems?: unknown }[], d: number) => {
      for (const it of items) {
        // FINDING: raw it.href silently no-ops on books whose spine hrefs are
        // percent-encoded differently (this book!) — the exact bug Reader.tsx
        // patches with resolveSpineHref. Baseline needs the patch too.
        flat.push({
          label: "　".repeat(d) + it.label.trim(),
          target: resolveSpineHref(book.spine, it.href),
        });
        if (Array.isArray(it.subitems)) walk(it.subitems, d + 1);
      }
    };
    walk(nav.toc, 0);
    log(`toc: ${flat.length} entries`);

    const handle: AdapterHandle = {
      next: () => rendition.next(),
      prev: () => rendition.prev(),
      toc: () => flat,
      goTo: (t) => rendition.display(t as string),
      currentLocator: () => lastCfi,
      goToLocator: (l) => rendition.display(l as string),
      async highlight() {
        if (!lastCfiRange) throw new Error("先在內文選取文字（selected 事件提供 CFI range）");
        rendition.annotations.highlight(lastCfiRange, {}, () => {}, "proto-hl", {
          fill: "#f7e463",
          "fill-opacity": "0.45",
          "mix-blend-mode": "multiply",
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
