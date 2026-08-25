## 安裝相依

`npm install` 就好，CI 與測試映像走 `npm ci`。**一律在根目錄跑**：這是一個 npm workspaces 的
monorepo，只有一份 lockfile，在某個 package 底下裝東西會裝出一棵對不上的樹。要指定 package 用
`-w`（`npm install -w app dexie`）。

`npm install` 順便會把 git 的 `core.hooksPath` 指到 `.githooks/`，那裡的 **pre-commit 會對即將
commit 的檔案跑 prettier 再重新 stage**，所以 commit 出來的東西一定是格式化過的。格式規則在
`.prettierrc.json`（預設風格加 `printWidth: 100`），**markdown 不在管轄範圍**（`.prettierignore`：
`docs/` 那些中文是手工折行的）。CI 有 `npm run format:check` 當後盾。

本專案常以 git worktree 開發，並且**在多個環境之間輪替**（Linux／WSL2、macOS，x64 與 arm64 都有）。
所以「這台機器是什麼」不是固定答案，**要看就去看**（`process.platform` / `uname`），不要假設。這也
是為什麼**自動化**的瀏覽器測試與字型走容器：見 `Dockerfile` 的檔頭。（開 PR 前那批給人看的截圖不走
容器，在 host 上用 playwright-cli 產——那是刻意的取捨，見
[ADR-0007](docs/adr/0007-pr-evidence-is-captured-on-the-host.md)。）

## package 怎麼分

```
packages/app      PWA（`src/`）＋ Worker（`worker/`）＋ `migrations/`＋ `wrangler.jsonc`
packages/frond    渲染層。見下面〈frond 的邊界〉
tests/books/      兩個 package 的測試共讀的公版書，只有一份
```

**app 與 worker 不拆成兩個 package**：`worker/` 直接 import `../src/lib/merge` 與
`../src/lib/types`，拆開就要多一個 `shared`，換不到東西。決定與理由見
[ADR-0018](docs/adr/0018-one-repo-many-packages.md)。

根目錄的 script 一律轉給 package（`npm run build` = 先 `build:frond` 再 `npm run build -w app`）。
**這是刻意的**：Cloudflare Workers Builds 的設定在 dashboard 裡，寫的是根目錄的 npm script
（`npm run build`、`npm run deploy`、preview 分支的 `npm run versions:upload`），所以 package
佈局怎麼變都不用回頭改它。**dashboard 裡不要出現直接叫工具的指令**，那種指令會在根目錄找
`wrangler.jsonc`，而它在 `packages/app/`。見 [deployment.md](docs/deployment.md)。

**`deploy` 與 `versions:upload` 是這條規則的例外**：它們跑的是 `scripts/deploy.ts`，那支 script
本來就住在根目錄（它要讀 `packages/app/wrangler.jsonc` 再產生實際要用的設定），轉一手換不到東西。

## 現在是開發階段

Tidemarks 雖然已經部署在 `app.tidemarks.io`（真的 D1、真的 R2），但**還沒上線**——上線定義成
**開放外界註冊**那一刻（不管入口是 email、邀請碼還是別的；免費試用的帳號也算）。在那之前：
frond 的 API、CFI 的輸出格式、IndexedDB 與 D1 的 schema 全部可以隨便改，**資料可以丟**。上線
之後一律要接過去。細節與理由見
[ADR-0004](docs/adr/0004-development-phase-and-launch-line.md)。

「資料可以丟」不等於「schema 靠手動送上去」。**動到 D1 的 schema 就在 `packages/app/migrations/`
加一支**，開發階段那支裡面允許 `DROP`。改既有的 migration 檔沒有用——資料庫已經記得它跑過了。

跑 migration 的是 `npm run deploy`（`scripts/deploy.ts production`：產生設定 → `migrations apply
--remote` → `wrangler deploy`）。**部署只有這一條路，沒有從筆電部署這回事**——每個部署的專屬值
（資源 id、網域、寄件位址）都在 Workers Builds 的 build variables 裡，只有 build 環境拿得到，
官方與自架都一樣。preview 分支的 `versions:upload` **不跑 migration**。理由見
[deployment.md](docs/deployment.md)。

