/**
 * PROTOTYPE — throwaway. Issue #110: mark the kept progress on the Scrubber during a visit.
 *
 * Four variants of the mark on the real reader, switchable with `?visitmark=A|B|C|D`.
 * The mark is faked: any `?visitmark=` value shows it, no real visit needed. Position comes
 * from `?markat=` (default 0.47, the percentage the issue tells its story with).
 *
 * Everything lives in this one file — styles included, which the repo would normally put in
 * styles/ — so the whole prototype is one delete away.
 */
import { useEffect, useState } from "react";

const VARIANTS = ["A", "B", "C", "D"] as const;
type Variant = (typeof VARIANTS)[number];

const NAMES: Record<Variant, string> = {
  A: "刻度線（不可點）",
  B: "空心圓點（可點）",
  C: "回程區段＋箭頭",
  D: "浮動膠囊",
};

const cycle = (v: Variant, step: number): Variant =>
  VARIANTS[(VARIANTS.indexOf(v) + step + VARIANTS.length) % VARIANTS.length]!;

function readParam(): { variant: Variant | null; markAt: number } {
  const p = new URLSearchParams(window.location.search);
  const v = (p.get("visitmark") ?? "").toUpperCase();
  return {
    variant: (VARIANTS as readonly string[]).includes(v) ? (v as Variant) : null,
    markAt: Number(p.get("markat") ?? 0.47),
  };
}

interface Props {
  railPos: (f: number) => string;
  railSpan: (w: number) => string;
  fraction: number; // where the reader is now
  rtl: boolean;
  onJump: (f: number) => void;
}

export default function ScrubberVisitMarkPrototype({
  railPos,
  railSpan,
  fraction,
  rtl,
  onJump,
}: Props) {
  const [{ variant, markAt }, setState] = useState(readParam);

  // `[` / `]` cycle. Not the arrow keys: the reader turns pages with those.
  useEffect(() => {
    if (variant === null) return;
    const onKey = (e: KeyboardEvent) => {
      const step = e.key === "]" ? 1 : e.key === "[" ? -1 : 0;
      if (!step) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      go(cycle(variant, step));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function go(next: Variant) {
    const p = new URLSearchParams(window.location.search);
    p.set("visitmark", next);
    history.replaceState(null, "", `?${p}${window.location.hash}`);
    setState(readParam());
  }

  if (!import.meta.env.DEV || variant === null) return null;

  const jump = () => onJump(markAt);
  const pct = Math.round(markAt * 100);
  // The stretch between here and the kept progress, in rail coordinates.
  const lo = Math.min(fraction, markAt);
  const hi = Math.max(fraction, markAt);
  // Which way the arrow points on screen, after the rtl mirror.
  const forward = markAt > fraction;
  const arrow = forward !== rtl ? "→" : "←";

  return (
    <>
      <style>{CSS}</style>

      {variant === "A" && <div className="pt-tick" style={{ left: railPos(markAt) }} />}

      {variant === "B" && (
        <button
          className="pt-ghost"
          style={{ left: railPos(markAt) }}
          onClick={jump}
          aria-label={`Back to ${pct}%`}
        />
      )}

      {variant === "C" && (
        <>
          <div className="pt-span" style={{ left: railPos(lo), width: railSpan(hi - lo) }} />
          <button
            className="pt-arrow"
            style={{ left: railPos(markAt) }}
            onClick={jump}
            aria-label={`Back to ${pct}%`}
          >
            {arrow}
          </button>
        </>
      )}

      {variant === "D" && (
        <>
          <div className="pt-tick" style={{ left: railPos(markAt) }} />
          <button className="pt-pill" style={{ left: railPos(markAt) }} onClick={jump}>
            ↩ {pct}%
          </button>
        </>
      )}

      <div className="pt-bar">
        <button onClick={() => go(cycle(variant, -1))}>←</button>
        <span>
          {variant} — {NAMES[variant]}
        </span>
        <button onClick={() => go(cycle(variant, 1))}>→</button>
        <em>[ ]</em>
      </div>
    </>
  );
}

const CSS = `
.pt-tick, .pt-ghost, .pt-span, .pt-arrow, .pt-pill {
  position: absolute;
  transform: translate(-50%, -50%);
  top: 50%;
}
/* A — a notch across the rail. Nothing to press, nothing to miss. */
.pt-tick {
  width: 2px;
  height: 12px;
  border-radius: 1px;
  background: var(--text-muted);
  box-shadow: 0 0 0 2px var(--surface-raised);
  pointer-events: none;
}
/* B — the thumb's twin, hollow: same shape as "you are here", so it reads as a second one. */
.pt-ghost {
  width: 14px;
  height: 14px;
  padding: 0;
  /* controls.css gives every button a 44px min-height. On the rail that is the whole bar tall,
     so the prototype opts out — and that fight is itself a finding for issue #110. */
  min-height: 0;
  border: 2px solid var(--tide);
  border-radius: var(--radius-dot);
  background: var(--surface-raised);
  cursor: pointer;
}
/* C — the stretch you stepped back over, plus an arrow at the far end pointing home. */
.pt-span {
  transform: translateY(-50%);
  height: 6px;
  border-radius: var(--radius-track);
  background: var(--tide);
  opacity: 0.28;
  pointer-events: none;
}
.pt-arrow {
  width: 20px;
  height: 20px;
  padding: 0;
  /* controls.css gives every button a 44px min-height. On the rail that is the whole bar tall,
     so the prototype opts out — and that fight is itself a finding for issue #110. */
  min-height: 0;
  border: none;
  border-radius: var(--radius-dot);
  background: var(--tide);
  color: var(--surface-page);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
/* D — says it in words, above the rail. Loudest, and the only one that costs vertical room. */
.pt-pill {
  top: -10px;
  min-height: 0;
  padding: 2px 8px;
  border: 1px solid var(--line-track);
  border-radius: 999px;
  background: var(--surface-raised);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.6;
  white-space: nowrap;
  cursor: pointer;
}
/* the switcher itself — deliberately ugly so it is never mistaken for the design */
.pt-bar {
  position: fixed;
  left: 50%;
  top: 8px; /* not the bottom: the bar would sit on top of the very mark being judged */
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 12px;
  border-radius: 999px;
  background: #111;
  color: #fff;
  font: 12px/1.6 system-ui, sans-serif;
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.4);
}
.pt-bar button {
  border: none;
  background: #333;
  color: #fff;
  border-radius: 6px;
  padding: 2px 8px;
  cursor: pointer;
}
.pt-bar em { opacity: 0.5; font-style: normal; }
`;
