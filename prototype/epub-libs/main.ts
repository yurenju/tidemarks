// PROTOTYPE — throwaway harness. Four library adapters on one page,
// switchable via ?lib= (URL is shareable/reload-stable), book via ?book=.
// Every action updates the capability panel + log so the state is always
// visible.
import type { Adapter, AdapterHandle } from "./adapter";
import { epubtsAdapter } from "./adapters/epubts";
import { intityAdapter } from "./adapters/intity";
import { foliateAdapter } from "./adapters/foliate";
import { readiumAdapter } from "./adapters/readium";

const ADAPTERS: Adapter[] = [epubtsAdapter, intityAdapter, foliateAdapter, readiumAdapter];

const $ = (id: string) => document.getElementById(id)!;
const mountOuter = $("mount");
// epub.js (and forks) break vertical pagination on fractional pixel sizes —
// same reason Reader.tsx floors the mount. Inner mount pinned to whole px.
const mount = document.createElement("div");
mountOuter.append(mount);
function floorMount() {
  const r = mountOuter.getBoundingClientRect();
  mount.style.width = `${Math.floor(r.width)}px`;
  mount.style.height = `${Math.floor(r.height)}px`;
}
new ResizeObserver(floorMount).observe(mountOuter);
floorMount();
const logEl = $("log");
const capsEl = $("caps");
const tocPanel = $("toc-panel");

type CapKey = "open" | "toc" | "fraction" | "paginate" | "roundtrip" | "highlight";
const CAPS: [CapKey, string][] = [
  ["open", "開書＋render"],
  ["paginate", "翻頁（點過上/下頁即記）"],
  ["toc", "TOC 清單＋跳轉"],
  ["fraction", "全書進度 fraction"],
  ["roundtrip", "位置 roundtrip"],
  ["highlight", "highlight"],
];
const capState: Record<CapKey, string> = {
  open: "—",
  toc: "—",
  fraction: "—",
  paginate: "—",
  roundtrip: "—",
  highlight: "—",
};
function renderCaps() {
  capsEl.innerHTML = CAPS.map(
    ([k, label]) => `<span class="dot">${capState[k]}</span><span>${label}</span>`,
  ).join("");
}
function setCap(k: CapKey, v: string) {
  capState[k] = v;
  renderCaps();
}
function log(msg: string) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
  console.log("[proto]", msg);
}

const params = new URLSearchParams(location.search);
let libId = params.get("lib") ?? "epubts";
let bookId = params.get("book") ?? "vertical";
($("book") as HTMLSelectElement).value = bookId;

let handle: AdapterHandle | null = null;
let lastFraction: number | null = null;

async function boot() {
  handle?.destroy();
  handle = null;
  mount.innerHTML = "";
  tocPanel.style.display = "none";
  for (const [k] of CAPS) setCap(k, "—");
  logEl.textContent = "";
  const adapter = ADAPTERS.find((a) => a.id === libId) ?? ADAPTERS[0];
  libId = adapter.id;
  $("lib-label").textContent = adapter.label;
  document.title = `PROTOTYPE — ${adapter.label} / ${bookId}`;
  log(`=== ${adapter.label} × ${bookId}.epub ===`);
  try {
    const res = await fetch(`/PROTOTYPE-books/${bookId}.epub`);
    if (!res.ok) throw new Error(`fetch book: HTTP ${res.status}`);
    const data = await res.arrayBuffer();
    log(`book fetched: ${(data.byteLength / 1024).toFixed(0)} KB`);
    handle = await adapter.load(mount, data, {
      vertical: bookId === "vertical",
      log,
      onRelocate: (info) => {
        lastFraction = info.fraction;
        setCap(
          "fraction",
          info.fraction === null ? "❌ null" : `✅ ${(info.fraction * 100).toFixed(1)}%`,
        );
      },
    });
    setCap("open", "✅");
    const toc = handle.toc();
    setCap("toc", toc.length ? `✅ ${toc.length} 項` : "❌ 空");
  } catch (e) {
    setCap("open", "❌");
    log(`FAILED: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  }
}

function setParam(k: string, v: string) {
  const p = new URLSearchParams(location.search);
  p.set(k, v);
  history.replaceState(null, "", `?${p}`);
}

function cycleLib(delta: number) {
  const i = ADAPTERS.findIndex((a) => a.id === libId);
  libId = ADAPTERS[(i + delta + ADAPTERS.length) % ADAPTERS.length].id;
  setParam("lib", libId);
  void boot();
}

$("lib-prev").onclick = () => cycleLib(-1);
$("lib-next").onclick = () => cycleLib(1);
document.addEventListener("keyup", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("input,textarea,select,[contenteditable]")) return;
  if (e.key === "ArrowLeft") cycleLib(-1);
  if (e.key === "ArrowRight") cycleLib(1);
});
($("book") as HTMLSelectElement).onchange = (e) => {
  bookId = (e.target as HTMLSelectElement).value;
  setParam("book", bookId);
  void boot();
};

async function act(name: string, cap: CapKey | null, fn: () => unknown) {
  if (!handle) return;
  try {
    await fn();
    if (cap) setCap(cap, "✅");
  } catch (e) {
    if (cap) setCap(cap, "❌");
    log(`${name} FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }
}

$("btn-next").onclick = () => act("next", "paginate", () => handle!.next());
$("btn-prev").onclick = () => act("prev", "paginate", () => handle!.prev());
$("btn-toc").onclick = () => {
  if (!handle) return;
  const items = handle.toc();
  tocPanel.style.display = tocPanel.style.display === "block" ? "none" : "block";
  tocPanel.innerHTML = "";
  for (const it of items) {
    const b = document.createElement("button");
    b.textContent = it.label || "(無標題)";
    b.onclick = () => {
      void act(`goTo(${it.target})`, "toc", () => handle!.goTo(it.target));
      tocPanel.style.display = "none";
    };
    tocPanel.append(b);
  }
};
$("btn-round").onclick = async () => {
  if (!handle) return;
  try {
    const saved = handle.currentLocator();
    const savedFraction = lastFraction;
    if (saved === null || saved === undefined) throw new Error("currentLocator() 是 null");
    log(`roundtrip: saved=${JSON.stringify(saved).slice(0, 120)} fraction=${savedFraction}`);
    await handle.next();
    await handle.next();
    await new Promise((r) => setTimeout(r, 400));
    await handle.goToLocator(saved);
    await new Promise((r) => setTimeout(r, 600));
    const backFraction = lastFraction;
    const ok =
      savedFraction === null || backFraction === null
        ? null
        : Math.abs(backFraction - savedFraction) < 0.005;
    setCap(
      "roundtrip",
      ok === null ? "⚠️ 無 fraction 可比" : ok ? "✅" : `❌ ${savedFraction}→${backFraction}`,
    );
    log(`roundtrip done: ${savedFraction} → ${backFraction}`);
  } catch (e) {
    setCap("roundtrip", "❌");
    log(`roundtrip FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }
};
$("btn-hl").onclick = () =>
  act("highlight", "highlight", async () => {
    const note = await handle!.highlight();
    log(`highlight: ${note}`);
  });

renderCaps();
void boot();
