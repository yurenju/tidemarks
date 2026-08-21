# Design system

怎麼分，加上值。**為什麼**長這樣在 [ADR-0022](adr/0022-the-interface-is-a-print-shop.md)，
**值本身**的正本在 [`packages/app/src/index.css`](../packages/app/src/index.css) 的 `:root`
（這份文件會過期，那個檔案不會）。詞的定義在 [CONTEXT.md](../CONTEXT.md)。

視覺方向叫 **Indigo Dye**，2026-08-22 換上。它取代的那一套（紙、墨、葉綠）的縮減脈絡留在
ADR-0022 裡。**handoff 不是逐值照抄的**，偏離的地方在下面各節標出來，理由都在 ADR-0022。

同一個畫面在不同寬度、不同指標型別底下長什麼樣**不在這裡**，在
[docs/specs/device-sizing/spec.md](specs/device-sizing/spec.md)。

要畫一個新畫面的時候，這份文件從〈怎麼判斷〉開始讀就好。

## 怎麼判斷

三個材質，照順序問：

1. **這是紙、墨、還是潮？**紙是容器（讀者改不動），墨是讀者留下的痕跡（螢光與筆記），潮是可以動的。
2. **它是哪一種東西？**紙 6px、控件 3px、軌道 999px、圓點 50%。半徑不是「看起來該多圓」。
3. **它浮起來還是凹進去？**浮的用 `--surface-raised`，凹的用 `--surface-sunken`。**沒有影子。**

一屏上潮色的地方應該數得出來。超過三處，就有東西該退成墨或紙。**數的單位是控制項，不是格子**：
一組 segmented 的選中格跟它的控制項一起算一處。

## Token

三層：原色 → 語意 → 元件。**元件只引用語意層**，直接寫 `--paper-300` 的規則等於已經決定了一個
顏色要用來做什麼，卻沒說出來。

### 紙

三階表面加三階線。**階數就是「浮起來」的說法**，因為這套系統沒有投影。

| token | 亮 | 暗 | 用在 |
| --- | --- | --- | --- |
| `--surface-raised` | `#fbf7ed` | `#1b2733` | 浮起來的：卡、彈窗、抽屜、閱讀器的三條 bar |
| `--surface-page` | `#f4eee2` | `#16202b` | 書頁、底、按鈕與欄位的底 |
| `--surface-sunken` | `#ede5d6` | `#101a24` | 凹進去的：面板、hover、唯讀進度條的軌 |
| `--surface-cover` | `#ede5d6` | `#101a24` | 沒有封面圖時的底（見〈封面〉） |
| `--line-hair` | `#e4ddce` | `#223040` | 結構線：bar 的邊、小標的下緣 |
| `--line-firm` | `#d9d1be` | `#27343f` | 控制項的邊：欄位、封面 |
| `--line-actionable` | `#c6c1b4` | `#35424e` | **單獨站著**的可按邊（見下） |
| `--line-track` | `#c6c1b4` | `#35424e` | Scrubber 的軌 |
| `--fill-selected` | `#c7d3e0` | `#2c3f55` | hover 與選取的填色 |
| `--backdrop` | 55% | 65% | 浮層底下那層 |

「單獨站著」是關鍵——`.ghost` 從來不單獨站著，它永遠在一個已經有邊界的容器裡（bar、面板的頭、
確認框），容器本身就答完了「這裡可以按」。給它加邊的代價是確認框的取消鍵會變得跟旁邊那顆
`.danger` 一樣重，而那一格是刻意讓「不做」比「做」輕的。

**需要第四階表面的時候要真的加一階。** 讓兩階共用同一個值就是 Indigo Dye 自己記的第一條 known
debt（亮色的 `bg-sunken` 與 `bg-skeleton` 都是 `#ede5d6`）。既然階數要擔「哪一層在上面」的責任，
那不是可以留著的。

### 墨

⚠️ **「墨」這個材質名專指讀者留下的東西**（見〈螢光〉）。正文的四階濃度是另一件事，規則沒變：

