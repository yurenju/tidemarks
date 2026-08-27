# 收尾驗證：用 playwright-cli 實際跑一遍

engineering skill 在 spec／feature 收尾、**宣稱完成之前**，該怎麼用 playwright-cli 把功能真的跑起來
確認。

這一層原本走 Claude 的 Browser pane，2026-08-01 換成 playwright-cli，理由見
[ADR-0007](../adr/0007-pr-evidence-is-captured-on-the-host.md)。換掉之後最大的差別是**書可以直接
上傳**：以前 Browser pane 沒有檔案上傳工具，只能 fetch blob 再自己呼叫 `importEpubFile`，等於跳過
`<input type="file">` 那一段。

## 為什麼

三層，各蓋一段，不重疊：

| | 蓋什麼 | 指令 |
| --- | --- | --- |
| Vitest／Node | 決策模組的純邏輯：`navigator.ts`、`merge.ts`、`highlights.ts`、`toc.ts`、`settings.ts` 的對映 | `npm test`（node runner） |
| Vitest／workerd | worker 真的跑起來，帶真的 D1／R2／KV：OAuth 一整條、`/mcp` 沒 token 進不去、SQL 的欄位名與 bind 次序 | `npm test`（worker runner） |
| Playwright（容器裡；本地 chromium，CI 三家） | 真的開一本真的書：翻頁、方向反轉、TOC 跳轉、劃重點、拖 Scrubber、reload 後還原位置 | `npm run test:container` |
| playwright-cli（host 上） | 上面三層蓋不到的：**真人操作的 sync**、真機手勢、拿手上的實際（有版權的）書試 | 本文件 |

這一層蓋的是**使用者實際操作**，而且範圍比以前更窄——「開書、翻頁、劃重點會不會壞」有瀏覽器測試在守，
「worker 有沒有把資料寫對、有沒有把沒授權的擋掉」有 workerd 那層在守，所以這裡只剩自動化到不了的地方。收尾時 Stage 1 的 baseline 仍然要跑（那是抓「整個 app 是不是
壞了」），Stage 2 則設計成瀏覽器測試沒有覆蓋的那個操作。

開 PR 時要附的截圖與五項缺陷判讀，見 [pull-requests.md](pull-requests.md)。那份跟這份現在都跑在
host 的 playwright-cli 上，但仍然是兩件事：一個看引擎排出來的畫面，一個看一條真人會走的流程。

## 什麼時候跑

改動只要在瀏覽器裡看得出來（畫面、serve、console），收尾時就跑一遍。純 logic／type／tooling、跑不出
畫面的改動，跳過（測試已經蓋掉了）。

## 前置

新開的 worktree 若 `node_modules` 是空的，先 `npm install`（不然 vite 起不來，會報 `vite-plugin-pwa`
找不到）。

dev server 背景起著就好：

```bash
npm run dev
```

要驗 sync 才需要另外起 `wrangler dev`（5002）—— dev 下 `/auth`、`/api` 由 vite proxy 過去（見
[vite.config.ts](../../packages/app/vite.config.ts)），少了 worker 這兩條路徑會 502。**書架與閱讀不受影響**，所以
不驗 sync 就不必起它，看到那兩條 502 也不用理。

## 把一本書弄進 reader

走真人那條路——點 `Import epub`，然後上傳：

```bash
playwright-cli open --browser chromium --persistent http://localhost:5001/
playwright-cli click "getByRole('button', { name: 'Import epub' })"
playwright-cli upload "$PWD/tests/books/kusamakura-vertical-japanese.epub"
playwright-cli click "getByRole('button', { name: '草枕', exact: true })"
```

⚠️ **介面文案是英文，書名不是。** 這兩行的差別不是筆誤：`Import epub` 是 Tidemarks 自己的文案，而
英文是原文（[ADR-0031](../adr/0031-english-is-the-source-and-chinese-becomes-a-translation.md)），
所以程式碼裡寫的、畫面上出現的都是它；`草枕` 是那本 epub 自己的書名，跟介面語言無關。**用中文去選
介面上的按鈕會找不到**，而失敗的樣子很難認——見下面〈按鈕找不到的時候〉。

最後那行的 `exact: true` 不能省：書架上每本書有兩顆按鈕（封面本身，以及開詳情的 `About 草枕`），
不加就兩個都中，playwright 的 strict mode 會擋下來什麼也不點。

書從硬碟任何地方來都可以，**不必先搬進 repo**。公版書在 `tests/books/`（直排日文的草枕、橫排英文的
Alice）；手上有版權的書用你自己的路徑，那些**永遠不要 commit**。

