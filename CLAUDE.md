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

`packages/site`（行銷首頁、定價頁、`legal/` 四份法律文件，走 SSG 好讓爬蟲讀得到 HTML）**之後會
有，現在還沒有**：用什麼做、放哪個網域、走哪個 deploy target 都還沒決定，所以連目錄都不開。要開的
時候是 [#110](https://github.com/yurenju/spine/issues/110) 剩下的那一半。

根目錄的 script 一律轉給 package（`npm run build` = 先 `build:frond` 再 `npm run build -w app`）。
**這是刻意的**：Cloudflare Workers Builds 的設定在 dashboard 裡，寫的是根目錄的 npm script
（`npm run build`、`npm run deploy`、preview 分支的 `npm run versions:upload`），所以 package
佈局怎麼變都不用回頭改它。**dashboard 裡不要出現直接叫工具的指令**，那種指令會在根目錄找
`wrangler.jsonc`，而它在 `packages/app/`。見 [deployment.md](docs/deployment.md)。

**`deploy` 與 `versions:upload` 是這條規則的例外**：它們跑的是 `scripts/deploy.ts`，那支 script
本來就住在根目錄（它要讀 `packages/app/wrangler.jsonc` 再產生實際要用的設定），轉一手換不到東西。

## 現在是開發階段

Tidemarks 雖然已經部署在 `app.folis.ink`（真的 D1、真的 R2），但**還沒上線**——上線定義成
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

### 例外：中文是資料或產品文案的時候

這兩類**原樣保留**，它們不是可以翻譯的文字：

- **UI 文案**——Tidemarks 是給中文讀者的閱讀 app，畫面上的字就是產品本身
  （`packages/app/src/lib/settings.ts` 的 `黑體` / `明體` / `書籍預設`）。要不要做 i18n
  是產品決策，不是這條慣例管的事——那筆決策在 #31。
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

### 測試分層

`npm test` 有四個 vitest project：**node** 蓋 app 的純邏輯，**worker** 把 worker 真的跑在 workerd
裡帶真的 D1／R2／KV，**frond** 蓋渲染層的解析半邊，**scripts** 蓋 `scripts/` 底下的純函式。
`npm run test:container` 在容器裡跑三家瀏覽器：先 frond 的（量字符幾何，`--network=none`），
再 app 的（真的開一本真的書）。動到 reader 就跑 `test:container`。

**scripts 那層只收純函式**，也就是 `scripts/deploy.ts` 那種部署腳本裡「不碰檔案、不叫外部指令」的
半邊（現在是 `deploy-config.ts`）。它買的東西跟 worker 那層同一類：這些程式碼跑在 Cloudflare 的
build 環境裡，錯了不會紅燈，會變成一次「部署成功、但指到錯的資料庫」。I／O 那一半不測——把它跟
判斷分開，就是為了讓判斷測得到。

frond 先跑是因為它在下面：渲染層壞掉的時候 app 那套也會紅，先看 frond 的失敗才知道是哪一層。

### Flaky

CI 紅了而重現不了的時候，**先分診再動手**：原因只有「測試自身的 race」與「偶發缺陷」兩種，機器忙是
放大器不是原因，所以壓 `workers` 不算修好。帳本是貼 `flaky` label 的 GitHub issue，第一次紅就開。
按重跑之前先確認它在帳本裡。見 `docs/agents/flaky.md`。

worker 那層**刻意只有少數幾條**。它慢，而且決策該不該做的部分純函式已經測完了；它買的是純測試
結構上看不到的那一類 bug：欄位名不存在、`bind()` 的次序跟 `?N` 對不上、某條路沒有 token 也進得去。
那些都通得過 type check，然後在 production 壞掉。動到 `worker/` 底下的 SQL 或路由就補一條。

**它跑在 host 上，不進容器**，跟瀏覽器測試相反。瀏覽器那套進容器是因為字型與引擎版本要一致，數字
才可比；worker 這層斷言的是 JSON 與 SQL，沒有那個敏感度，而剩下的開發環境（linux／darwin，x64 與
arm64）workerd 五個 build 都有。

**不要**在 host 上直接跑某個 package 的 `test:browser`（`npm run test:browser -w app`）。根目錄
**刻意沒有這支 script**，因為它只會是兩套裡的一套。host 上是有三家瀏覽器沒錯，但兩個 package 的
`tests/browser/` 斷言的都是**容器的數字**——`rendering.spec.ts` 斷言的 18 是 Noto Serif CJK JP 在那
個字級下的直排 advance，而 host 的引擎版本又跟映像差一版。在 host 上跑出來的紅綠燈，跟 CI 說的不是
同一件事。

### 收尾驗證

spec／feature 收尾、宣稱完成前，用 playwright-cli 在 host 上把功能實際跑一遍。範圍限於自動化蓋不到
的：需登入的 sync（走 magic code 繞道）、真機手勢、手上有版權的實際書。見 `docs/agents/verify.md`。

### Pull requests

動到 reader 畫面的變更，開 PR 前要三家跑過、照固定的五項缺陷清單判讀（只回答那五項）、把截圖與量到
的數字寫進說明。
截圖用 host 上的 playwright-cli 產（[ADR-0007](docs/adr/0007-pr-evidence-is-captured-on-the-host.md)），
用 [`pr-image`](https://github.com/yurenju/pr-image) 傳上去、在 PR 說明裡內嵌，**不 commit 進 repo**
（[ADR-0008](docs/adr/0008-pr-images-are-hosted-not-committed.md)）。

**開完 PR 要盯 CI 到綠**，紅了就查、就修；不是自己造成的（環境層那類）另開 issue 用 `Refs #N` 指過去，
不要混進這個 diff。做法見 `docs/agents/pull-requests.md`。
