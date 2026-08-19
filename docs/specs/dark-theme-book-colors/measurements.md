# 量到的數字

2026-08-14。這一份記的是 34 本流通中的商業書裡，`color` 宣告長什麼樣子。
[spec.md](spec.md) 寫規則，這裡寫數字與怎麼重驗。

書由 `FROND_BOOKS` 唯讀掛進來，**書名與內文一個字都不記在這裡**（frond
[ADR-0007](../../../packages/frond/docs/adr/0007-test-fixtures.md)：有版權的書不進 repo，也不進
任何跟著 repo 走的檔案）。34 本全部是繁體或簡體中文的非虛構與小說，跟 frond 那份 34 本的樣本是
同一批書，所以它的偏差也一樣：固定版面書、童書、教科書都不在裡面。

量的對象是每本書的 `.css` 檔、`<style>` 區塊與 `style` 屬性裡的 `color` 宣告（`background-color`
之類不算）。對比是 WCAG contrast ratio，背景取 Folis 深色主題的 `#1b1b1e`
（`packages/app/src/lib/settings.ts` 的 `DARK_THEME`）。「沒有色相」的定義跟實作同一條：
`(max - min) / 255 < 0.15`。

## 33/34 本在宣告顏色

共 951 次宣告、213 個不同的值。唯一沒宣告的那一本，內文顏色完全交給瀏覽器預設。

## 分佈

| 對比 | 沒有色相 | 有色相 |
| --- | --- | --- |
| 2 以下 | 362 | 152 |
| 2 到 3 | 51 | 24 |
| 3 到 4.5 | 35 | 84 |
| 4.5 到 7 | 30 | 55 |
| 7 以上 | 53 | 52 |
| frond 讀不懂的值 | 53 | |

門檻訂 3 還是 4.5，差的是「3 到 4.5」那一列的 119 次。它不是空的，所以這個數字要用量的，不能用猜的。

讀不懂的 53 次剛好分成三種：`var(--…)` 35 次（其中 30 次來自同一本書，它把整套顏色定義成自訂
屬性）、`transparent` 10 次、`inherit` 8 次。

## 中性色照亮度排開，中間有一個空隙

亮度是 HSL 的 L。這張表只列空隙前後那一段，兩端各截斷：

| 值 | 次數 | 亮度 | 對比 |
| --- | --- | --- | --- |
| `#000` / `#000000` / `black` | 319 | 0.000 | 1.22 |
| `#333` / `#333333` | 30 | 0.200 | 1.36 |
| `#3f312b` | 1 | 0.208 | 1.38 |
| `#373c38` | 1 | 0.225 | 1.53 |
| **（空隙）** | | | |
| `#474a4d` | 1 | 0.290 | 1.93 |
| `#4c4c4c` | 14 | 0.298 | 2.00 |
| `#565656` | 13 | 0.337 | 2.34 |
| `#696969` | 23 | 0.412 | 3.13 |
| `#808080` / `gray` | 11 | 0.502 | 4.35 |
| `#888888` | 1 | 0.533 | 4.85 |

亮度 0.225 到 0.290 之間**一個值都沒有**，而空隙兩邊是兩件不同的事：左邊 361 次全部是書拿來當內文
墨色的黑，右邊是書刻意調淡一階的灰（圖說、註解、頁碼）。實作把「近黑」的界線放在 0.25，就是放在
這個空隙的中間，所以樣本裡沒有任何一個值貼著界線。

## 這次的規則會怎麼分

| 結果 | 次數 |
| --- | --- |
| 原樣留著（對比已經 ≥ 4.5） | 190 |
| 換成讀者的墨色（近黑） | 361 |
| 保留色相、提亮到剛好過門檻 | 260 |
| 保留是灰的、提亮到剛好過門檻 | 87 |
| 留著不動（frond 讀不懂那個值） | 53 |

改之前這 951 次**全部**變成讀者的墨色。改之後有 190 次原封不動、347 次保留了它跟內文的差別，
只有 361 次被換掉，而那 361 次是書的內文墨色，本來就是讀者主題該接手的東西。

## 怎麼重驗

腳本不進 repo（一次性的量測工具，跟 frond `scripts/scan-books.sh` 的 evidence spec 同一個道理），
但它短到可以整支寫在這裡。它 import frond 自己的顏色運算，所以規則改了、數字就跟著改：

```js
// scan-colors.mjs，放哪裡都可以，node scan-colors.mjs <書的目錄>
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  colorTheme,
  contrastRatio,
  parseColor,
} from "./packages/frond/src/renderer/color.ts";

const theme = colorTheme("#d8d5cf", "#1b1b1e");
const books = process.argv[2];
const counts = new Map();

for (const file of readdirSync(books).filter((name) => name.endsWith(".epub"))) {
  const dir = mkdtempSync(join(tmpdir(), "scan-"));
  execFileSync("unzip", ["-o", "-q", join(books, file), "-d", dir]);
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(css|x?html?|xml)$/i.test(entry.name)) {
        const text = readFileSync(path, "utf8");
        for (const found of text.matchAll(/(^|[;{"'\s])color\s*:\s*([^;}"']+)/gi)) {
          const value = found[2].trim();
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
      }
    }
  };
  walk(dir);
  rmSync(dir, { recursive: true, force: true });
}

const rows = [...counts].map(([value, n]) => {
  const parsed = parseColor(value);
  return {
    value,
    n,
    contrast: parsed === undefined ? undefined : contrastRatio(parsed, theme.background),
  };
});
rows.sort((a, b) => (a.contrast ?? 99) - (b.contrast ?? 99));
for (const row of rows) console.log(row.value, row.n, row.contrast?.toFixed(2) ?? "?");
```

`color.ts` 的 `parseColor` 認得的比這一支多（`rgb()`、`hsl()`、148 個具名顏色），所以同一批書用它
量出來的「讀不懂」比用手寫的正規表示式少。上面那個 53 就是用它量的。
