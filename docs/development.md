# 開發

## 起手式

```sh
npm install                # 安裝相依
npm run dev                # 開發伺服器
npm test                   # vitest：決策模組的純邏輯，跑在 Node
npm run test:container     # 兩個 runner 都跑（Vitest + 瀏覽器），動到 reader 就跑這個
npm run build              # 型別檢查 + 產出 dist/
```

**一律在根目錄跑。** 這是一個 npm workspaces 的 monorepo，只有一份 lockfile，在某個 package
底下裝東西會裝出一棵對不上的樹；要指定 package 用 `-w`（`npm install -w app dexie`）。根目錄的
script 一律轉給 package，這是刻意的，Cloudflare Workers Builds 的設定寫的是根目錄的 npm script，
package 佈局怎麼變都不用回頭改它。

`npm install` 順便會把 git 的 `core.hooksPath` 指到 `.githooks/`，那裡的 pre-commit 會對即將
commit 的檔案跑 prettier 再重新 stage，所以 commit 出來的東西一定是格式化過的。

### 需要先有

- **Node 22.18 以上的官方 build**（CI 用 22）。`scripts/` 底下的工具都是直接 `node xxx.ts` 執行，靠的是
  Node 內建的 TypeScript 型別剝除，22.18 起預設開著。⚠️ **Ubuntu apt 的 `nodejs`（版本號帶 `+dfsg`）
  實測沒有這個功能**，`process.features.typescript` 是 `false`，`npm run build:frond` 會在 `tsc` 跑完之後
  死在 `ERR_UNKNOWN_FILE_EXTENSION ".ts"`。看起來像 frond 壞了，其實是 Node 不對。用 fnm、nvm 或官方
  tarball 裝；要用 pr-image 就直接裝 24，它要 24 以上。
- **docker**，`npm run test:container` 用。docker 的 rootful 與 rootless 都可以，見
  [frond 的 test-environment.md](../packages/frond/docs/test-environment.md)〈需要先裝什麼〉。
- **開 PR 要附截圖的話**，還要 host 上的 playwright-cli（裝法見 [agents/verify.md](agents/verify.md)
  〈前置〉）與 pr-image（見 [agents/pull-requests.md](agents/pull-requests.md)〈圖怎麼放〉）。

在容器裡開發的時候，dev server 本來就聽所有介面（[vite.config.ts](../packages/app/vite.config.ts)），
把 5001 forward 出來，host 的瀏覽器就連得到。瀏覽器只需要 5001：`/api`、`/auth` 與 `/billing` 是 Vite
在容器裡代理到 5002 的。`/authorize` 與 `/mcp` 沒有代理，要從 host 用 MCP client 或走 OAuth 的話，5002
也要 forward。

### 在 git worktree 裡開工的時候

新的 worktree 只有原始碼，沒有 `node_modules`，也沒有 frond 的 `dist/`。所以第一件事是在 **worktree 裡**：

```sh
npm install && npm run build:frond
```

少了 `build:frond` 的話，`npm run typecheck` 會噴幾十個 `Cannot find module '@yurenju/frond/epub'`，
原因見根目錄的 `CLAUDE.md`。

⚠️ **還沒裝之前，壞掉的樣子不好認。** worktree 開在主 checkout 底下（`.claude/worktrees/…`）的時候，
Node 往上找得到主 checkout 的 `node_modules`，於是有些東西跑得動（`npx prettier --check`），有些不行：
`npm run typecheck` 給你 `tsc: not found`，`oxlint` 同理。npm 把 `tsc: not found` 印在很前面，底下還
接著一大段 npm 自己的錯誤，所以 `grep "error TS"` 什麼都抓不到，看起來就像「跑過了、沒有型別錯誤」。
量到過同一個坑撞三次。

### 測試映像

要在容器裡跑 `test:container` 以外的指令時，**先用 `build-test-image.sh` 拿一個映像**：

```sh
IMG=$(./scripts/build-test-image.sh)
docker run --rm --init "$IMG" npm run typecheck
```

它做的事跟 `test:container` 跑測試之前一樣：清掉沒人用的映像、建好依賴映像與這個 checkout 的映像、
做 issue #185 的比對，最後在 stdout 印出 image id。**不要自己下 `docker build`**：根目錄的
`Dockerfile` 是 `COPY . .`，映像裡烤的是建它那一刻的 code，而且它的 `FROM` 是腳本算出來的依賴映像，
單獨 build 會直接失敗。

映像分兩層，理由見 [ADR-0051](adr/0051-the-test-image-shares-its-dependencies-across-checkouts.md)：

| | 名字 | 大小 |
| --- | --- | --- |
| 依賴映像：瀏覽器、中日文字型、`npm ci` | `tidemarks-deps:<hash>` | 約 4.9GB，依賴一樣的 checkout 共用一份 |
| 每個 checkout 自己的映像：程式碼與 frond 的 build | `tidemarks-test-<目錄名>` | 約 85MB |

**映像名為什麼要帶目錄名**：以前所有 checkout 共用 `tidemarks-test` 一個 tag，而 tag 是整台機器共用、
可以被別人搬走的名字：你建完映像、issue #185 的比對也過了，接著別的 checkout 建同一個名字，
**你後面那趟測試就跑了別人的 code，而且是綠的**。比對擋不住是因為它驗的是「那個映像的內容」，
但抓著的把手是一個名字，驗完到開跑之間名字被搬走就沒有東西會發現。

