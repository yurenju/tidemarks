// PROTOTYPE (#262) — throwaway, lives on `prototype/note-cut` and never reaches main.
//
// Question: when the phone's one-note page cuts a long passage to half the screen, where should
// the cut window sit so the mark is in it? Five ways of placing the window (`?variant=A…E`), each
// shown against a set of made-up passages (`?scenario=…`) as well as the book's own (`real`).
//
// The query sits before the hash (`/?variant=B&scenario=late#/book/…?d=notes/…`): the app's own
// route lives in the hash and rewrites it freely, and `location.search` is left alone by that.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { MarkedParagraph } from "../lib/marked-paragraphs";

export const VARIANTS = [
  { key: "A", name: "Today: cut from the paragraph's top" },
  { key: "B", name: "Mark starts mid-window, both edges fade" },
  { key: "C", name: "Mark at the top third, a button at each edge" },
  { key: "D", name: "A window you scroll inside" },
  { key: "E", name: "Start at the mark's sentence, after an ellipsis" },
] as const;
export type VariantKey = (typeof VARIANTS)[number]["key"];

// Made up for the prototype, so they can be shown anywhere. Lengths are what matter: a phone's half
// screen holds about 12–16 lines of about 20 characters at the default size.
const HARBOUR =
  "港口的傍晚總是來得比山上早一些。太陽還掛在對岸的屋頂上，碼頭這邊已經暗了下來，漁船一艘接一艘地靠岸，船上的人把繩子拋給岸上的人，岸上的人接住了，繞在鐵柱上，打一個結，誰也不必開口。我坐在魚市後面的石階上，看著這一切，像在看一齣每天都演、卻從來沒有人買票的戲。賣魚的婦人把剩下的魚倒進木桶，用海水沖過一遍，再用粗鹽抹勻，說是明天一早還能賣。旁邊的小孩蹲在地上數貝殼，數到一半就忘了，又從頭數起，好像數字本身並不重要，重要的是手裡那一點涼涼的重量。再過去一點，有個老人在補網，針線在他手裡穿來穿去，快得看不清楚，他補的不是一張網，而是一整個冬天的生計。我常常想，這座城市真正的樣子，不在導覽手冊上那些教堂與宮殿裡，而在這些不必被記住的動作裡。天色再暗一些的時候，路燈一盞一盞地亮起來，先是碼頭，再是坡道，最後是山腰上那幾戶人家。海風轉了方向，帶來遠處渡輪的汽笛聲，低低的，拖得很長。魚市的鐵門拉下了一半，婦人提著木桶從底下鑽出來，跟補網的老人點了點頭，兩個人什麼也沒說，各自往不同的巷子走去。我這才明白，那種讓人捨不得離開的東西，並不是風景，而是一種不必言說的默契：彼此認得，卻不打擾，知道對方明天還會在這裡。我站起來，拍掉褲子上的灰，也往坡道上走去。";

const MORNING =
  "第二天清晨我又去了碼頭。前一晚的鐵門已經拉起，婦人照舊站在木桶後面，桶裡的魚換了一批，鹽卻還是那一把。補網的老人不在，他的位子上擺著一張摺好的網，壓著一塊石頭，像是替他占著位置。我在石階上坐了一會兒，渡輪又響了一次汽笛，比昨晚清亮許多。小孩沒有來，地上卻留著一排貝殼，大小排得整整齊齊，大概是昨天數完了，捨不得帶走。我把手伸進口袋，摸到昨天撿的一枚貝殼，冰冰涼涼的，跟那一排是同一種顏色。我想了想，把它放在那一排的最後面，讓它們湊成一個整數，然後起身離開。走到坡道口回頭看，那一排貝殼在晨光裡亮了一下，像是有人在遠處對我眨了眨眼。";

const SHORT =
  "下山的路比上山好走，卻比上山更容易滑倒。我扶著欄杆一級一級往下，心裡想的不是腳下，而是剛才那盞燈。";

/** One paragraph with the mark running from `from` to the end of `to` (both must be in it). */
function cut(text: string, from: string, to: string = from): MarkedParagraph {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start) + to.length;
  if (start < 0 || end < to.length) throw new Error(`prototype scenario: "${from}" not found`);
  return { before: text.slice(0, start), marked: text.slice(start, end), after: text.slice(end) };
}