## 這個 repo 是公開的，而且沒有私有的另一半

repo 已經是 public，**檔案、`git log`、commit message、issue 與 PR 內文，全部都在外面看得到**。
沒有一個「之後才會公開」的時間點，也沒有一份留在私有處的版本——寫下去就是公開的。

（[ADR-0009](docs/adr/0009-open-source-buys-an-exit-not-contributions.md) 規劃的「另開一個 public
repo、單一 initial commit」照做了：`yurenju/tidemarks` 是 2026-08-19 新開的，歷史從單一個
`Initial commit` 開始。沒跟著成立的是它換到的第二件事——舊 repo 不再是工作台，往後的開發都在
這裡。）

**`yurenju/folis`（更早叫 `yurenju/spine`）是以前的 private repo，已經不再使用。** 它不是備援，
指向它的連結對外一律 404，那邊的 issue 也不必去查——現在唯一算數的是這個公開的
`yurenju/tidemarks`。

所以標準只有一條：**每一種敘述都照給陌生人讀的標準寫**，不分檔案、commit 還是 issue。

同一個決定往往有好幾種理由都成立，**寫下來的挑對讀者有意義的那個**：「不去重」的理由寫
「你的書就是你的那一份」，而不是從商業或法律角度推出來的那一版。這不是粉飾——兩個都是真的，
而寫給讀者看的那個本來就比較好。

## frond 的邊界

渲染層 frond 就在 `packages/frond`，原始碼、測試、ADR 與它自己的 `CONTEXT.md` 都在那裡。它是為
Tidemarks 而做的，**但 UI 一項都不在它裡面**。

分法是 frond 的
[ADR-0002](packages/frond/docs/adr/0002-frond-owns-facts-spine-owns-policy.md)：
**frond 吐事實，app 做政策**。事實是「這本書是 rtl、是直排、是繁體、這個範圍佔哪些矩形、
現在的 fraction 是多少」；政策是「所以往左滑等於下一頁、highlight 畫成這個顏色、目錄長成側欄」。

⚠️ **這條線現在只剩這段文字在守。** 以前擋著違規的是成本：要動 frond 就得開另一個 repo 的 PR、
等 merge、等手動發版。那道摩擦沒有了（[ADR-0017](docs/adr/0017-frond-moves-in-and-stops-being-published.md)），
現在改 frond 跟改 app 一樣近，所以怎麼分要自己講得清楚。它一句話講得完：

> **拿不到只有 frond 知道的事實，就讓 frond 補上那個事實；只是繁瑣，就留在 Tidemarks。**

碰到「這件 UI 的事在 app 做很痛，是不是該搬進 frond」，**先問痛的原因**：

- **拿不到只有 frond 知道的事實** → 讓 frond 補上那個事實，決定權留在 app。
- **只是繁瑣**（很多情境、很多例外） → 留在 app。繁瑣不是搬家的理由。

這條規則只會讓 frond 的 API 變豐富，不會讓政策往下沉。`@yurenju/frond-react` 已經收掉，
所以 frond 那邊**沒有任何一層擺得下 UI 政策**。

package 邊界是真的邊界：app 一律從 `@yurenju/frond/epub` 與 `@yurenju/frond/renderer` 這兩個公開
入口 import，**不從旁邊伸手進去拿 `packages/frond/src/` 底下的檔案**。那兩個入口指向 `dist/`，所以
改完 frond 要 `npm run build:frond`（根目錄的 `dev`、`build`、`test` 都會先做這件事；一邊改一邊看
就開 `npm run build:watch -w @yurenju/frond`）。

`@yurenju/frond` 停在 0.4.15 且不再發布。要接回 npm 得從 0.4.16 起續號，理由與代價見 ADR-0017。

## 樣式：原生 CSS，八個檔案，一份清單

樣式在 `packages/app/src/styles/`，八個檔案；`packages/app/src/index.css` 只剩一份 `@import` 清單，
每一行旁邊寫著那個檔案管什麼。**要加規則就先讀那份清單挑檔案**，它同時也是唯一寫得出「哪個檔案管
哪一塊」的地方（另開一份文件會過期，那份清單跟著檔案一起改）。