上面這四行連同底下三個坑，[`scripts/pr-evidence.sh`](../../scripts/pr-evidence.sh) 都收好了，
`source` 進來三行就到同一個位置：

```bash
source scripts/pr-evidence.sh
pw_fresh chromium chromium
pw_import chromium "$PWD/tests/books/kusamakura-vertical-japanese.epub"
pw_open_book chromium "草枕"
```

那支檔案是為了開 PR 截圖寫的，但「把書弄進 reader」這件事兩邊是同一件，所以這裡也用它。

三件事會踩到：

- **`--persistent` 不能省。** Tidemarks 把 epub body 存成 Blob，暫時性 profile 存不進去，WebKit 上匯入會
  直接失敗（`Error preparing Blob/File data to be stored in object store`）。
- **要一個乾淨的書架就先 `playwright-cli delete-data`。** `--persistent` 的另一面是資料留到下一次。
- **等排版落定再看畫面**，不要用 `sleep` 猜：

  ```bash
  playwright-cli eval "async () => { const f = [...document.querySelectorAll('.viewer-mount iframe')].find(x => getComputedStyle(x).visibility === 'visible'); await f.contentDocument.fonts.ready }"
  ```

  那句 `find(...)` 不能省，理由見下一節。

## 按鈕找不到的時候

**第一個動作是 `playwright-cli snapshot`，不是改選擇器。** 它印的是當下畫面的 aria 樹，上面有每顆按鈕
實際的名字，所以「名字不對」跟「那顆按鈕根本不在畫面上」一眼就分得開——而這兩件事要做的處置完全相反。

三個常見的原因：

- **用中文去選介面上的按鈕。** 見上面那條：介面文案是英文。
- **`upload` 前面漏了打開檔案選擇器的 `click`。** ⚠️ **失敗的 playwright-cli 離開碼是 0**，錯誤只印
  在 stdout 的 `### Error`，所以前一行失敗不會擋住後一行，`set -e` 也攔不到。少了那個 click，
  `upload` 會安靜地什麼也不做，錯誤延到兩行以後才以
  `getByTestId('book-open') does not match any elements` 的樣子出現。那句話讀起來像「書還在匯入」，
  於是就去加 `sleep`——加多久都沒用，因為書架從頭到尾是空的。snapshot 會直接顯示 `No books yet.`。
- **在 reader 裡找〈找〉那一層的按鈕。** 它預設是收起來的，見下面那節。

⚠️ 順帶一條：**發現這份文件裡的選擇器跟程式碼對不上，就順手把這裡改掉**，跟著手上那個改動一起
commit。只改你剛好撞到的那一個，不必去掃全部。文件裡的選擇器沒有測試在守，唯一會發現它過期的人就是
下一個照著做的人——而上面〈把一本書弄進 reader〉那幾行就這樣過期過一次。

## 翻頁，以及怎麼問「畫面現在在哪」

翻頁本身一行就夠，鍵盤事件送到 reader 就會動：

```bash
playwright-cli press ArrowLeft
```

**方向跟著書走，兩本實測過**：

| 書 | 下一頁 | 上一頁 | 左邊那顆 ‹ 的名稱 |
| --- | --- | --- | --- |
| 草枕（直排 rtl） | `ArrowLeft` | `ArrowRight` | 下一頁 |
| Alice、微光集（橫排 ltr） | `ArrowRight` | `ArrowLeft` | 上一頁 |

也就是說兩顆翻頁按鈕的**位置固定、名稱對調**。手上的書是哪一種不必猜，問那兩顆按鈕：

```bash
playwright-cli --raw eval "() => [...document.querySelectorAll('.page-btn')].map(b => b.getAttribute('aria-label') + ' ' + b.textContent.trim()).join(' | ')"
```

真正會浪費時間的是**下一步**：翻完之後想確認翻到哪裡，用 `eval` 去讀 iframe，讀到的卻是舊內容，於是
以為翻頁沒生效，來回多按二十幾次。

原因是 `.viewer-mount` 底下**不只一個 iframe**，只有一個 `visibility: visible`，其餘放的是前後待用的
排版結果。草枕開在第一章時量到的是這樣：

| iframe | visibility | 內容 |
| --- | --- | --- |
| 0 | `hidden` | 目次 |
| 1 | **`visible`** | 一（山路を登りながら…） |
| 2 | `hidden` | 一（預先排好的下一份） |

