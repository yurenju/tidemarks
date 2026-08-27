# 開發

## 起手式

```sh
npm install                # 安裝相依
npm run dev                # 開發伺服器
npm test                   # vitest —— 決策模組的純邏輯，跑在 Node
npm run test:container     # 兩個 runner 都跑（Vitest + 瀏覽器），動到 reader 就跑這個
npm run build              # 型別檢查 + 產出 dist/
```

**一律在根目錄跑。** 這是一個 npm workspaces 的 monorepo，只有一份 lockfile，在某個 package
底下裝東西會裝出一棵對不上的樹；要指定 package 用 `-w`（`npm install -w app dexie`）。根目錄的
script 一律轉給 package，這是刻意的——Cloudflare Workers Builds 的設定寫的是根目錄的 npm script，
package 佈局怎麼變都不用回頭改它。

`npm install` 順便會把 git 的 `core.hooksPath` 指到 `.githooks/`，那裡的 pre-commit 會對即將
commit 的檔案跑 prettier 再重新 stage，所以 commit 出來的東西一定是格式化過的。

### 在 git worktree 裡開工的時候

這個專案常以 worktree 開發，而 `node_modules` 在主 checkout 底下，worktree 只有原始碼。所以
`npm run typecheck` 會給你 `tsc: not found`，`oxlint` 同理（`npx prettier --check` 反而跑得動）。

⚠️ **這個錯誤訊息不好認**：npm 把 `tsc: not found` 印在很前面，底下還接著一大段 npm 自己的錯誤，
所以 `grep "error TS"` 什麼都抓不到——看起來就像「跑過了、沒有型別錯誤」。量到過同一個坑撞三次。

最省事的是**回主 checkout 跑**。要在容器裡跑也行，但**得先把映像建到最新**：

```sh
IMG="tidemarks-test-$(basename "$PWD")"
podman build -t "$IMG" . && podman run --rm --init "$IMG" npm run typecheck
```

少了 `build` 那一半就沒有意義——`Dockerfile` 是 `COPY . .`，映像裡烤的是建它那一刻的 code，
不是你剛改的那份。

**映像名為什麼要帶目錄名**：`scripts/container.sh` 的預設就是 `tidemarks-test-<checkout 的目錄名>`，
一個 checkout 一個。以前所有 checkout 共用 `tidemarks-test` 一個 tag，而 tag 是整台機器共用、
可以被別人搬走的名字——你建完映像、issue #185 的比對也過了，接著別的 checkout 建同一個名字，
**你後面那趟測試就跑了別人的 code，而且是綠的**。比對擋不住是因為它驗的是「那個映像的內容」，
但抓著的把手是一個名字，驗完到開跑之間名字被搬走就沒有東西會發現。

⚠️ **真正把這個窗口關掉的不是名字，是 `container_build` 比對完之後改用 image id。** id 搬不走。
名字換成一個 checkout 一個，換到的是另一件事：以前每個 checkout 輪流把 tag 搶過去，別人下一趟
就得重建，現在大家的映像可以並存。

自己下 `podman build` 的時候照著帶就好，這樣你手動建的跟腳本建的是同一個。**要換成別的名字也行**
（`TIDEMARKS_TEST_IMAGE=…`），但現在沒有非換不可的理由了。

代價是映像會累積而不是互相覆蓋，worktree 刪掉之後它的映像還在。**下面兩個指令是 podman 的**，
docker 的 `image prune` 沒有文件寫著吃 `reference` 這個 filter，不要直接照搬：

```sh
podman image prune -a --filter reference='tidemarks-test-*'
```

⚠️ 這一行會清掉**所有**沒有容器正在用的 `tidemarks-test-*`，包含還活著的 worktree 的那一份
（它們下一趟要重建）。所以要在別人沒在跑的時候做。

它清不到的有兩種，各要一個指令。`<none>` 的懸空層（一層 3GB 起跳，是被換掉的映像留下來的）用
不帶 filter 的 `podman image prune`；舊格式那個沒有後綴的 `tidemarks-test` 還帶著 tag，
prune 一律不碰有 tag 的，要自己指名 `podman rmi tidemarks-test`。

## 測試分層

`npm test` 蓋純邏輯：方向反轉、TOC 攤平、highlight 裁切、settings 對映。

`npm run test:container` 在容器裡真的開一本真的書翻頁、劃重點、拖 Scrubber。那一層的斷言是**容器裡
的數字**（字型與引擎版本都固定），所以入口是 `test:container` 而不是 `test:browser`——在 host 上跑出
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
`@import` 清單同時就是 cascade——要加規則先讀那份清單挑檔案。理由見
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

Bug 與 task 走 GitHub issue，spec 與量測放在 `docs/specs/<feature>/`，見
[agents/issue-tracker.md](agents/issue-tracker.md)。

## 為什麼會有這個東西

[intent/2026-07-15-spine-cross-device-reading.md](intent/2026-07-15-spine-cross-device-reading.md)