| token | 亮 | 暗 | 對紙的對比（亮） | 用在 |
| --- | --- | --- | --- | --- |
| `--text-primary` | `#14171c` | `#f2f1e9` | 15.5:1 | 標題、按鈕的字、書名 |
| `--text-body` | `#232833` | `#e4e9ec` | 12.8:1 | 內文（`body` 的預設） |
| `--text-muted` | `#585d64` | `#a3aeb6` | 5.7:1 | 次要文字、小標、唯讀進度條 |
| `--text-faint` | `#9aa1ac` | `#6e7c88` | 2.25:1 | **不是文字色**：線、disabled 的圖示、佔位 |

`--text-faint` 是 handoff 的 `decor-faint`，它自己就限制成非文字用途（known debt 第 3 條）。
唯一的例外是 `::placeholder`——佔位符是「還沒有的東西的標籤」，本來就不該讀起來像正文。

### 潮與兩個訊號色

| token | 亮 | 暗 | 對紙的對比（亮） |
| --- | --- | --- | --- |
| `--tide` | `#2e4a75` | `#7ea6ce` | 7.7:1 |
| `--tide-pressed` | `#24395c` | `#9fbfe0` | 10.0:1 |
| `--text-on-tide` | `#f4eee2` | `#16202b` | — |
| `--blue-static` | `#6e88a6` | `#4f6e92` | 3.2:1 |
| `--danger` | `#a8552f` | `#d08a62` | 4.5:1 |

**三個偏離 handoff 的地方，都在 ADR-0022 有理由：**

1. `--tide` 是 handoff 的 `blue-interactive`。主按鈕與書封原本被指定成 `blue-mark`，退到這裡，
   好讓 `blue-mark` 只代表讀者留下的東西。
2. `--tide-pressed` 是新調的值。handoff 把 pressed 指定成 `blue-static`，而紙色字在那個底上是
   2.7:1，讀不出來。
3. `--blue-static` 亮色從 `#7a93ae` 調深到 `#6e88a6`：原值對紙 2.7:1，過不了非文字圖形的 3:1。

`--tide` 與 `--mark-indigo`（`#1b2e4d`）互相只有 1.5:1，**兩個藍靠形狀分不靠顏色分**：一個是字底下
2px 的波浪線，一個是實心的按鈕。這是這套色票裡最貼近的一組，如果之後有人反映分不出來，要動的是
`--tide` 而不是 `--mark-indigo`——品牌記號色是那一個。

**沒有綠色。**「已同步／成功」用 `--tide`。（螢光的苔綠是書上的顏色，不是介面的，見〈螢光〉。）

### 圓角

| token | 值 | 給誰 |
| --- | --- | --- |
| `--radius-surface` | 6px | 卡、彈窗、閱讀區、封面、骨架 bar |
| `--radius-control` | 3px | 按鈕、欄位、標籤 |
| `--radius-track` | 999px | 開關與進度條的軌 |
| `--radius-dot` | 50% | 圓點 |

第五種半徑要先回來改這份文件。**50% 那一階綁著一句話：手指會捏住它**（Scrubber 的 thumb 與端點、
螢光色票）。

### 陰影

**沒有。** 一個都沒有。「浮起來」由表面階數說（ADR-0022〈影子換成階數〉）。唯一的 `box-shadow` 是
focus 環，見〈focus〉。

### 字

四個家族，各有職責，越界即為錯：

| token | 家族 | 只用在 |
| --- | --- | --- |
| `--font-ui` | Source Serif 4 ＋ 平台的宋體堆疊 | 所有內容與標題，`body` 的預設 |
| `--font-display` | Spectral ＋ `--font-ui` | **只有字標**「Tidemarks」 |
| `--font-control` | 平台的黑體堆疊 | 按鈕與 meta |
| `--font-mono` | IBM Plex Mono ＋ `ui-monospace` | 只有 uppercase 微型標籤與系統狀態 |