⚠️ **真正把這個窗口關掉的不是名字，是 `container_build` 比對完之後改用 image id。** id 搬不走，
`build-test-image.sh` 印的也是 id。名字換成一個 checkout 一個，換到的是另一件事：以前每個 checkout
輪流把 tag 搶過去，別人下一趟就得重建，現在大家的映像可以並存。**要換成別的名字也行**
（`TIDEMARKS_TEST_IMAGE=…`），但現在沒有非換不可的理由了。

#### 誰來清

**平常不用管。** 每次 build 之前，腳本會先清掉這三種，並印出刪了什麼：

- 所屬目錄已經不存在的 checkout 映像（worktree 刪掉之後留下的）
- 沒有 tag、超過 24 小時的 checkout 映像（同一個 checkout 重建之後留下的舊版）
- 沒有任何 checkout 映像建在它上面、超過 24 小時的依賴映像（lockfile 改過之後留下的）

它不加 `-f`，有容器在用的不會刪；它也不碰 build cache。所以磁碟不夠的時候，**跑一次
`./scripts/build-test-image.sh` 就好**，不要自己 prune（見 `CLAUDE.md`〈測試分層〉）。

⚠️ **清不到的是這個機制之前建的映像**，它們沒有那些 label。每台機器手動清一次：

```sh
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -E '^tidemarks-test'
docker rmi <上面列出來、目錄已經不在的那幾個>
```

舊格式那個沒有後綴的 `tidemarks-test` 也在這一類。還活著的 checkout 換到新格式之後，它原本的映像會
變成沒有 tag 的 `<none>`（`docker images --filter dangling=true` 列得出來），確定沒有測試在跑的時候
用 `docker image prune` 清掉。這一行只清沒有 tag 的映像，但不分是誰的，所以只在換格式這一次用。

## 測試分層

`npm test` 蓋純邏輯：方向反轉、TOC 攤平、highlight 裁切、settings 對映。

`npm run test:container` 在容器裡真的開一本真的書翻頁、劃重點、拖 Scrubber。那一層的斷言是**容器裡
的數字**（字型與引擎版本都固定），所以入口是 `test:container` 而不是 `test:browser`，在 host 上跑出
來的紅綠燈，跟 CI 說的不是同一件事。

**在你的機器上它只跑 Chromium，在 CI 上跑滿 Chromium／Firefox／WebKit 三家**
（[ADR-0039](adr/0039-three-engines-are-ci-s-job-not-the-local-loop-s.md)）。要在本地跑三家就把它們
點名：`--project=chromium --project=firefox --project=webkit`。

**一邊改一邊跑的時候不要用全套**，它是兩個 package 的整套。narrow 的寫法是同一支腳本加 `--only=`
（21 秒，其中 18 秒是建映像與比對）：

```sh
./scripts/test-in-container.sh --only=app --project=chromium tests/browser/library/order.spec.ts
```

路徑相對於那個 package（Playwright 的 cwd 在裡面）。順序是改的時候跑窄的、commit 之前跑一次全套。
（⚠️ 這個順序**不適用於查 flaky**，理由見 [agents/flaky.md](agents/flaky.md)。）

第三層在 host 上用 playwright-cli 跑（[agents/verify.md](agents/verify.md)），蓋自動化蓋不到的：
需登入的 sync、真機手勢、手上有版權的實際書。

## 技術

Vite + React + TypeScript、[frond](../packages/frond/README.md)（渲染與 CFI 定位；直排與橫排等價，
三家瀏覽器等價驗證）、[Dexie](https://dexie.org/)（IndexedDB）。

frond 是為了 Tidemarks 寫的渲染層，就住在這個 repo 裡。它吐事實（這本書是 rtl、是直排、這個
範圍佔哪些矩形），app 做政策（往左滑等於下一頁、highlight 畫成什麼顏色），UI 一項都不在它裡面。

這個 repo 是 npm workspaces 的 monorepo：`packages/app` 是 PWA 與 Worker，`packages/frond` 是
渲染層。為什麼是這個分法見 [ADR-0018](adr/0018-one-repo-many-packages.md)。

後端：Cloudflare Workers + D1 + R2、[@simplewebauthn](https://simplewebauthn.dev/)（passkey）。

樣式是原生 CSS，住在 `packages/app/src/styles/` 的八個檔案裡，`packages/app/src/index.css` 那份
`@import` 清單同時就是 cascade，要加規則先讀那份清單挑檔案。理由見
[ADR-0033](adr/0033-styles-stay-plain-css-in-eight-files.md)。

## 部署

只有一條路：`npm run deploy`（跑 `scripts/deploy.ts`，產生設定 → 套 migration → `wrangler deploy`），
而且跑在 Cloudflare Workers Builds 裡，沒有從筆電部署這回事。自架也走同一條。見
[deployment.md](deployment.md)。

動到 D1 的 schema 就在 `packages/app/migrations/` 加一支；改既有的 migration 檔沒有用，資料庫
已經記得它跑過了。

## 開 PR 之前

規則在 [agents/pull-requests.md](agents/pull-requests.md)。動到 reader 畫面的變更要三家瀏覽器
跑過，並把截圖與量到的數字寫進 PR 說明。

Bug、task 與 spec 走 GitHub issue，量測放在 `docs/specs/<feature>/`，見
[agents/issue-tracker.md](agents/issue-tracker.md)。

## 為什麼會有這個東西

[intent/2026-07-15-spine-cross-device-reading.md](intent/2026-07-15-spine-cross-device-reading.md)
