<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/tidemarks-wordmark-dark.svg">
    <img src="docs/brand/tidemarks-wordmark.svg" alt="Tidemarks" width="340">
  </picture>
</p>

Local-first 的 epub 閱讀 PWA。資料存在瀏覽器的 IndexedDB，離線可讀可寫；可選配 Cloudflare Worker 做跨裝置同步（用 passkey 登入，或收一封信裡的登入碼，兩條路都不用密碼）。

**你可以自己架一份。** 原始碼公開就是為了這件事——[docs/deployment.md](docs/deployment.md) 教你在自己的 Cloudflare 帳號上架起來，走的跟官方那台是同一條路。

**[app.tidemarks.io](https://app.tidemarks.io) 是維護者跑的那一台。** 其他任何一份部署，不管它叫什麼名字，都是別人的——所以要認的是主機名。

English: [README.md](README.md)

## 功能

- 多本書庫：拖放或選檔匯入 epub，書架顯示封面、進度、累計閱讀時長與場次
- 閱讀器：左右翻頁（含方向鍵）、目錄跳轉、自動續讀上次位置
- 劃重點：選取文字後選顏色標記，可附加筆記；重點側欄依書中順序列出、點擊跳轉
- 閱讀統計：每次開書自動記錄 session，累計時長與場次
- 匯出：單本書筆記匯出 markdown；完整資料（含 epub 檔本體）匯出 JSON，換瀏覽器可匯入接續
- 同步（選配）：電腦匯入的書自動出現在手機書櫃，進度、重點筆記、閱讀統計跨裝置互通；epub 本體點開才下載

## 往哪裡去

上面第一段講的是今天真的能用的東西。名字指的是另一個方向：潮痕是潮水退了以後留下來的痕跡，
而這個 app 想做的，是收下閱讀留下來的那些東西。讀得順是基礎，真正要做好的那一半是你寫下來
的部分。

從這個定位會長出兩件事，**兩件都還沒有對應的程式碼**：

- **一則筆記不該綁著一本書和一段選取。** 今天的筆記是掛在螢光上的一段字，而螢光又綁著某一本書
  的某一段範圍。上面講的那種筆記，這兩個都不需要。
- **來源不會只有 EPUB。** 文章、影片也要放得進來。

這兩件是立場，不是時程表。寫下來是為了讓「這件事在不在方向上」有個地方可以對照——名字是怎麼
逼出這個問題的，見 [ADR-0029](docs/adr/0029-the-app-is-called-tidemarks.md)。

## 開發

```sh
npm install                # 安裝相依
npm run dev                # 開發伺服器
npm test                   # vitest —— 決策模組的純邏輯，跑在 Node
npm run test:container     # 兩個 runner 都跑（Vitest + 三家瀏覽器），動到 reader 就跑這個
npm run build              # 型別檢查 + 產出 dist/
```

測試分兩層：`npm test` 蓋純邏輯（方向反轉、TOC 攤平、highlight 裁切、settings 對映），
`npm run test:container` 在容器裡用 Chromium／Firefox／WebKit 真的開一本真的書翻頁、劃重點、拖
Scrubber。那一層的斷言是容器裡的數字，所以入口是 `test:container` 而不是 `test:browser`。
第三層在 host 上用 playwright-cli 跑（[docs/agents/verify.md](docs/agents/verify.md)），蓋自動化蓋
不到的（需登入的 sync、真機手勢）。開 PR 的規則見
[docs/agents/pull-requests.md](docs/agents/pull-requests.md)。

## 技術

Vite + React + TypeScript、[frond](packages/frond/README.md)（渲染與 CFI 定位；直排與橫排等
價，三家瀏覽器等價驗證）、[Dexie](https://dexie.org/)（IndexedDB）。

渲染層原本是 epub.js，之後是它的 typed fork `@likecoin/epub-ts`，現在是 frond ——
frond 是為了 Tidemarks 寫的，把「直排要自己打補丁」那半個 `src/lib/` 收回 library 那一側。
見 [ADR-0003](docs/adr/0003-epub-ts-to-frond.md)。

這個 repo 是 npm workspaces 的 monorepo：`packages/app` 是 PWA 與 Worker，`packages/frond` 是渲染層。
frond 發到 npm 到 0.4.15 為止，之後就住在這裡——見
[ADR-0017](docs/adr/0017-frond-moves-in-and-stops-being-published.md) 與
[ADR-0018](docs/adr/0018-one-repo-many-packages.md)。

後端：Cloudflare Workers + D1 + R2、[@simplewebauthn](https://simplewebauthn.dev/)（passkey）。

部署：[docs/deployment.md](docs/deployment.md)

為什麼會有這個東西：[docs/intent/2026-07-15-spine-cross-device-reading.md](docs/intent/2026-07-15-spine-cross-device-reading.md)

## 關於貢獻

原始碼公開換到的是一條退路：哪天官方那台收掉了，你的書櫃所在的這個閱讀器你還是架得起來
（[ADR-0009](docs/adr/0009-open-source-buys-an-exit-not-contributions.md)）。經營一個開源社群
是另一回事，現階段的心力先放在自己把東西做出來。

所以話講在前面：issue 會看，但 pull request 不太可能及時得到回覆，有些會完全沒有回應。與其讓
你從沉默裡自己猜，不如直說。要 fork 沒問題，授權是 MIT；想提功能的話，上面〈往哪裡去〉那節
就是可以拿來對照的東西。

## 授權

MIT，全文在 [LICENSE](LICENSE)。這個 repo 收錄或引用的第三方素材列在
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
