# frond

渲染層，Tidemarks 這個 monorepo 底下的一個 package。這份只講 frond 自己的規矩；語言慣例、package 佈局、
測試分層那些整個 repo 共用的，在根目錄的 `CLAUDE.md`。

## 這個 package 裡有什麼

```
src/       @yurenju/frond 的原始碼，核心，零相依（ADR-0005）
tests/     兩個 test runner（ADR-0009 切的是 Node 與瀏覽器）
scripts/   這個 package 自己的工具
docs/      frond 的 ADR 與量測紀錄
```

曾經有第二個套件 `@yurenju/frond-react`（一組 unstyled 的 React 元件），2026-07-30 收掉：唯一的
消費端從來沒有 import 過它一行，而它的 `paging.ts` 跟 app 的 `navigator.ts` 是同一件事的兩份實作。
**不要把它加回來，也不要另外開一層放 UI 政策**：ADR-0002 的拒收現在是絕對的，frond 裡沒有任何一層
擺得下預設的 UI 政策。

`@yurenju/frond` 曾經發到 npm，停在 0.4.15，現在是 private
（[ADR-0017](../../docs/adr/0017-frond-moves-in-and-stops-being-published.md)）。

## 邊界：拿不到的事實才補，繁瑣不算

**frond 吐事實，app 做政策**（ADR-0002）。以前擋著違規的是「要改 frond 就得開另一個 repo 的 PR、
等 merge、等發版」那道摩擦，現在那道摩擦沒有了，所以怎麼分要自己講得清楚：

> **app 拿不到只有 frond 知道的事實 → frond 補上那個事實，決定權留在 app。
> 只是繁瑣 → 留在 app。**

app 只從 `@yurenju/frond/epub` 與 `@yurenju/frond/renderer` 這兩個公開入口進來。反方向**沒有相依**：
`src/` 的出貨相依是零，`packages/app` 不會出現在這裡的 `package.json` 裡，也不要為了測試從相對路徑
import 它的東西。要看某個事實在消費端怎麼被用，直接讀 `../app/src/`。

## `src/` 的出貨相依必須是零

而那不是靠 review 守的，三道機制是 `tsconfig.build.json` 的 `"types": []` 與 `"paths": {}`，加上
`scripts/finish-build.ts` 掃 `dist/`、**從 `package.json` 的宣告推導放行清單**。在 `src/` 底下加一個
npm 相依，紅的是 `npm run build`。

第三道那個「從宣告推導」是刻意的：手寫的放行清單會腐爛，而且腐爛的方向永遠是「放太寬」，沒有人會
在移除一個相依之後回來收窄它。從宣告推導之後，「出貨產物 import 的東西」與「`package.json` 說它相依
的東西」被綁成同一件事，而 frond 兩者皆空，所以規則對它讀作「一個 bare specifier 都不行」。

實際擋下東西的是第一道與第三道；`"paths": {}` 目前是 no-op，它留著是為了擋將來被加進去的對應。別
因為「反正它沒作用」就把它拿掉。

這件事搬進 monorepo 之後更要緊：`dist/` 是 app 唯一 import 得到的東西，而那道檢查就在出口上。

## 跑東西

**指令都從 monorepo 的根目錄跑**，不要在這個目錄底下跑 npm。

```
npm run build:frond                    # 產出 dist/，app import 的就是它
npm run build:watch -w @yurenju/frond  # 一邊改一邊看（跳過出口檢查，那是 build 的事）
npm run typecheck -w @yurenju/frond    # tsc 掃 src、scripts、tests
npx vitest run --project frond         # 只跑 frond 的 Node 測試
npm run test:container                 # 全部：三個 vitest project 加兩套瀏覽器測試
```

⚠️ **`test:container` 在你的機器上只跑 chromium**，三家是 CI 在跑
（[ADR-0039](../../docs/adr/0039-three-engines-are-ci-s-job-not-the-local-loop-s.md)）。**改 frond 的
`src/renderer/` 的時候這件事最要緊**：三家對直排的歧見正是這個 package 存在的理由，所以動到渲染就把
三家點名跑一次，不要等 CI：

```
npm run test:container -- --project=chromium --project=firefox --project=webkit
```

需要縮小範圍時用 npm 的 `--` 傳參：

```
npx vitest run --project frond -- tests/node/test-fixtures/epub-version.test.ts
npm run test:container -- --project=firefox
```

改完 frond 記得 `build:frond`，不然 app 那邊拿到的還是上一版的 `dist/`。根目錄的 `dev`、`build`、
`test` 都會先做這件事，直接跑 `npx vitest` 不會。

### 瀏覽器測試只在容器裡跑得動

三家瀏覽器只存在於測試映像裡（`Dockerfile` 設了 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`）。在 host 上
直接跑 `npm run test:browser -w @yurenju/frond` 會得到 `browserType.launch: Executable doesn't exist`。
**那不是「這台機器不能跑瀏覽器測試」，是跑錯入口了**，正確的入口是 `npm run test:container`。

frond 那半在容器裡是用 `--network=none` 跑的：所有頁面都由 Playwright 的 route interception 供應，
所以它同時證明了沒有任何一條測試偷偷依賴外面的連線。app 那半不能這樣跑，它要 loopback。

### 找「合成 fixture 上全綠、書上壞掉」的那類缺陷：`scan:books`

```
FROND_BOOKS=/path/to/books npm run scan:books -w @yurenju/frond -- tests/browser/evidence/<名字>.spec.ts
```

書由 `FROND_BOOKS` **唯讀掛進**測試容器（掛在 repo 根目錄的 `tests/books/commercial`，已 gitignore），
不進 build context 也不落在 repo 樹裡，那些書有版權（ADR-0007）。

這一趟的產出是**病症清單，不是紅綠燈**：找到的每一項要各自變成一份合成 fixture 與一組測試，回歸才
守得住。上一次跑的結果與它抓到的三個病記在 ADR-0007 的〈第三層跑過一趟了〉。掃描用的 spec 是一次性
的，放 `tests/browser/evidence/`，不留在 repo。

## fixture 的位元組是釘死的

`determinism.test.ts` 與 `committed-fixtures.test.ts` 在守。任何會進到產出物裡的字串都不能改，改了
整批幾何數字會漂，而漂動的原因與程式碼無關。改完跑一次 `npx vitest run --project frond` 就看得出來。

CJK 在這裡常常**不是可以翻譯的文字而是資料**（fixture 的日文散文、`lang` 屬性、註解裡為了說明字形而
引用的 `骨`）。怎麼分與例外見根目錄 `CLAUDE.md` 的〈程式碼用英文，文件用中文〉。

## 這個 package 的 ADR 自己編號

`docs/adr/` 從 0001 起，跟 Tidemarks 的 `docs/adr/` **編號重疊**。引用一律寫成 `frond ADR-0002` 這個
形狀，指 Tidemarks 那套的時候寫 `ADR-0017` 加相對路徑。

決定變了就**改寫原本那一份**，不開新編號（`docs/agents/domain.md`〈一個問題只有一份 ADR〉）。⚠️ 但
**問題換到 Tidemarks 那一套的時候是開新的**，這裡的編號空著：ADR-0008 與 ADR-0011 就是這樣空的，
接手它們的是 Tidemarks 的
[ADR-0017](../../docs/adr/0017-frond-moves-in-and-stops-being-published.md)。