**拉丁那半自帶，漢字那半名平台堆疊**（ADR-0014、ADR-0022〈四個家族，兩種待遇〉）。自帶的有三支
拉丁：Source Serif 4（variable，latin 與 latin-ext 兩個 subset 共 90 KB）、Spectral 400、
IBM Plex Mono 400。**漢字沒有自帶的介面字**——`NotoSerifCJKtc-Regular` 是 16 MB、
`NotoSansCJKtc-Regular` 是 11 MB，那兩支照 ADR-0014 是讀者開了有漢字的書才下載。

`--font-display` 與 `--font-mono` 的堆疊尾端都退回 `--font-ui`／`ui-monospace`，因為 Spectral 與
IBM Plex Mono 都沒有漢字：字標是西文所以拿得到 Spectral，微型標籤是 uppercase 拉丁所以拿得到 mono，
中文落到後面那一支，這是刻意的。

讀者如果為了看書下載過自帶明體，**下一次開 app** 的時候介面也會用它（`lib/ui-font.ts`）。不在下載
完成的當下換，因為讀者那一刻正盯著那個面板。

**一律 `rem`，不是 px。** `settings.ts` 的字級是讀者根字級的百分比（ADR-0006），所以讀者放大瀏覽器
字級的時候書會跟著長，而介面只有寫成 rem 才會跟著長。寫 px 的結果是書變大、介面顯得更小。
**Indigo Dye 的字級表是 px 的，沒有採用**——採用的是它的層級結構與行高白名單。

手機那一欄不是「小螢幕所以放大」，是**襯線漢字的量法**：漢字沒有 x-height、字身塞滿，宋體的橫筆
在 DPR 3 上靠灰階抗鋸齒會發灰。看的是字面方框，不是幾 px。切換條件是 `pointer: coarse`（主要指標
是不是手指），不是寬度，理由見 [ADR-0023](adr/0023-width-places-things-pointer-sizes-them.md)。

| token | fine | coarse | 家族 | 用在 |
| --- | --- | --- | --- | --- |
| `--type-display` | 2rem | 同左 | display | 字標 |
| `--type-title` | 1.375rem | 同左 | ui | 大書的書名（另有 `clamp`） |
| `--type-lede` | 1.125rem | 1.1875rem | ui | 抽屜標題、確認框標題、〈帳號〉第一句 |
| `--type-body` | 1rem | 1.0625rem | ui | 內文、目錄項、引用 |
| `--type-ui` | 0.9375rem | 1rem | ui | bar 上的字、label、清單 |
| `--type-note` | 0.875rem | 0.9375rem | ui | 狀態行、註解 |
| `--type-eyebrow` | 0.75rem | 0.8125rem | mono | 小標（`letter-spacing` `.18em`、uppercase） |

**小於 1rem 的漢字不用 400 以下的字重，也不用 `--text-faint`。** 需要更淡就換更短的句子。這條擋掉了
Indigo Dye 的 15px/300 內文：300 字重的宋體在高 DPI 手機上會發灰。

行高只有兩個，兩個都在 handoff 的白名單（1.0 / 1.4 / 1.5 / 1.8 / 2.0）裡：`--leading-text` **1.8**
（任何由句子組成的東西）與 `--leading-title` **1.4**。中文需要鬆的那個。所有會變動的數字吃
`font-variant-numeric: tabular-nums`（寫在 `body`）。

微型標籤是全站唯一的 mono，一律 uppercase、`letter-spacing: .18em`。

### 間距

`--space-1` 4 ／ `-2` 8 ／ `-3` 12 ／ `-4` 16 ／ `-5` 22 ／ `-6` 30 ／ `-7` 44。

**這一階沒有跟著換。** Indigo Dye 給的是 6·12·16·28·40·56，那組數字是從它自己那幾張稿子的版面
量出來的，而這個 app 的版面不是那幾張。換掉等於在沒有理由的情況下重排每一個畫面，而
`hand-held.spec.ts` 斷言的幾何全部要重驗。採用的是它指名的**固定組合**：按鈕一律 `8px 16px`、
內卡與列 `12px 16px`。

