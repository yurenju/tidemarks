// PROTOTYPE — Readium ts-toolkit (@readium/navigator + @readium/shared).
// ts-toolkit has NO in-browser EPUB unzipper: @readium/shared only ships
// HttpFetcher, and the official path is a server-side streamer (go-toolkit)
// serving a WebPub manifest. To verify the navigator at all in a pure
// client-side SPA, this adapter includes a *minimal* streamer: jszip unzip →
// OPF parse → WebPub manifest JSON → a Fetcher over the zip. That mini
// streamer is itself part of the finding: this is the extra work Readium
// demands from a browser-only app.
import JSZip from "jszip";
import type { Adapter, AdapterHandle, TocEntry } from "../adapter";

// installed with `npm i --no-save` (kept out of package.json — prototype only)

const MEDIA_TYPES: Record<string, string> = {
  xhtml: "application/xhtml+xml",
  html: "text/html",
  css: "text/css",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  ncx: "application/x-dtbncx+xml",
};

function mediaTypeOf(href: string, declared?: string | null): string {
  if (declared) return declared;
  const ext = href.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_TYPES[ext] ?? "application/octet-stream";
}

function resolvePath(base: string, rel: string): string {
  // base is a directory ('' or 'OEBPS/'); rel may contain ../ — resolve via URL.
  // decode so the result matches jszip's (decoded) entry names.
  return decodeURIComponent(new URL(rel, `http://x/${base}`).pathname.replace(/^\//, ""));
}

/** unzip + OPF parse → { manifestJson, zip, opfDir } */
async function miniStream(data: ArrayBuffer, log: (m: string) => void) {
  const zip = await JSZip.loadAsync(data);
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("META-INF/container.xml missing");
  const container = new DOMParser().parseFromString(containerXml, "text/xml");
  const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath) throw new Error("rootfile full-path missing");
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  log(`OPF: ${opfPath}`);

  const opfXml = await zip.file(opfPath)!.async("string");
  const opf = new DOMParser().parseFromString(opfXml, "text/xml");
  const items = new Map<string, { href: string; type: string; properties: string }>();
  for (const item of Array.from(opf.querySelectorAll("manifest > item"))) {
    items.set(item.getAttribute("id") ?? "", {
      href: item.getAttribute("href") ?? "",
      type: item.getAttribute("media-type") ?? "",
      properties: item.getAttribute("properties") ?? "",
    });
  }
  const spineEl = opf.querySelector("spine");
  const ppd = spineEl?.getAttribute("page-progression-direction"); // 'rtl' for 直排
  const readingOrder = Array.from(opf.querySelectorAll("spine > itemref"))
    .map((ref) => items.get(ref.getAttribute("idref") ?? ""))
    .filter((it): it is NonNullable<typeof it> => !!it)
    .map((it) => ({ href: resolvePath(opfDir, it.href), type: mediaTypeOf(it.href, it.type) }));
  const resources = Array.from(items.values()).map((it) => ({
    href: resolvePath(opfDir, it.href),
    type: mediaTypeOf(it.href, it.type),
  }));
  const title =
    opf.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "title")[0]?.textContent ??
    "Untitled";
  const language =
    opf.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "language")[0]?.textContent ??
    undefined;

  // TOC from EPUB3 nav doc (properties="nav"), fallback NCX
  const toc: { href: string; title: string }[] = [];
  const navItem = Array.from(items.values()).find((it) =>
    it.properties.split(/\s+/).includes("nav"),
  );
  if (navItem) {
    const navPath = resolvePath(opfDir, navItem.href);
    const navDoc = new DOMParser().parseFromString(
      await zip.file(navPath)!.async("string"),
      "application/xhtml+xml",
    );
    const navDir = navPath.includes("/") ? navPath.slice(0, navPath.lastIndexOf("/") + 1) : "";
    const tocNav =
      Array.from(navDoc.querySelectorAll("nav")).find(
        (n) => n.getAttributeNS("http://www.idpf.org/2007/ops", "type") === "toc",
      ) ?? navDoc.querySelector("nav");
    for (const a of Array.from(tocNav?.querySelectorAll("a[href]") ?? [])) {
      toc.push({
        href: resolvePath(navDir, a.getAttribute("href")!),
        title: a.textContent?.trim() ?? "",
      });
    }
    log(`toc from nav doc: ${toc.length} entries`);
  } else {
    const ncxItem = Array.from(items.values()).find((it) => it.type === "application/x-dtbncx+xml");
    if (ncxItem) {
      const ncxPath = resolvePath(opfDir, ncxItem.href);
      const ncx = new DOMParser().parseFromString(
        await zip.file(ncxPath)!.async("string"),
        "text/xml",
      );
      const ncxDir = ncxPath.includes("/") ? ncxPath.slice(0, ncxPath.lastIndexOf("/") + 1) : "";
      for (const np of Array.from(ncx.querySelectorAll("navPoint"))) {
        const src = np.querySelector("content")?.getAttribute("src");
        const label = np.querySelector("navLabel > text")?.textContent?.trim();
        if (src) toc.push({ href: resolvePath(ncxDir, src), title: label ?? "" });
      }
      log(`toc from NCX: ${toc.length} entries`);
    }
  }

  const manifestJson = {
    "@context": "https://readium.org/webpub-manifest/context.jsonld",
    metadata: {
      "@type": "http://schema.org/Book",
      title,
      language,
      ...(ppd ? { readingProgression: ppd } : {}),
    },
    readingOrder,
    resources,
    toc: toc.map((t) => ({ href: t.href, title: t.title })),
  };
  return { manifestJson, zip, ppd };
}