export const SCENARIOS: { key: string; name: string; paragraphs: MarkedParagraph[] | null }[] = [
  { key: "real", name: "The book's own passage", paragraphs: null },
  {
    key: "short",
    name: "Short paragraph, short mark",
    paragraphs: [cut(SHORT, "心裡想的不是腳下")],
  },
  {
    key: "medium-end",
    name: "Paragraph a few lines over half the screen, mark at its end",
    paragraphs: [cut(MORNING, "像是有人在遠處對我眨了眨眼")],
  },
  {
    key: "long-start",
    name: "Long paragraph, mark in its first line",
    paragraphs: [cut(HARBOUR, "總是來得比山上早一些")],
  },
  {
    key: "long-middle",
    name: "Long paragraph, mark in its middle",
    paragraphs: [cut(HARBOUR, "他補的不是一張網，而是一整個冬天的生計")],
  },
  {
    key: "late",
    name: "Long paragraph, short mark near its end (the issue's case)",
    paragraphs: [cut(HARBOUR, "一種不必言說的默契")],
  },
  {
    key: "last-words",
    name: "Long paragraph, mark is its last words",
    paragraphs: [cut(HARBOUR, "也往坡道上走去。")],
  },
  {
    key: "long-mark-late",
    name: "Long paragraph, long mark (≈7 lines) at its end",
    paragraphs: [cut(HARBOUR, "魚市的鐵門拉下了一半", "知道對方明天還會在這裡。")],
  },
  {
    key: "huge-mark",
    name: "Long paragraph, mark longer than half the screen",
    paragraphs: [cut(HARBOUR, "旁邊的小孩蹲在地上", "低低的，拖得很長。")],
  },
  {
    key: "two-paragraphs",
    name: "Mark from the end of a long paragraph into the next",
    paragraphs: [
      cut(HARBOUR, "我這才明白", "也往坡道上走去。"),
      cut(MORNING, "第二天清晨我又去了碼頭。"),
    ],
  },
];

function read(): { variant: VariantKey; scenario: string } {
  const params = new URLSearchParams(window.location.search);
  const variant = params.get("variant");
  const scenario = params.get("scenario");
  return {
    variant: VARIANTS.some((v) => v.key === variant) ? (variant as VariantKey) : "A",
    scenario: SCENARIOS.some((s) => s.key === scenario) ? scenario! : "real",
  };
}

const listeners = new Set<() => void>();
let snapshot = read();

function write(next: { variant?: string; scenario?: string }) {
  const params = new URLSearchParams(window.location.search);
  if (next.variant) params.set("variant", next.variant);
  if (next.scenario) params.set("scenario", next.scenario);
  window.history.replaceState(window.history.state, "", `?${params}${window.location.hash}`);
  snapshot = read();
  listeners.forEach((listener) => listener());
}

export function usePrototype() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

/** Shown in dev, or anywhere the address asks for a variant — never on an ordinary page. */
export const prototypeOn =
  import.meta.env.DEV || new URLSearchParams(window.location.search).has("variant");

function step<T extends { key: string }>(list: readonly T[], key: string, by: number): string {
  const at = list.findIndex((item) => item.key === key);
  return list[(at + by + list.length) % list.length]!.key;
}