**那份 `@import` 清單就是 cascade。** 沒有 `@layer`，也沒有靠 specificity 分勝負，所以規則靠「排在
後面」取勝。最吃這件事的是 `device.css`：它裡面有 29 個選擇器在前七個檔案就設過了，同樣的
specificity（media query 不加分），純粹因為 import 在最後才贏。**把它的內容搬去跟元件作伴就會壞。**

反過來說，改元件的時候要記得 `device.css` 可能在覆寫同一條規則——真的有覆寫的地方，元件檔案裡留了
一行指路的註解。

**不引入 CSS Modules／Tailwind／CSS-in-JS**，理由見
[ADR-0033](docs/adr/0033-styles-stay-plain-css-in-eight-files.md)。那份 ADR 存在的用途就是擋掉
「這個該模組化吧」的第二次討論。

`lib/tokens.test.ts` 會照著 `index.css` 的 `@import` 清單把八個檔案讀起來，檢查有沒有指向不存在的
custom property。**新增樣式檔就要加進清單**，不然它既不進 bundle、也不會被檢查。

## 程式碼用英文，文件用中文

界線切在**檔案類型**上，不切在內容上：

| | 語言 |
| --- | --- |
| 程式碼檔（`.ts` `.tsx` `.css` `.html` `.mjs`、`.json` / `.jsonc` / `.yml`、`Dockerfile`、`.gitignore`、`.dockerignore`） | **英文** |
| `README.md`（含 `packages/*/README.md`） | **英文** |
| 文件（`docs/`、`packages/*/docs/`、`CONTEXT.md`、`CLAUDE.md`、`README.zh-TW.md`、`.scratch/`、GitHub issue／PR 內文） | 中文 |

（`docs/specs/` 是 `docs/` 的一部分，也是中文。`.scratch/` 不進版控，語言一樣照這條。）

根目錄的 `README.zh-TW.md` 是 `README.md` 的中文版，兩份是同一份內容的兩個語言。**改了一邊就要改
另一邊**——只更新一邊會留下一份看起來還算數、其實已經過期的說明，那比沒有更糟。（這條只管根目錄
那一對。`packages/frond/README.md` 只有英文一份，它的讀者是打開那個目錄的人。）

程式碼檔裡**每一種敘述**都算：檔頭註解、行內註解、識別字、錯誤訊息、`console`
輸出、`describe` / `test` 的名稱、以及 config 檔裡的註解。commit message 也用英文
（既有歷史不動——重寫歷史的代價遠大於語言一致性的收益）。

翻的時候是**重寫成英文**，不是逐字換。這個 repo 的註解在解釋「為什麼」，直譯出來
的英文通常兩邊都讀不順。

### 例外：中文是資料，或中文本身就是答案的時候

這幾類**原樣保留**，它們不是可以翻譯的文字：

- **catalog 裡的譯文**——`packages/app/src/locales/*.po`。介面文案走 i18n 了，**程式碼裡寫的是
  英文原文**，繁中與日文住在 catalog 裡（[ADR-0031](docs/adr/0031-english-is-the-source-and-chinese-becomes-a-translation.md)）。
  所以 `.tsx` 裡看到中文字串就是漏搬的，不是例外。做法見 `docs/agents/i18n.md`。
- **語言選單自己的三個名字**——`packages/app/src/lib/locale.ts` 的 `English` / `繁體中文` /
  `日本語`。每一個都寫成它自己那種語言，所以它們在每個畫面上都一樣，不進 catalog：會來按這個
  設定的人，正是看不懂當前語言的那一個。
- **被測對象**——`packages/app/src/lib/chinese.ts` 的簡繁對照表、`epub.test.ts` /
  `toc.test.ts` 的 fixture 文字與章節標題、`lang` 屬性、直排相關測試裡有鑑別力的
  字元。`packages/frond/` 底下同理：fixture 的日文散文、註解裡為了說明字形而引用的
  字（`骨`、`。`），換成英文那句話就不成立。