`index.css` 裡還有一批 rem 寫的 padding 沒有換過來，**那是刻意的**：rem 跟著讀者的根字級走，
px 不會，整批換掉是在改一件無障礙行為，不是在整理格式。新寫的規則用 token。

## 元件的規則

### 按鈕：三階加一個紅

| | 長什麼樣 | 用在 |
| --- | --- | --- |
| `button`（裸的） | `--line-actionable` 的邊、紙底、3px 圓角 | 預設，其餘全部 |
| `.primary` | 實心 `--tide`、字 `--text-on-tide` | **一屏最多一顆** |
| `.ghost` | 沒有邊、沒有底 | 只在 bar 裡、關閉鈕（`✕`）、單一字元的鈕，以及確認框裡的取消鍵 |
| `.settings-tab` | 沒有邊、沒有底，開著的那一個在字底下畫一條 `--tide` 的線 | 只有〈設定〉那一排 tab |
| `.danger` | 邊與字是 `--danger`，hover 才填滿 | 刪除 |

按鈕的字是 `--font-control`。padding 一律 `8px 16px`，高度由 `--tap-min` 決定。

hover 是 `--fill-selected` 加 `--tide` 的邊；pressed 是實心 `--tide-pressed`。

確認框的取消鍵是 ghost，而且放左邊：那一格要讓「不做」比「做」更容易走到，而一個有框的取消鍵跟旁邊的
破壞性動作看起來一樣重。

命中區看的是**有沒有一根粗指標**（`any-pointer: coarse`），不是視窗多寬：有的話 `--tap-min` 是
44px，沒有的話 32px（密集列表 28px）。觸控筆電因此拿到 44px，而桌機拿到更密的排版。理由見
[ADR-0023](adr/0023-width-places-things-pointer-sizes-them.md)。**Indigo Dye 說「一律 44px」，沒有
採用**：它只是沒想到桌機，而桌機的 `.chrome-nav` 四個入口在 44px 之下會把書擠掉一行。

**唯一的例外是封面右上的 `⋯`**：它必須貼齊封面的角，44px 的方塊在手機上會蓋掉封面四分之一。解法
是**臉 26px、靶 44px**——`::after` 把可按範圍往左下撐開，蓋在封面的圖上但不畫任何東西。

### 欄位

圓角 3px、`min-height: var(--tap-min)`、紙底、`--line-actionable` 的邊。`type="range"` 不進這個框
——滑桿沒有內部可以填，框住它等於在一條線外面再畫一個框。

錯誤只換邊框與 label 的顏色，不換底色。`.error` 是左邊一條 3px 的 `--danger` 加 `--surface-sunken`
的底，不是紅底粉框。

### segmented

**選項少又短的設定，就把選項全攤在畫面上**，不要藏進 `<select>` 裡點開才看得到。線畫在**選項數與
標籤長度**上，不畫在元件庫上：三到四個、每個一兩個字就用 segmented（主題、欄數、字型、留白）；
〈行距〉六個而且長得像「更寬鬆（2.0）」，攤不開，留 `<select>`。

- 一組共用一個外框，格與格之間一條 hairline（相鄰的邊互相收掉一個 pixel）。圓角只在整組的兩端。
- **選中＝實心 `--tide`**，不是底線。填滿禁得起被瞄一眼，也禁得起深色主題。
- **整組 disabled 的時候選中格不上潮色**，改用 `--surface-sunken` 加 `--text-muted`。潮是「可以動」
  的顏色，一格按不下去的潮色正是那條規則要擋的東西。
- 一組只有一個 tab stop（落在選中的那格），方向鍵換選項並帶著 focus 走。

### focus

一般控制項：`outline: 2px solid var(--tide)` + `outline-offset: 1px`，外面再加一圈
`box-shadow: 0 0 0 3px var(--halo, var(--surface-page))` 當暈。