`document.querySelector('.viewer-mount iframe')` 拿的是第 0 個，它停在哪一頁跟畫面沒有關係。**每次都要
自己挑 visible 的那一個**，而且 index 與數量都不能記起來重用：剛開書時是 2 個，翻幾頁後變 3 個；同一個
section 裡翻頁不換 iframe，跨 section 就換人（草枕實測 1 → 1 → 2，Alice 實測 0 → 1 → 1 → 0）。

```bash
playwright-cli press ArrowLeft && playwright-cli --raw eval "() => { const f = [...document.querySelectorAll('.viewer-mount iframe')].find(x => getComputedStyle(x).visibility === 'visible'); return f.contentDocument.body.innerText.slice(0, 40) }"
```

挑對 iframe 之後還有第二個坑：**問「這個元素在不在畫面上」不能只看 `top`**。一個 section 的內容是橫向
排成很多欄的，翻頁動的是水平位置，所以同一段話從頭到尾 `top` 都不會變，變的是 `left`。只看 `top` 會把
四頁之外的東西判成「在畫面上」。實測一段落在 `top: 346` 的字，翻回四頁才進畫面，那四頁的 `left` 依序
是 -4104、-2959、-1814、-669、476，一頁差一個 `innerWidth`（1105）。

```bash
playwright-cli --raw eval "() => { const f = [...document.querySelectorAll('.viewer-mount iframe')].find(x => getComputedStyle(x).visibility === 'visible'); const w = f.contentWindow; const e = f.contentDocument.querySelector('SELECTOR'); const r = e.getBoundingClientRect(); return r.left >= 0 && r.left < w.innerWidth && r.top >= 0 && r.top < w.innerHeight }"
```

`left` 是負的就往回翻，超過 `innerWidth` 就往前翻，`Math.round(r.left / w.innerWidth)` 就是還差幾頁。
直排書換成看 `top`，道理一樣：翻頁動的是**書行進方向**那一軸。

只是要看畫面的話，**`playwright-cli snapshot` 與 `screenshot` 都不必挑**，它們本來就只看得到可見的
那一份。snapshot 裡 `f12e2` 這種 ref 的 `f12` 就是 frame 編號，翻頁後編號會變，那正好是「畫面真的換
了」的證據。

## 在 reader 裡按不到「書架」「目錄」「排版」

進了 reader 之後 `snapshot` 只看得到兩顆翻頁按鈕跟 iframe，找不到回書架的路。那不是壞掉：〈找〉那一層
（`‹ Shelf`、`⋯`、目錄、筆記、排版）**預設是收起來的**，停在畫面外並且 `visibility: hidden`，所以
pointer、鍵盤與 screen reader 一律碰不到它（[Reader.tsx](../../packages/app/src/components/Reader.tsx)
的 `chrome`）。

叫它出來的是**點畫面中央一下**，也就是「沒有別人認領的那一下 tap」：

```bash
playwright-cli run-code "async (page) => { await page.mouse.click(640, 360) }"
playwright-cli click "getByRole('button', { name: '‹ Shelf' })"
```

翻頁會把它收回去，所以每次要用都得重新點一下。要確認它上來了沒，看 `.chrome` 的 `data-up`：

```bash
playwright-cli --raw eval "() => document.querySelector('.chrome').getAttribute('data-up')"
```

**`file:` 開不起來。** 想把一份 `/tmp` 的 html 丟進瀏覽器對照的時候（例如把量到的數字排成一張表看），
`goto file:///tmp/…` 會被擋掉：`Access to "file:" protocol is blocked`。要看那種東西就丟進
`packages/app/public/` 由 dev server 送出來，看完刪掉。

**不要用 `playwright-cli navigate` 回書架。** 書架與 reader 是同一個 hash route 的兩個狀態
（`#/` 與 `#/book/<id>`），導到 `http://localhost:5001/` 不帶 hash，SPA 不會重載也不會換畫面，看起來就
像指令沒反應。逼不得已時 `eval` 改 hash 是通的（`location.hash = '#/'`），但那條路跳過了真人會碰到的
按鈕，Stage 2 別拿它交差。

## CLI 問不出來的東西：`run-code`

`eval` 是在頁面裡跑 JS，所以它問得到 DOM 的事。問不到的是**只有瀏覽器自己知道的事**——最典型的是
「這段字實際畫出來用了哪個 face」，那要 CDP。

`run-code` 收一個 `async (page) => {…}`，給的是真正的 playwright `page`，於是
`page.context().newCDPSession(page)` 就有整個 protocol。書的內容在 iframe 裡，所以要先 `describeNode`
把 `contentDocument` 撈出來，再往裡面 `querySelector`：

