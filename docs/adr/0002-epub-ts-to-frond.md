# 從 @likecoin/epub-ts 遷到 @yurenju/frond

日期：2026-07-30 改寫，前一版沒有記日期。前一版〈用 epub.ts 取代 epub.js〉的決定是換一手同 API 的
TypeScript fork 止血。

離開 epub.js 的原因是一個修不好的位置 bug：`display(cfi)` 對得到正確的 section，卻把畫面定位到那個
section 的第 0 欄，欄位偏移沒被套上，那是 epub.js 多欄分頁的老問題，而它已經沒有人在維護。中間先
換過一手同 API 的 TypeScript fork（`@likecoin/epub-ts`）止血，沒有解掉，所以才有這一份。

## 決定

reader 的渲染層改用 [`@yurenju/frond`](https://github.com/yurenju/frond)（釘死 `0.4.3`）。

frond 是為了這件事寫的：它的 ADR-0002〈frond owns facts, spine owns policy〉整篇的依據，就是
spine 在 epub.js 上長出來的那半個 `src/lib/`，每一個補丁都指向同一件事，責任該在 library 那邊
卻漏到了應用層。所以這次遷移的主體不是寫新東西，是**刪補丁**。

## 刪掉了什麼

| 檔案 | 為什麼可以走 |
| --- | --- |
| `vertical.ts` | `detectVerticalBook` 掃全部 CSS 檔配一條 regex 猜直排。frond 用 CSSOM 判定每個 section 實際排出來的方向，由 `load` 事件給 |
| `vertical-layout.ts` | `verticalColumnCss`（直排 column-width 要等於一個 viewer 高）、`zeroBodyPadding`（用 MutationObserver 對抗 epub.js 每次 relayout 塞回的 inline `!important` padding）都是 library 自己造成的傷 |
| `scrubber-epub.ts` | `locations.cfiFromPercentage`／`EpubCFI.spinePos` 的 reach-through 換成 `locate()` 與 `goToFraction()` |
| `align.ts`、`navigator-port.ts` | port 存在的唯一理由是 epub.js 的 API 形狀不能直接用。frond 自己就是那個 port |
| `toc.ts` 的 `resolveSpineHref` | TOC href 把逗號 percent-encode、epub.js 的 spine 查不到而靜靜 no-op。frond 在解析層就按 URL 規則解好 |
| `export.ts` 的自寫 `compareCfi` | 用 regex 抓數字比大小，忽略 step assertion。frond 匯出真的 `compareCfi` |
| `Reader.tsx` 的整數 px mount + 手動 `dispatchEvent('resize')` | frond 自己觀察 container，並且把整數幾何列為它的介入之一 |
| `Reader.tsx` 的 in-content link 攔截 | `linkactivate` 事件直接給 sectionIndex 與 fragment |
| `viewer-wrap` 的方向相關 padding | `margin: { block, inline }` 由 frond 依 writing mode 解析軸 |

淨值：`src/lib/` 少了 5 個檔案，`Reader.tsx` 從 855 行降到約 610 行，而且裡面再也沒有
`as unknown as` 穿透私有 API。

## 加了什麼

**highlight overlay（`lib/highlights.ts` + `components/HighlightLayer.tsx`）。** frond 不畫
highlight，這是它的決定而不是缺口：顏色、透明度、深色模式怎麼混色、點一下要不要開筆記，全是產品
決策。它給的是 `rectsFor(cfi)`（container 座標的真實幾何）與 `layout` 事件（那些座標何時失效）。
於是這一層要自己做三件事：把界外的矩形裁掉（不在當前頁的位置會回傳超出 container 的真座標）、在
`layout` 與 `relocate` 時重算、以及用 frond 的 `pointerup` 對已畫出的 box 做 hit test，overlay
本身 `pointer-events: none`，否則它會吃掉翻頁的點擊。

## 順手修掉的 bug

舊 repo 的 #29：refresh 之後位置飄回
section 開頭。根因是 React effect ordering：先 `display(saved.cfi)` 還原，才套字級／spread／
content CSS，那次 relayout 把還原的位置沖掉。`Renderer.attach()` 同時收下 `settings` 與
`start: { cfi }`，載入時只有一次確定性的 layout，之後不再 relayout；settings effect 用
`appliedRef` 比對，掛載時不重跑。

`tests/browser/reader/paging.spec.ts` 有兩項守著它（一般字級、放大的字級各一），因為當初的失敗率
與字級有關。（那時放大的那項填的是 30px；ADR-0006 換掉單位之後是 190%。）

## 代價與已知缺口

- **舊的 CFI 資料作廢。** frond 與 epub.js 的 CFI 都是規格 CFI，但沒有做過相容驗證，而使用者資料
  本來就要丟（spine 還沒開放給其他人用）。這是選這個時機遷的理由之一。
- **直排＋「書籍預設」字型在 Windows 上的標點**，原本靠 `rewriteGenericFonts` 改寫書的樣式表。那條
  路在 frond 底下不存在（iframe 內的 cascade 只有它進得去），所以改用 frond 0.4.3 新增的
  `settings.genericFamilies`：由 spine 提供字型堆疊，frond 在書的 cascade 裡代換 bare
  `serif`/`sans-serif`。這一項是這次遷移逼出來的 frond 功能（frond#64）。
- **手機長按選字的頁面漂移**未驗證。epub.js 上要靠 `alignToPage()` 擋，frond 的幾何不同（iframe 只
  有一個 viewport 大）可能不會重現，但沒有在真機上試過，也沒有辦法在容器裡試，記在 frond#66。
- **WebKit 存不進 Blob**，所以容器裡的 WebKit 跑不了任何需要匯入書的測試，見
  `tests/browser/reader/storage.spec.ts`。與這次遷移無關（三個 byte 的 Blob 就失敗），但可能是真實
  iOS Safari 的曝險，記在 舊 repo 的 #23。
- **直排本文在草枕那本書上有字符相撞**（登り／働け／立つ 各自畫在同一格），Chromium 與 Firefox 皆有，
  根因未定。frond 已排除（同一段在它的 harness 裡乾淨），而 frond 那本刻意做健康的直排 fixture 在 spine
  裡 32px 全乾淨，所以是那本書的 markup，不是直排渲染本身。記在
  舊 repo 的 #25。

## 為什麼不是 foliate-js

`docs/research/epub-rendering-libraries.md` 的中期首選是 foliate-js，prototype 也實測它直排零
patch。它輸在三件事：官方明說 API 不穩定且無官方 npm、themes／annotations 等高階能力要自己重寫、
Firefox 直排已知有問題。frond 三家等價測試（同一份程式碼在 675 個瀏覽器測試裡跑過 Chromium、
Firefox、WebKit），而且 API 是照 spine 的需求長的。
