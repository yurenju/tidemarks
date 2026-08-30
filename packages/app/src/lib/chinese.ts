// Common characters that differ between Simplified and Traditional Chinese,
// index-aligned pairs. Used to guess the variant when metadata only says "zh".
const SIMPLIFIED =
  "书体们对时说这为过还进无发现应学习让认识谁读语难观觉产贵购费货质资页项风飞饭饮马验门问间闻电头买卖乐经红级练统继绝纪岁归当断点会";
const TRADITIONAL =
  "書體們對時說這為過還進無發現應學習讓認識誰讀語難觀覺產貴購費貨質資頁項風飛飯飲馬驗門問間聞電頭買賣樂經紅級練統繼絕紀歲歸當斷點會";

/** null = no signal yet; callers should keep sampling later pages */
export function detectVariant(
  language: string | undefined,
  sample: string,
): "simplified" | "traditional" | null {
  const lang = (language ?? "").toLowerCase();
  if (/hans|cn|sg/.test(lang)) return "simplified";
  if (/hant|tw|hk|mo/.test(lang)) return "traditional";

  let s = 0;
  let t = 0;
  for (const ch of sample) {
    if (SIMPLIFIED.includes(ch)) s++;
    else if (TRADITIONAL.includes(ch)) t++;
  }
  if (s === t) return null;
  return s > t ? "simplified" : "traditional";
}

// Traditional-first by default; simplified books get SC fonts first so shared
// characters and simplified-only characters render from the same font.
//
// One typeface, three names, all of which have to be spelled out because CSS matches family
// names exactly and none of them finds the others (#38):
//
// - `Noto Serif CJK TC` — **the name spine's own copy registers under** (ADR-0014), and also
//   what the distro packages register, which is how CJK fonts actually get installed on
//   Linux (Debian/Ubuntu's fonts-noto-cjk, Fedora's google-noto-*-cjk-fonts). It leads every
//   stack for the first of those reasons: an `@font-face` under this name beats an installed
//   face of the same name, but it cannot beat a *different* name sitting ahead of it — a
//   reader who happens to have `Noto Serif TC` installed would otherwise get their copy, of
//   a version nobody knows, instead of ours.
// - `Noto Serif TC` — Google Fonts' subsetted release.
// - `Source Han Serif TC` — Adobe's release of the same design, under its original name.
//
// The Apple and Windows faces stay behind all three: they are the fallback for a machine
// with no Noto at all, not the preferred answer.
//
// **Every stack has to name an Apple face, and the serif ones are where that bites.** Apple
// platforms ship none of the three Noto/Source Han names, and `PMingLiU`/`SimSun` are
// Windows-only — so before `Songti` was named, the whole serif stack fell through to
// `Georgia`, which has no Han glyphs, and from there to the keyword `serif`. iOS maps that
// keyword to nothing Chinese: the characters land on the system face, PingFang, which is a
// sans. That is why picking [[Serif]] on an iPhone looked identical to [[Sans]] and to the book's own
// font — all three were PingFang. `Songti TC`/`Songti SC` are preinstalled on iOS and macOS
// alike, so naming them is what makes the choice mean anything on either.
const SANS_TC =
  "'Noto Sans CJK TC', 'Noto Sans TC', 'Source Han Sans TC', 'PingFang TC', 'Microsoft JhengHei'";
const SANS_SC =
  "'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC', 'PingFang SC', 'Microsoft YaHei'";
const SERIF_TC =
  "'Noto Serif CJK TC', 'Noto Serif TC', 'Source Han Serif TC', 'Songti TC', 'PMingLiU'";
const SERIF_SC =
  "'Noto Serif CJK SC', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'SimSun'";

// Books often declare a bare `font-family: serif/sans-serif`, which names no face at all —
// it hands the choice to the platform, and the platform's answer is regularly a bad one for
// CJK. On Windows the browser may resolve it to a face without the OpenType `vert` feature
// (Microsoft JhengHei, say), which puts vertical punctuation in the wrong place. On Linux it
// can land on WenQuanYi Zen Hei, whose Han glyphs have a vertical advance of 0 — a vertical
// book renders as a single pile of characters (#25). Naming faces ourselves is what keeps
// that delegation from reaching the platform.
//
// Rewriting the book's own stylesheet for it used to be ours (`vertical-layout.ts`'s
// `rewriteGenericFonts`), and cannot be any more: the book renders inside an iframe and
// reaching in is what that boundary exists to stop. These stacks are now handed to frond as
// `settings.genericFamilies` (see `settings.ts`'s `frondSettings`), which substitutes them
// inside the book's cascade — the same fix, made by the layer that can actually reach it.
export function fontStack(kind: "sans" | "serif", simplified: boolean): string {
  if (kind === "sans") {
    const cjk = simplified ? `${SANS_SC}, ${SANS_TC}` : `${SANS_TC}, ${SANS_SC}`;
    return `${cjk}, system-ui, sans-serif`;
  }
  const cjk = simplified ? `${SERIF_SC}, ${SERIF_TC}` : `${SERIF_TC}, ${SERIF_SC}`;
  return `${cjk}, Georgia, serif`;
}