怎麼分：**換成英文之後那句話還成不成立**。`scrubber.ts` 註解講「直排書書首在右」，
換成 "vertical books start at the right" 完全成立，該翻；`chinese.ts` 的
`书→書` 對照表換掉就沒有東西可測了。

### 一次只改手上那個檔案

**不做一次性全 repo 掃描**。規則是：編輯某個檔案時，發現它屬於上表「該用英文」那
一類卻寫著中文，就順手把**那個檔案**轉掉。沒動到的檔案不用去找、不用列清單追進度
——這是刻意選的節奏，避免一大包純翻譯的 diff 蓋掉真正的變更。

翻譯超過幾行的時候，**跟功能變更分成兩個 commit**，讓真正的改動在 diff 裡還讀得
出來。

## Agent skills

### Issue tracker

Bug 與 task 用 GitHub issue（`gh issue`）；spec 與支撐它的量測以 markdown 存放於 `docs/specs/<feature>/`，
會進版控。wayfinding 留在 `.scratch/`，那個目錄被 `.gitignore` 擋著。issue 之間的先後用 GitHub 原生的
相依性（blocked by／blocking），**API 吃的是 numeric id 不是編號**。見 `docs/agents/issue-tracker.md`。

### Domain docs

一個 package 一份 `CONTEXT.md` 加自己的 `docs/adr/`：根目錄那組是 Tidemarks 的，`packages/frond/` 那組
是 frond 的。兩套 ADR **各自編號、不重編**，所以引用時要寫清楚是哪一邊的（「frond ADR-0002」加相對
路徑）。見 `docs/agents/domain.md`。

### 介面文案與翻譯

介面有三種語言：**英文是原文、寫在程式碼裡**，繁體中文與日文是 catalog 裡的譯文，三種地位相同，
少一條 CI 就紅。翻譯是寫程式的一部分——加文案的那個 commit 就要把三種補齊。

每一條詞條的 `comment` 是**必填**的，而那是這整件事的重點：翻錯最常見的形式不是翻得爛，是拿
另一個地方的詞條來用，而從英文字面看不出來的差別只有 comment 講得出來。同一個英文要有兩種
翻法時加 `context`；⚠️ **只在真的撞到的時候才加**，預設是共用。

⚠️ **`worker/` 底下不能用 macro**（wrangler 走 esbuild，沒有 Babel），Worker 碰得到的 app 模組
也不行——那份清單就是 `tsconfig.worker.json` 的 `include`。見 `docs/agents/i18n.md`。

### 測試分層

`npm test` 有四個 vitest project：**node** 蓋 app 的純邏輯，**worker** 把 worker 真的跑在 workerd
裡帶真的 D1／R2／KV，**frond** 蓋渲染層的解析半邊，**scripts** 蓋 `scripts/` 底下的純函式。
`npm run test:container` 在容器裡跑三家瀏覽器：先 frond 的（量字符幾何，`--network=none`），
再 app 的（真的開一本真的書）。動到 reader 就跑 `test:container`。

**scripts 那層只收純函式**，也就是 `scripts/deploy.ts` 那種部署腳本裡「不碰檔案、不叫外部指令」的
半邊（現在是 `deploy-config.ts`）。它擋的問題跟 worker 那層同一類：這些程式碼跑在 Cloudflare 的
build 環境裡，錯了不會紅燈，會變成一次「部署成功、但指到錯的資料庫」。I／O 那一半不測——把它跟
判斷分開，就是為了讓判斷測得到。

frond 先跑是因為它在下面：渲染層壞掉的時候 app 那套也會紅，先看 frond 的失敗才知道是哪一層。

#### 一邊改一邊跑的時候，跑窄的那一支

⚠️ **不要每改一行就 `npm run test:container`。** 那一支是三家引擎 × 兩個 package 的全套，一趟三到
九分鐘；改到一半的時候你要的不是全套，是剛剛那支測試。narrow 的寫法是同一支腳本加 `--only=`：

```bash
./scripts/test-in-container.sh --only=app --project=chromium tests/browser/library/order.spec.ts
```

