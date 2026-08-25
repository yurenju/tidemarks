# 開發

## 起手式

```sh
npm install                # 安裝相依
npm run dev                # 開發伺服器
npm test                   # vitest —— 決策模組的純邏輯，跑在 Node
npm run test:container     # 兩個 runner 都跑（Vitest + 三家瀏覽器），動到 reader 就跑這個
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
podman build -t tidemarks-test . && podman run --rm --init tidemarks-test npm run typecheck
```

少了 `build` 那一半就沒有意義——`Dockerfile` 是 `COPY . .`，映像裡烤的是建它那一刻的 code，
不是你剛改的那份。

⚠️ **`tidemarks-test` 是共用的 tag**（`scripts/container.sh`），主 checkout 與這台機器上每個
worktree 用的都是它。建下去會蓋掉別人正在用的那一份，所以有別人在跑的時候用
`TIDEMARKS_TEST_IMAGE=tidemarks-test-<你的分支>` 換一個名字。

## 測試分層

`npm test` 蓋純邏輯：方向反轉、TOC 攤平、highlight 裁切、settings 對映。

`npm run test:container` 在容器裡用 Chromium／Firefox／WebKit 真的開一本真的書翻頁、劃重點、拖
Scrubber。那一層的斷言是**容器裡的數字**（字型與引擎版本都固定），所以入口是 `test:container`
而不是 `test:browser`——在 host 上跑出來的紅綠燈，跟 CI 說的不是同一件事。

**一邊改一邊跑的時候不要用全套**，它是三家引擎 × 兩個 package，實測一趟 6 分 46 秒。narrow 的寫法是
同一支腳本加 `--only=`（21 秒，其中 18 秒是建映像與比對）：

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