export const readiumAdapter: Adapter = {
  id: "readium",
  label: "Readium ts-toolkit",
  async load(mount, data, { log, onRelocate }) {
    const shared = await import("@readium/shared");
    const navigatorMod = await import("@readium/navigator");
    log(
      `imports ok: shared=[${Object.keys(shared).slice(0, 8).join(",")}…] navigator=[${Object.keys(navigatorMod).slice(0, 8).join(",")}…]`,
    );
    const { Manifest, Publication, Resource, Locator } = shared as never as {
      Manifest: { deserialize: (json: unknown) => unknown };
      Publication: new (v: { manifest: unknown; fetcher: unknown }) => never;
      Resource: abstract new () => unknown;
      Locator: { deserialize: (json: unknown) => unknown };
    };
    const { EpubNavigator } = navigatorMod as never as {
      EpubNavigator: new (
        container: HTMLElement,
        pub: unknown,
        listeners: Record<string, unknown>,
      ) => {
        load: () => Promise<void>;
        destroy: () => Promise<void>;
        goForward: (a: boolean, cb: (ok: boolean) => void) => void;
        goBackward: (a: boolean, cb: (ok: boolean) => void) => void;
        go: (locator: unknown, a: boolean, cb: (ok: boolean) => void) => void;
        goLink: (link: unknown, a: boolean, cb: (ok: boolean) => void) => void;
        applyDecorations?: (ds: unknown[], group: string) => void;
        currentLocator?: unknown;
      };
    };

    const { manifestJson, zip, ppd } = await miniStream(data, log);
    log(`manifest built; readingOrder=${manifestJson.readingOrder.length} ppd=${ppd ?? "(ltr)"}`);

    const manifest = Manifest.deserialize(manifestJson);
    if (!manifest) throw new Error("Manifest.deserialize returned undefined");

    // Fetcher over the zip — the piece ts-toolkit does not provide for browsers
    class ZipResource extends (Resource as abstract new () => { close(): void }) {
      constructor(
        private l: { href: string; toJSON?: () => unknown },
        private path: string,
      ) {
        super();
      }
      async link() {
        return this.l;
      }
      async length() {
        const f = zip.file(this.path);
        if (!f) return undefined;
        return (await f.async("uint8array")).byteLength;
      }
      async read(range?: { start: number; endInclusive: number }) {
        const f = zip.file(this.path);
        if (!f) {
          log(`ZipFetcher MISS: ${this.path}`);
          return undefined;
        }
        const bytes = await f.async("uint8array");
        return range ? bytes.slice(range.start, range.endInclusive + 1) : bytes;
      }
      close() {}
    }
    const fetcher = {
      links: () => [],
      get: (link: { href: string }) => {
        const path = decodeURIComponent(link.href.replace(/^\//, "").split("#")[0]);
        return new ZipResource(link, path);
      },
      close: () => {},
    };

    const pub = new Publication({ manifest, fetcher });
    log("Publication constructed");

    // FINDING: EpubNavigator expects a precomputed positions list — in the
    // Readium architecture that comes from the (server-side) streamer's
    // positions service. Fabricate one locator per spine item.
    const n = manifestJson.readingOrder.length;
    const positions = manifestJson.readingOrder
      .map((ro, i) =>
        Locator.deserialize({
          href: ro.href,
          type: ro.type,
          locations: { position: i + 1, progression: 0, totalProgression: i / n },
        }),
      )
      .filter(Boolean);
    log(`positions fabricated: ${positions.length}`);

    let lastLocator: unknown = null;
    const nav = new EpubNavigator(
      mount,
      pub,
      {
        frameLoaded: () => log("frameLoaded"),
        positionChanged: (locator: {
          locations?: { totalProgression?: number; progression?: number };
        }) => {
          lastLocator = locator;
          onRelocate({
            fraction: locator?.locations?.totalProgression ?? null,
            raw: locator,
          });
        },
        tap: () => false,
        click: () => false,
        zoom: () => {},
        miscPointer: () => {},
        scroll: () => {},
        customEvent: () => {},
        handleLocator: () => false,
        textSelected: (s: unknown) => log(`textSelected: ${JSON.stringify(s).slice(0, 120)}`),
        contentProtection: () => {},
        contextMenu: () => {},
        peripheral: () => {},
        timelineItemChanged: () => {},
      },
      positions as never[],
    );
    await nav.load();
    log("EpubNavigator.load ok");

    const flat: TocEntry[] = manifestJson.toc.map((t) => ({ label: t.title, target: t.href }));

    const cb = (label: string) => (ok: boolean) => {
      if (!ok) log(`${label}: cb(false)`);
    };
    const handle: AdapterHandle = {
      next: () => nav.goForward(false, cb("goForward")),
      prev: () => nav.goBackward(false, cb("goBackward")),
      toc: () => flat,
      goTo: (href) => {
        const link = (pub as { linkWithHref: (h: string) => unknown }).linkWithHref(href as string);
        if (!link) throw new Error(`linkWithHref(${href}) not found`);
        nav.goLink(link, false, cb("goLink"));
      },
      currentLocator: () => lastLocator,
      goToLocator: (l) => nav.go(l, false, cb("go")),
      async highlight() {
        if (!nav.applyDecorations) throw new Error("applyDecorations 不存在");
        if (!lastLocator) throw new Error("沒有 locator");
        nav.applyDecorations(
          [{ id: "proto-hl", locator: lastLocator, style: { tint: "#f7e463" } }],
          "proto",
        );
        return "applyDecorations([highlight]) 已呼叫（樣式物件為猜測，看畫面）";
      },
      destroy: () => {
        void nav.destroy();
      },
    };
    return handle;
  },
};