**21 秒**（其中 18 秒是建映像與比對，測試本身只有幾秒），對上全套實測的 **6 分 46 秒**。`--only=frond` 同理。
路徑**相對於那個 package**（`tests/browser/…`，不是 `packages/app/tests/browser/…`），因為 Playwright
的 cwd 在 package 裡。

順序是**先窄後寬**：改的時候跑窄的，commit 之前跑一次全套，開 PR 之前再跑一次。

⚠️ **輸出一定要存檔再看**（`| tee /tmp/…/ct.log`），不要為了換一個 `grep` 就重跑。實際發生過：同一個
失敗連跑三趟，只為了先 `tail -60`、再 `grep -B30`、再 `grep -A25`，七分鐘沒有跑到任何新的 code。

`--only=` 存在的理由本身也值得知道：沒有它的時候，指定單一測試檔會讓 frond 那半 match 不到東西、
Playwright 當成錯誤中止整支腳本，所以以前的做法是**繞過腳本直接下 `podman run`**——而那樣就跳過了
建映像與 issue #185 的比對，跑的可能不是你磁碟上的 code。

以上講的是**東西放在哪一層**。**一條測試該不該存在**是另一個問題：每個測試都要說得出它測到的角度，
而那個角度是其他層次測不到的，答不出來就刪。加測試之前先讀那一份——尤其「同一個命題在上層最多留
一條接線」那條，它是最常被違反的。見 `docs/agents/testing.md`。

### Flaky

CI 紅了而重現不了的時候，**先分診再動手**：原因只有「測試自身的 race」與「偶發缺陷」兩種，機器忙是
放大器不是原因，所以壓 `workers` 不算修好。帳本是貼 `flaky` label 的 GitHub issue，第一次紅就開。
按重跑之前先確認它在帳本裡。見 `docs/agents/flaky.md`。

worker 那層**刻意只有少數幾條**。它慢，而且決策該不該做的部分純函式已經測完了；它測到的角度是純
測試結構上看不到的那一類 bug：欄位名不存在、`bind()` 的次序跟 `?N` 對不上、某條路沒有 token 也進得去。
那些都通得過 type check，然後在 production 壞掉。動到 `worker/` 底下的 SQL 或路由就補一條。

**它跑在 host 上，不進容器**，跟瀏覽器測試相反。瀏覽器那套進容器是因為字型與引擎版本要一致，數字
才可比；worker 這層斷言的是 JSON 與 SQL，沒有那個敏感度，而剩下的開發環境（linux／darwin，x64 與
arm64）workerd 五個 build 都有。

**不要**在 host 上直接跑某個 package 的 `test:browser`（`npm run test:browser -w app`）。根目錄
**刻意沒有這支 script**，因為它只會是兩套裡的一套。host 上是有三家瀏覽器沒錯，但兩個 package 的
`tests/browser/` 斷言的都是**容器的數字**——`rendering.spec.ts` 斷言的 18 是 Noto Serif CJK JP 在那
個字級下的直排 advance，而 host 的引擎版本又跟映像差一版。在 host 上跑出來的紅綠燈，跟 CI 說的不是
同一件事。

#### 瀏覽器那層怎麼找東西

只管 `packages/app/tests/browser/` 與 `tests/sweep/`。另外三個 vitest project 沒有 DOM，frond 沒有
UI（frond ADR-0002），這一段跟它們無關。

**介面語言在設定檔裡釘死 `en`**，兩份 Playwright 設定各一行（`playwright.config.ts`、
`playwright.sweep.config.ts`）。不釘的話畫面上的字跟著容器的 `Accept-Language` 走，那是機器的性質
不是 app 的性質：測試那層會找不到自己寫的字串，巡檢那層則是拍出來的圖跨機器跨日期不能比，而可比性
正是 ADR-0027 要守住的東西。釘 `en` 是因為英文是原文，**不可能缺詞條**。想看中文或日文的畫面就把那一行
改掉跑一次，不為此多開一個 project。

**`data-testid` 標的是畫面與區塊，區塊裡面的東西用 role 找**：
`getByTestId("panel-toc").getByRole("button", { name: "Contents" })`。這樣一次守住兩件事——區塊找得
到（改文案不會全盤紅），而按鈕仍然必須有可及名稱，那個名稱掉了就會紅。testid 掛到按鈕上只剩前者，
而可及性壞掉是沒有人會回報的那一類（ADR-0021）。圖示鈕（`book-open`、`about-delete`）是例外，當例外
看待。