**那圈暈是一個洞，不是一個顏色**：它靠的是跟背後那張紙同色，所以焦點讀起來是一圈環，不是控制項
外面又多一個形狀。所以**背後不是書頁的那張紙要自己報名**，在自己身上設 `--halo`。

**封面例外**：底色是出版社說了算，深色書封上看不見框。所以焦點畫在封面**之外**的紙上——四個角的
L 形**裁切標記**，16px 長、2px 粗、離封面 7px（落在格線的 gap 裡，不會碰到鄰居）。實作是 `::before`
加八道 `linear-gradient`，不是八個 span：那是裝飾，不該進 accessibility tree。

### 封面

**有封面圖就用封面圖。** 讀者匯入的書長什麼樣是出版社決定的，不是 app
（[ADR-0013](adr/0013-your-copy-is-yours.md)）。Indigo Dye 的書櫃是為一個沒有封面圖的書架設計的，
那不是這個書架。

沒有圖的才用 `--surface-cover` 加書名。書名用 `--text-primary`，不是紙色——handoff 指定的「四階藍
為底、紙色字」在最淺的兩階上是 2.7:1，讀不出來。

### 能拖與不能拖

同一個面板裡會同時出現字型下載進度與閱讀進度軸，**必須一眼分得開**。

| | 可拖曳（Scrubber） | 唯讀（進度條） |
| --- | --- | --- |
| 顏色 | `--tide` | `--text-muted`，**永遠不用潮色** |
| 高度 | 觸控區 22px；rail 靜止 3px／hover 6px，coarse 永遠 6px | 固定 3px |
| 端點 | 起點實心、終點空心 | 無 |
| thumb | 14px 圓點 hover 出現；coarse 永遠在，22px | 無 |
| 互動 | `cursor: pointer`、可聚焦、方向鍵可動 | `pointer-events: none` |
| a11y | `role="slider"` | `role="progressbar"` |

軌道與進度條的圓角是 `--radius-track`。唯讀進度條**不佔自己一列**，緊貼在它所解釋的那行字下面。

守門的測試在 `packages/app/tests/browser/reader/draggable.spec.ts`。

### busy

一律 `--text-muted`，不用潮色：潮代表「你可以動它」，而下載中的按鈕正是不能動的。

- `.busy-underline`：一條 2px 的線在按鈕文字底下左右掃過（1.5s）。給〈排版〉，因為它正在做的事
  就是重排字。包住 label 不是包住按鈕，這樣線的寬度是字的寬度。
- `.busy-edge`：底緣一條 3px 的線，40% 寬來回走（1.6s）。**其餘按鈕的預設**。
- `prefers-reduced-motion` 之下兩者都停，改成靜止的淡墨線。狀態還在，只是不動。

### 螢光

品牌記號是**波浪底線**——潮水退去留下的痕跡。四個墨水色，`Annotation.color` 存的是**色名不是色值**：

| 名字 | 亮 | 暗 | 對紙的對比（亮） |
| --- | --- | --- | --- |
| `indigo` 蓼藍（預設） | `#1b2e4d` | `#a9c4de` | 11.8:1 |
| `ochre` 赭石 | `#a4622f` | `#cf8b4e` | 4.2:1 |
| `moss` 苔綠 | `#5f7a4e` | `#8aab72` | 4.2:1 |
| `soot` 松煙 | `#3d4348` | `#9aa4ab` | 9.7:1 |

**預設的蓼藍就是品牌記號色。** 它跟 handoff 的 `blue-mark` 同值，這是刻意的：讀者不改設定的時候，
他畫的線就是這個 app 的記號。

**苔綠是綠的，而 Indigo Dye 說「不引入綠色」——這兩件事不衝突。** 那條規則管的是**介面**的顏色
（它要擋的是「已同步／成功」用綠），四個墨水色是**書上的**顏色，屬於讀者不屬於介面。刪掉苔綠是
拿介面的規則去管讀者的筆。