export function PrototypeSwitcher({ info }: { info: string }) {
  const { variant, scenario } = usePrototype();
  const current = VARIANTS.find((v) => v.key === variant)!;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "ArrowLeft") write({ variant: step(VARIANTS, variant, -1) });
      else if (event.key === "ArrowRight") write({ variant: step(VARIANTS, variant, 1) });
      else if (event.key === "[") write({ scenario: step(SCENARIOS, scenario, -1) });
      else if (event.key === "]") write({ scenario: step(SCENARIOS, scenario, 1) });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant, scenario]);

  const button: React.CSSProperties = {
    minHeight: 32,
    padding: "0 10px",
    border: "none",
    borderRadius: 999,
    background: "#333",
    color: "#fff",
    fontSize: 16,
  };
  return createPortal(
    <div
      data-prototype-switcher
      style={{
        position: "fixed",
        zIndex: 1000,
        left: "50%",
        bottom: 64,
        transform: "translateX(-50%)",
        width: "min(94vw, 440px)",
        padding: 8,
        borderRadius: 14,
        background: "#111",
        color: "#fff",
        font: "12px/1.35 system-ui, sans-serif",
        boxSizing: "border-box",
        boxShadow: "0 6px 24px rgba(0,0,0,.35)",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button style={button} onClick={() => write({ variant: step(VARIANTS, variant, -1) })}>
          ‹
        </button>
        <strong style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
          {current.key} — {current.name}
        </strong>
        <button style={button} onClick={() => write({ variant: step(VARIANTS, variant, 1) })}>
          ›
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button style={button} onClick={() => write({ scenario: step(SCENARIOS, scenario, -1) })}>
          ‹
        </button>
        <select
          value={scenario}
          onChange={(event) => write({ scenario: event.target.value })}
          style={{ flex: 1, minWidth: 0, fontSize: 12, background: "#222", color: "#fff" }}
        >
          {SCENARIOS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.key} — {s.name}
            </option>
          ))}
        </select>
        <button style={button} onClick={() => write({ scenario: step(SCENARIOS, scenario, 1) })}>
          ›
        </button>
      </div>
      <code style={{ color: "#9cf", fontSize: 11, textAlign: "center" }}>{info}</code>
    </div>,
    document.body,
  );
}

/** Where the passage's lines fall, measured off a hidden copy set in full at the same width. */
interface Geometry {
  line: number;
  /** Lines half the screen has room for. */
  window: number;
  /** Lines the whole passage takes. */
  total: number;
  /** First line the mark is on, and the line after its last (zero-based). */
  markStart: number;
  markEnd: number;
  /** Where each sentence of the first paragraph's lead-in begins, and on which line. */
  sentences: { at: number; line: number }[];
}

/**
 * The first line of the window, given where in it the mark's first line should stand.
 * - A paragraph that fits, or a mark already inside the window from the top, starts at the top:
 *   the short cases must not get worse.
 * - A mark too long to fit below the anchor is moved up until its end is in (and a line after
 *   it), but never closer than two lines to the top — past that the mark itself is cut at the foot.
 */
function windowStart(geo: Geometry, anchor: number): number {
  if (geo.total <= geo.window) return 0;
  let want = geo.markStart - anchor;
  // One line past the mark's end, so the fade at the foot falls on the words after it.
  const end = Math.min(geo.markEnd + 1, geo.total);
  if (end - want > geo.window) want = Math.min(end - geo.window, Math.max(geo.markStart - 2, 0));
  return Math.min(Math.max(want, 0), geo.total - geo.window);
}

const ELLIPSIS = "……";