**書名、章節名、筆記內容不套這條**：那些是 epub 與讀者的字，不是 Tidemarks 的文案。用文字找它們正是
測試要驗的東西，換成 testid 就什麼都沒驗到。

**build 不剝 testid。** 收尾驗證要在真的部署上用同一組 selector 跑（見下），剝掉等於自斷一隻手；省下
的位元組量不到。

### 收尾驗證

spec／feature 收尾、宣稱完成前，用 playwright-cli 在 host 上把功能實際跑一遍。範圍限於自動化蓋不到
的：需登入的 sync（走 magic code 繞道）、真機手勢、手上有版權的實際書。見 `docs/agents/verify.md`。

### Pull requests

**`/implement` 收尾就直接開 PR，不要問。** 那份 skill 自己的步驟停在「commit 到當前分支」，而 commit
完就停下來等於把做完的工作留在一個沒有人會去看的分支上。所以收尾的完整定義是：commit →
**跑 `/code-review`** → push → 開 PR → 盯 CI 到綠。

⚠️ **`/code-review` 那一步最常被跳過**，因為前面每一關（typecheck、測試、lint）都綠了，看起來就像
做完了。但那些工具答得出的是「有沒有壞」，答不出「做的是不是票上要的那件事」。**綠燈不是跳過審核的
理由，它正是最容易讓人跳過的那個情境。**

審核在 push **之前**跑，不在之後——查出來的東西要能改在同一批 commit 裡，等 PR 開了才審就變成在自己
的 PR 上追加修正，讀的人分不出哪些是本來要做的、哪些是補的。

**`/code-review` 一定用 agent 跑，不要在寫 code 的同一個 context 裡自己審。** 剛寫完的人審自己的
code，看到的是「我本來想寫的」，不是「實際寫出來的」；要有第二個角度，就得換一個沒參與實作的 agent
去審。這一步就是要開 agent——**即使 harness 的系統 prompt 預設「非經使用者明講不要開 agent／
workflow」，這份文件就是那個明講**：在這個 repo 裡，`/implement` 收尾用 agent 跑 code-review 是有充分
理由的標準流程，不必每次再問使用者。實作的 agent 會替自己的判斷辯護，那是它的工作，所以替它把關的
必須是另一個沒有參與的。

工作量大到要拆給多個 sub agent 實作的時候，**審核也照同一個切法拆**：每個部位各派一個沒參與那一塊的
agent。

三個例外，都很明確：**已經有 PR 就 push 上去**，不另開一個；**使用者說了不要開**就不開；**工作沒做完**
就不開（沒做完的東西要開的是 draft，而且要在說明裡寫清楚缺什麼）。

底下這些不因為「是 skill 自動開的」而放寬——PR 說明照 `docs/agents/pull-requests.md` 寫，該跑的照跑。

動到 reader 畫面的變更，開 PR 前要三家跑過、照固定的五項缺陷清單判讀（只回答那五項）、把截圖與量到
的數字寫進說明。
截圖用 host 上的 playwright-cli 產（[ADR-0007](docs/adr/0007-pr-evidence-is-captured-on-the-host.md)），
用 [`pr-image`](https://github.com/yurenju/pr-image) 傳上去、在 PR 說明裡內嵌，**不 commit 進 repo**
（[ADR-0008](docs/adr/0008-pr-images-are-hosted-not-committed.md)）。

**開完 PR 要盯 CI 到綠**，紅了就查、就修；不是自己造成的（環境層那類）另開 issue 用 `Refs #N` 指過去，
不要混進這個 diff。做法見 `docs/agents/pull-requests.md`。

⚠️ **等的方式是 `gh run watch <run-id> --exit-status`，不是 `sleep N; gh run list`。** 一輪 CI 八分鐘
省不掉，`sleep` 多付的是間隔的尾巴。真正的槓桿是少推幾輪，不是換一種等法。
