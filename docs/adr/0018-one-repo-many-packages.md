# 一個 repo，多個 package，用 npm workspaces

日期：2026-08-11。

## 決定

spine 是 monorepo，package 放在 `packages/` 底下，用 **npm workspaces**，一份 lockfile。

現在有兩個：

| package | 內容 |
| --- | --- |
| `app` | PWA（`src/`）＋ Worker（`worker/`）＋ `migrations/`＋ `wrangler.jsonc` |
| `@yurenju/frond` | 渲染層（[ADR-0017](0017-frond-moves-in-and-stops-being-published.md)） |

`site`（行銷首頁、定價頁、`legal/`）**是預留的位置，還沒建立**。

**不上 turbo／nx。** `Dockerfile` 的測試映像與 CI 都走 `npm ci`，workspaces 不改那個動詞；package
只有兩三個，而 turbo 換到的是「幾十個 package 的相依圖與快取」。要付的是一份新的設定檔、一個新的
build 概念，還有一層跟 CI 之間的距離。

**根目錄的 script 一律轉給 package**（`"build": "npm run build:frond && npm run build -w app"`）。

## 為什麼要 monorepo

收費服務要有定價、隱私、條款、退款政策四個公開頁面（舊 repo 的 #83），
而那些頁面要被搜尋引擎讀得到，現在的 `index.html` 是一個空殼 SPA。那需要第二個 deploy target，而
第二個 deploy target 需要第二個 package。

frond 搬進來（ADR-0017）是第二個理由，而它先到。

## app 與 worker 不拆

`worker/index.ts` 直接 import `../src/lib/merge` 與 `../src/lib/types`，`push.ts` 與 `authorize.ts`
也是。拆成兩個 package 就要多一個 `shared`，而那個 `shared` 會是「PWA 與 Worker 都需要的東西」，
也就是**現在的 `src/lib/` 再切一刀**，切的位置還會隨著功能移動。

換到的是什麼？兩個 package 各自的 `package.json`。它們的相依本來就沒有衝突（Worker 那邊靠
`tsconfig.worker.json` 的 `types` 與 `include` 在守，而那是型別層的守法，比 package 邊界更貼近真正
的風險）。

## 根 script 轉給 package 是為了 deploy 那三格

Cloudflare Workers Builds 的 build configuration 在 **dashboard 裡**，不在這個 repo 裡
（[deployment.md](../deployment.md) 第 7 節）。它記著 root directory `/`、build command
`npm run build`，以及**兩個** deploy command：`main` 走 `npm run deploy:ci`，其他分支走 preview。

如果根目錄不留這些轉發的 script，佈局一改那幾格就對不上，而**改它的人跟改 repo 的人不在同一個
地方**：PR 一推上去就會觸發一次 build，那次會用舊的設定跑，然後失敗。

**這條規則有一個附帶要求，而它第一次就被違反了**：dashboard 裡的每一格都必須是根目錄的 npm
script，不能是直接叫工具。preview 那格原本是 `npx wrangler versions upload`，它在根目錄找
`wrangler.jsonc`，而那個檔案搬進 `packages/app/` 了，於是第一個 PR 的 preview deploy 就死在
`Missing entry-point to Worker script`。改成 `npm run versions:upload` 之後才回到「佈局怎麼變都跟
dashboard 無關」。

## 一份 lockfile，一個 node_modules

npm workspaces 把相依 hoist 到根目錄，所以兩個 package 的 `typescript`、`vitest`、
`@playwright/test` 是同一份。這不只是省磁碟：**版本一致本來就是要的**，兩個 package 用不同版的
TypeScript type-check 同一段程式碼，是那種「這台機器過、那台不過」的來源。

代價是相依的範圍要對得起來。frond 原本 pin 精確版號（`@types/node: 26.1.1`）而 app 用範圍
（`^26.2.0`），兩個都留著的話 npm 會裝兩份。搬進來的時候對齊到同一個範圍。

app 對 frond 的相依寫成 `"@yurenju/frond": "*"`，不是精確版號。npm **不支援 `workspace:` 協定**
（`EUNSUPPORTEDPROTOCOL`），所以只能用一般的範圍，而範圍要選寬的：寫死 `0.4.15` 的話，哪天有人動了
`packages/frond` 的 `version`，npm 就會**改去 registry 抓**而不是連 workspace，那是個安靜的錯誤。
`*` 讓本機那份永遠滿足條件。