export function PrototypePassage({
  variant,
  shown,
  fontSize,
  sans,
  onInfo,
}: {
  variant: VariantKey;
  shown: MarkedParagraph[];
  fontSize: number;
  sans: boolean;
  onInfo: (info: string) => void;
}) {
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [geo, setGeo] = useState<Geometry | null>(null);
  // A: the whole passage. B, E: the whole passage. C: each edge on its own. D: the whole passage.
  const [openTop, setOpenTop] = useState(false);
  const [openBottom, setOpenBottom] = useState(false);
  // D: which edges of the inner window have more beyond them.
  const [scrolled, setScrolled] = useState({ top: false, bottom: true });
  // E: how many lines the trimmed passage takes, measured off the box itself.
  const [trimmedTotal, setTrimmedTotal] = useState<number | null>(null);
  // Where the mark stood on screen before a toggle, to put it back there after.
  const holdRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const ghost = ghostRef.current;
    if (ghost === null) return;
    const measure = () => {
      const line = parseFloat(getComputedStyle(ghost).lineHeight);
      if (!(line > 0)) return;
      const inner = ghost.firstElementChild as HTMLElement;
      const top = inner.getBoundingClientRect().top;
      const marks = inner.querySelectorAll("mark");
      const first = marks[0]?.getClientRects()[0];
      const lastRects = marks[marks.length - 1]?.getClientRects();
      const last = lastRects?.[lastRects.length - 1];
      const lineOf = (y: number) => Math.floor((y - top) / line);
      const sentences: Geometry["sentences"] = [];
      const lead = inner.querySelector("p")?.firstChild;
      if (lead instanceof Text) {
        const text = lead.data;
        for (let at = 0; at < text.length; at++) {
          if (at !== 0 && !"。！？；".includes(text[at - 1]!)) continue;
          const range = document.createRange();
          range.setStart(lead, at);
          range.setEnd(lead, at + 1);
          const rect = range.getClientRects()[0];
          if (rect) sentences.push({ at, line: lineOf(rect.top + 1) });
        }
      }
      const next: Geometry = {
        line,
        window: Math.max(1, Math.floor(window.innerHeight / 2 / line)),
        total: Math.round(inner.getBoundingClientRect().height / line),
        markStart: first ? lineOf(first.top + 1) : 0,
        markEnd: last ? Math.ceil((last.bottom - top - 1) / line) : 0,
        sentences,
      };
      setGeo((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(ghost);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [shown, fontSize, sans]);

  const anchor =
    geo === null
      ? 0
      : variant === "C" || variant === "D"
        ? Math.floor(geo.window / 3)
        : Math.floor(geo.window / 2);
  const start = geo === null || variant === "A" ? 0 : windowStart(geo, anchor);
  const fits = geo === null || geo.total <= geo.window;

  // E: cut the lead-in at the last sentence that begins on or before the line the window would
  // start at, so the passage opens on a sentence rather than halfway through one.
  const trimAt =
    variant === "E" && geo !== null && start > 0 && !openBottom
      ? ([...geo.sentences].reverse().find((s) => s.line <= start)?.at ?? 0)
      : 0;
  const visible =
    trimAt === 0
      ? shown
      : [{ ...shown[0]!, before: ELLIPSIS + shown[0]!.before.slice(trimAt) }, ...shown.slice(1)];

  useLayoutEffect(() => {
    if (variant !== "E" || geo === null) return;
    const inner = boxRef.current?.firstElementChild as HTMLElement | undefined;
    if (inner) setTrimmedTotal(Math.round(inner.getBoundingClientRect().height / geo.line));
  }, [variant, geo, trimAt]);

  // Put the mark back where it stood on screen before the toggle (B, C's top, E).
  useLayoutEffect(() => {
    const was = holdRef.current;
    holdRef.current = null;
    const mark = boxRef.current?.querySelector("mark");
    const body = boxRef.current?.closest<HTMLElement>(".panel-body");
    if (was === null || !mark || !body) return;
    body.scrollTop += mark.getBoundingClientRect().top - was;
  }, [openTop, openBottom]);
  const hold = () => {
    holdRef.current = boxRef.current?.querySelector("mark")?.getBoundingClientRect().top ?? null;
  };

  // D: start the inner window with the mark at its anchor.
  useLayoutEffect(() => {
    if (variant !== "D" || geo === null || openBottom) return;
    const box = boxRef.current;
    if (box) box.scrollTop = start * geo.line;
  }, [variant, geo, start, openBottom]);

  let height: number | undefined;
  let offset = 0;
  let above = 0;
  let below = 0;
  if (geo !== null && !fits) {
    if (variant === "A" || variant === "B") {
      if (!openBottom) {
        height = geo.window * geo.line;
        offset = start;
        above = start;
        below = geo.total - start - geo.window;
      }
    } else if (variant === "C") {
      const from = openTop ? 0 : start;
      const to = openBottom ? geo.total : start + geo.window;
      height = (to - from) * geo.line;
      offset = from;
      above = from;
      below = geo.total - to;
    } else if (variant === "D") {
      if (!openBottom) height = geo.window * geo.line;
      above = start;
      below = geo.total - start - geo.window;
    } else if (variant === "E" && !openBottom && trimmedTotal !== null) {
      if (trimmedTotal > geo.window) height = geo.window * geo.line;
      above = start;
      below = Math.max(0, trimmedTotal - geo.window);
    }
  }

  useEffect(() => {
    onInfo(
      geo === null
        ? "measuring…"
        : `passage ${geo.total} lines · window ${geo.window} · mark lines ${geo.markStart + 1}–${geo.markEnd} · window from line ${start + 1} · hidden ${above} above / ${below} below`,
    );
  }, [geo, start, above, below, onInfo]);

  const clipped = height !== undefined;
  const fade =
    variant === "D"
      ? { top: clipped && scrolled.top, bottom: clipped && scrolled.bottom }
      : variant === "E"
        ? { top: false, bottom: clipped }
        : { top: clipped && above > 0, bottom: clipped && below > 0 };
  const edge = variant === "C" ? "1lh" : "2lh";
  const mask =
    fade.top && fade.bottom
      ? `linear-gradient(to bottom, transparent, #000 ${edge}, #000 calc(100% - ${edge}), transparent)`
      : fade.top
        ? `linear-gradient(to bottom, transparent, #000 ${edge})`
        : fade.bottom
          ? `linear-gradient(to bottom, #000 calc(100% - ${edge}), transparent)`
          : undefined;

  const paragraphsOf = (list: MarkedParagraph[]) => (
    <div style={{ marginTop: variant === "D" ? 0 : -offset * (geo?.line ?? 0) }}>
      {list.map((paragraph, i) => (
        <p key={i}>
          {paragraph.before}
          <mark>{paragraph.marked}</mark>
          {paragraph.after}
        </p>
      ))}
    </div>
  );
  const sourceClass = `note-page-source${sans ? " sans" : ""}`;
  const size = { fontSize: `calc(1rem * ${fontSize} / 100)` };
  const moreLabel = (n: number) => `Show the full text (${n} more line${n === 1 ? "" : "s"})`;

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={ghostRef}
        aria-hidden
        className={sourceClass}
        style={{ ...size, position: "absolute", inset: "0 0 auto", visibility: "hidden" }}
      >
        <div>
          {shown.map((paragraph, i) => (
            <p key={i}>
              {paragraph.before}
              <mark>{paragraph.marked}</mark>
              {paragraph.after}
            </p>
          ))}
        </div>
      </div>

      {variant === "C" && above > 0 && (
        <button
          type="button"
          className="note-page-more"
          style={{ marginTop: 0, marginBottom: "var(--space-1)" }}
          onClick={() => {
            hold();
            setOpenTop(true);
          }}
        >
          ⌃ {above} line{above === 1 ? "" : "s"} before this
        </button>
      )}

      <div
        ref={boxRef}
        className={sourceClass}
        onScroll={(event) => {
          const box = event.currentTarget;
          setScrolled({
            top: box.scrollTop > 1,
            bottom: box.scrollTop + box.clientHeight < box.scrollHeight - 1,
          });
        }}
        style={{
          ...size,
          maxHeight: height,
          overflowY: variant === "D" && clipped ? "auto" : "hidden",
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      >
        {paragraphsOf(visible)}
      </div>

      {!fits && variant !== "C" && (
        <button
          type="button"
          className="note-page-more"
          aria-expanded={openBottom}
          onClick={() => {
            if (variant === "D") {
              setOpenBottom((was) => !was);
              // D answers "jump to the paragraph's start".
              requestAnimationFrame(() => {
                const body = boxRef.current?.closest<HTMLElement>(".panel-body");
                if (body) body.scrollTop = 0;
              });
              return;
            }
            if (variant !== "A") hold();
            setOpenBottom((was) => !was);
          }}
        >
          {openBottom
            ? "Show less of the text"
            : moreLabel(variant === "E" && geo ? geo.total - geo.window : above + below)}
        </button>
      )}

      {variant === "C" && (below > 0 || openBottom) && (
        <button
          type="button"
          className="note-page-more"
          onClick={() => setOpenBottom((was) => !was)}
        >
          {openBottom ? "Show less of the text" : `⌄ ${below} more line${below === 1 ? "" : "s"}`}
        </button>
      )}
      {variant === "C" && openTop && (
        <button
          type="button"
          className="note-page-more"
          onClick={() => {
            hold();
            setOpenTop(false);
          }}
        >
          Hide the lines before it
        </button>
      )}
    </div>
  );
}