```bash
playwright-cli --raw run-code "async (page) => {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId: frameId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.viewer-mount iframe' })
  const { node } = await cdp.send('DOM.describeNode', { nodeId: frameId, pierce: true })
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: node.contentDocument.nodeId, selector: 'h1' })
  return JSON.stringify((await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts)
}"
```

草枕的封面標題在這台回 `[{"familyName":"Noto Serif CJK TC",…,"glyphCount":2}]`——兩個字，兩個 glyph。
兩個坑：`DOM.enable` 與 `CSS.enable` 少一個就回
`CSS agent was not enabled`；選到沒有文字的元素（例如只包著 `<img>` 的那個 `<p>`）回空陣列，那不是字
型的問題。

上面那句 `DOM.querySelector` 拿的是**第一個** iframe，而畫面上那一個未必是它（見〈翻頁〉那節）。翻過頁
之後要自己挑，CDP 這邊換成 `querySelectorAll` 加一次 computed style：

```js
const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '.viewer-mount iframe' })
const { computedStyle } = await cdp.send('CSS.getComputedStyleForNode', { nodeId: id })  // 逐一問，挑 visibility === 'visible'
```

`node_modules` 裡那份 `playwright` 在 host 上 launch 不起來，它要的瀏覽器只有容器裡有；量到的版本差
與理由見 [ADR-0007](../adr/0007-pr-evidence-is-captured-on-the-host.md)。

## 兩段式驗證

### Stage 1 — baseline（大致確認，不逐項）

只確認「沒把大東西搞壞」：

1. app 載入、書架看得到書（`playwright-cli find "草枕"`）。
2. 點開進得了 reader、頁面有內容——`playwright-cli snapshot` 或直接量：

   ```bash
   playwright-cli --raw eval "() => { const f = [...document.querySelectorAll('.viewer-mount iframe')].find(x => getComputedStyle(x).visibility === 'visible'); return f.contentDocument.body.innerText.length }"
   ```

3. `playwright-cli console` 沒有 error。（沒起 worker 的話 `/auth/me` 與 `/api/sync` 的 502 不算。）

不做細項檢查——這關只是抓「整個 app 是不是壞了」。

### Stage 2 — feature-specific（重點）

針對**這次 spec 改的東西**，設計一個看得到的**真實操作**檢查。沒有寫死步驟，因為每個 spec 不同；原則
是「一個使用者會做、而且壞掉時看得出來的操作」。範例：

- 改直排翻頁 → `playwright-cli press ArrowLeft` 真的翻一頁，確認方向對（直排 left = next）、頁碼有動。
- 改 settings 面板 → 開面板、改一個值，確認 reader 立刻反映。
- 改章節邊界穿越 → 翻到章節尾，確認自動走下一個 section。

Stage 2 過不了就是 feature 沒完成，回去修，別宣稱完成。

## 驗 sync（需要登入狀態）

sync 要 session cookie，headless browser 過不了 WebAuthn，所以 passkey 那把鑰匙用不了。繞道走另一把：
往 local D1 塞一組 magic code，然後用真的 `/auth/code/verify` 花掉它。少掉的只有信箱那一步，其餘跟
讀者走的路一模一樣。

1. `npm run build` 一次 —— `wrangler dev` 需要 `dist/` 存在（assets binding），沒 build 過會直接啟動
   失敗。
2. 背景起 `npm run worker:dev`。
3. 跑 seed script，往 local D1 塞固定 test user + 一組還沒用過的登入碼（script 會先 idempotent 套用
   schema，每次跑都重發一組，用不完）：

   ```bash
   bash scripts/seed-preview-auth.sh
   ```

4. 在瀏覽器裡登入，拿到 HttpOnly session cookie：

   ```bash
   playwright-cli eval "async () => (await fetch('/auth/code/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'preview@tidemarks.test', code: '424242' }) })).status"
   ```

5. 之後 `syncNow()` 就有登入身分，可驗 sync 行為（例：加一本書 → 確認 push 上 D1／R2；換裝置狀態 →
   確認 pull 回來）。用 `playwright-cli --raw eval "await (await fetch('/auth/me')).text()"` 回傳
   `{"userId":"preview-user"}` 確認登入成功。

seed script 細節見 [scripts/seed-preview-auth.sh](../../scripts/seed-preview-auth.sh)。

## 誠實原則

驗不到的東西，明講「無法驗證」，不假裝過。收尾回報時說清楚哪些路徑實測通過、哪些沒驗到。