形態亮暗一致：**只有一條 2px 的波浪線，沒有底色。**

- 波浪是一張 SVG 做的 `mask`，底下鋪 `var(--mark)`。**顏色從背景來、波形從 mask 來**，所以四個
  墨水色乘上亮暗兩套共用同兩張圖（橫的一張、直的一張），不是八張。
- tile 是 12×8（直排 8×12）：中心線走 2→6，`stroke-width: 2` 讓墨跡落在 1→7，兩邊各留 1px。
  **tile 開太小波形會被削平**，那是實際踩過的。
- 波浪畫在矩形**外面**，不是下緣。frond 回報的是字身框，而漢字填滿字身框、沒有下伸部，貼著下緣
  畫等於畫在筆畫上。`--wave-drop` 是 1px，語意是眼睛看到的距離（tile 自己的 1px 邊界在 CSS 裡
  減掉了）。
- **直排走右緣**，那是直排中文傍線的位置。`HighlightLayer` 從 `Reader.tsx` 拿 `verticalBook`，
  那個狀態本來就有（frond 的 `writingMode` 事件），不必動 frond。

舊的四個名字（`yellow` / `blue` / `green` / `pink`）在 `markVar()` 裡對到最近的一個新色，
**沒有 migration，也不需要**。

**已知的邊界情形**：`visibleBoxes()` 把矩形裁到容器，被裁的那個矩形底下的波浪會落在容器外、被
`.reader` 的 `overflow: hidden` 切掉。三家引擎都一樣。它只在「字本身已經被切一半」的時候成立，
而 frond 分頁不會把一行切兩半，所以正常閱讀讀不到——**沒有特別處理**，列在收尾驗證裡用真的書拖頁
確認。

### 圖示

不引圖示字型、不畫線條圖示。全站只有五個字元：`⋯`（詳情）`✕`（關閉）`‹`（回書架，桌機的上一頁鈕
也是它，下一頁是鏡射的 `›`）`⌄`（排序，目前由原生 `<select>` 自己畫），加上螢光色票的圓。每個都在
44×44 的方框裡、無底色。

**要第六個圖示之前，先問這件事能不能用兩個字說完**——bar 上的「目錄／筆記／排版」就是那個答案。

## 文案

大書區固定**兩行**：第一行位置、第二行時間感。算不出來就換一句成立的話，**不留空行**。四種說法
與門檻在 [docs/specs/ux-replan/spec.md](specs/ux-replan/spec.md) 與 `lib/book-status.ts`。

空狀態是一句名詞加一句怎麼開始（「還沒有書 / 把 epub 放進來，就從這裡開始。」），沒有插圖也沒有
按鈕——拖放本身就是入口。

錯誤說「發生什麼事＋怎麼辦」，不說錯誤碼。**先說「你的資料沒事」，再說要做什麼**（Indigo Dye 的
錯誤文案原則）。離線不是錯誤，是預設狀態。

## 界線：我們管容器，不管內容

design system 管〈排版〉這個 sheet 的樣式、控制項與文案；sheet 裡的那些數字（字級、
行高、每行字數）歸 spec 與 `settings.ts` / `line-length.ts`。那是可讀性工程，不是視覺風格。

由此四條：

1. **預設不是下載字。**`DEFAULT_SETTINGS.fontFamily` 維持系統字堆疊。書要能在打開的那一秒就讀。
   品牌一致由介面的襯線負責，不是由書負責。
2. **只補，不覆寫。**書只宣告了 `font-family: serif` 這種沒指名字面的情況才補上具體字族；書指名
   了就尊重它。唯一例外是書用絕對值寫的 `font-size`，一律轉成相對值——那會擋住讀者放大，屬於
   無障礙。
3. **可選字體最多三個。**每多一個 face 就是一次十幾 MB 的下載。用讀者的語言命名（「宋體／黑體」），
   選項上寫出下載大小。
4. **字級、行高、每行字數的預設值不寫進這裡**，留在 `settings.ts` 與 `line-length.ts`。
