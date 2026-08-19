// PROTOTYPE — foliate-js. No official npm package; loaded straight from
// jsdelivr (relative imports inside the repo resolve over the CDN). The
// <foliate-view> custom element registers itself on import.
import type { Adapter, AdapterHandle, TocEntry } from "../adapter";

const BASE = "https://cdn.jsdelivr.net/gh/johnfactotum/foliate-js@main";

interface FoliateView extends HTMLElement {
  open(book: File | string): Promise<void>;
  goTo(target: unknown): Promise<unknown>;
  goToFraction(f: number): Promise<unknown>;
  next(): Promise<unknown>;
  prev(): Promise<unknown>;
  addAnnotation?(annotation: unknown): void;
  renderer: HTMLElement & { setAttribute(k: string, v: string): void };
  book: {
    toc?: { label: string; href: string; subitems?: unknown }[];
    dir?: string;
    metadata?: Record<string, unknown>;
  };
  lastLocation?: unknown;
}

export const foliateAdapter: Adapter = {
  id: "foliate",
  label: "foliate-js",
  async load(mount, data, { log, onRelocate }) {
    await import(/* @vite-ignore */ `${BASE}/view.js`);
    log("view.js imported, <foliate-view> registered");
    const overlayerMod = (await import(/* @vite-ignore */ `${BASE}/overlayer.js`)) as {
      Overlayer: { highlight: (...a: unknown[]) => unknown };
    };

    const view = document.createElement("foliate-view") as FoliateView;
    view.style.width = "100%";
    view.style.height = "100%";
    mount.append(view);

    let lastFraction: number | null = null;
    let lastDetail: { range?: Range; cfi?: string; fraction?: number; index?: number } | null =
      null;
    view.addEventListener("relocate", (e) => {
      const detail = (e as CustomEvent).detail as typeof lastDetail & { fraction?: number };
      lastDetail = detail;
      lastFraction = detail?.fraction ?? null;
      onRelocate({ fraction: lastFraction, raw: { cfi: detail?.cfi, index: detail?.index } });
    });
    // overlayer registry: index → Overlayer instance, for highlights
    const overlayers = new Map<
      number,
      { element: Element; add: (key: string, range: Range, draw: unknown) => void }
    >();
    view.addEventListener("create-overlayer", (e) => {
      const { index, attach } = (e as CustomEvent).detail as {
        index: number;
        attach: (o: unknown) => void;
      };
      // Overlayer class ships in overlayer.js as `Overlayer`
      const OverlayerCtor = (
        overlayerMod as unknown as {
          Overlayer: new () => { element: Element; add: (k: string, r: Range, d: unknown) => void };
        }
      ).Overlayer;
      const overlayer = new OverlayerCtor();
      overlayers.set(index, overlayer);
      attach(overlayer);
      log(`create-overlayer for section ${index}`);
    });

    const file = new File([data], "book.epub", { type: "application/epub+zip" });
    await view.open(file);
    log(`view.open ok; book.dir=${view.book.dir ?? "(none)"}`);
    view.renderer.setAttribute("flow", "paginated");
    // spine's vertical books need the whole page height as one column
    view.renderer.setAttribute("max-column-count", "1");
    await view.goTo(0);
    log("goTo(0) ok");

    const flat: TocEntry[] = [];
    const walk = (items: { label: string; href: string; subitems?: unknown }[], d: number) => {
      for (const it of items) {
        flat.push({ label: "　".repeat(d) + (it.label ?? "").trim(), target: it.href });
        if (Array.isArray(it.subitems)) walk(it.subitems as never, d + 1);
      }
    };
    if (view.book.toc) walk(view.book.toc, 0);
    log(`toc: ${flat.length} entries`);

    const handle: AdapterHandle = {
      next: () => view.next(),
      prev: () => view.prev(),
      toc: () => flat,
      goTo: (t) => view.goTo(t),
      currentLocator: () => lastDetail?.cfi ?? lastFraction,
      goToLocator: (l) => (typeof l === "number" ? view.goToFraction(l) : view.goTo(l)),
      async highlight() {
        // strategy: highlight the selection inside the content frame; foliate
        // exposes the selected range via the doc's selection in the active frame
        const sel = lastDetail?.range;
        const doc = sel?.startContainer?.ownerDocument;
        const frameSel = doc?.defaultView?.getSelection();
        const range = frameSel && !frameSel.isCollapsed ? frameSel.getRangeAt(0) : sel;
        if (!range) throw new Error("沒有可用的 Range（先選取文字或翻頁一次）");
        const overlayer = overlayers.get(lastDetail?.index ?? -1);
        if (!overlayer) throw new Error(`section ${lastDetail?.index} 沒有 overlayer`);
        overlayer.add(
          "proto-hl",
          range,
          overlayerMod.Overlayer.highlight as unknown as (o: object) => unknown,
        );
        return `Overlayer.add(highlight) on section ${lastDetail?.index}`;
      },
      destroy: () => view.remove(),
    };
    return handle;
  },
};
