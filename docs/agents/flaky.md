# Flaky：CI 紅了，而重現不了

CI 紅燈裡有一種特別討厭：重跑就過了。這份文件管的就是那一種——怎麼認、怎麼分、記在哪裡。

## 先把這個詞定死

**flaky 標的是「這個紅燈重現不了」，是現象，不是判決。**

它**不是**「這個問題不重要」。這兩個意思很容易混用，而混用之後 `flaky` 就變成垃圾桶：貼上去等於
結案，沒有人再回來看。這裡不這樣用——貼上 `flaky` 只表示「原因還沒定」，帳單還開著。

## 原因只有兩種。機器忙不是其中之一

分兩層看，**原因**和**放大器**：

| 原因 | 是什麼 | 長相 | 修在哪 |
| --- | --- | --- | --- |
| **測試自身的 race** | 測試少等一個狀態，產品沒問題 | 常常是 **helper 自己爆掉**而不是斷言失敗：locator 抓到一個即將被換掉的東西、`evaluate` 死在 execution context 消失上 | 測試 |
| **偶發缺陷** | 產品真的偶爾會錯，測試忠實地抓到了 | **斷言失敗**，而且斷言的是產品行為本身 | 產品 |

**放大器**只有一個常見的：機器忙。它決定你**多常**看到，不決定**有沒有**。

### 放大器有時候是反的

**別把「忙的時候紅」當成放大器的定義。** 有些競態是機器**閒**的時候才踩得到，這種的方向相反，而且
因為違反直覺，很容易被誤判成「環境有問題」而不是「測試有 race」。兩個量到的例子：

- [#174](https://github.com/yurenju/folis/issues/174)——面板收合有一段 180ms 的 CSS transition，而
  `settled()` 沒有等容器停下來。單獨跑那一支 spec 時 `settled()` 在 180ms 內就回來了，量到還在滑的
  盒子；三家一起跑就慢過那個窗口，於是全綠。**CI 永遠是混著跑的，所以 CI 從來沒看到。**
- [#171](https://github.com/yurenju/folis/issues/171) 的舊形狀——`--workers=1` 紅 38%，`--workers=4`
  紅 25%。串跑反而更常踩中。

所以「壓低 `workers` 就綠了」這個滑坡有一個對稱的版本：**「跑整套是綠的」也不能拿來結案**。忙的機器
會**藏**這一類 race，不是掀出來。要判放大倍率就兩個方向都試，不要只往上加。

這一層之所以要跟原因分開，是因為混在一起會生出一個假的修法：

> 「壓低 `workers` 就不紅了」「換大一點的 runner 就好了」

那不是修好，那是把溫度計砸掉。一台慢的機器不會讓正確的程式出錯，它只會把本來就在那裡的競態掀到你
看得見的地方。**放大器可以調，但調完之後原因還在原地。**

兩個現成的例子：

- [#162](https://github.com/yurenju/folis/issues/162)——**測試自身的 race**。`settled()` 拿到 iframe
  的 `body` 之後，那個 iframe 在 `evaluate` 回來前就被換掉了。紅的是 helper，測試在斷言之前就死了。
- [#168](https://github.com/yurenju/folis/issues/168)——**也是測試自身的 race，但長得像偶發缺陷**。
  `resolveLayout` 被叫了兩次而不是一次，斷言失敗，斷言的又是產品行為，看起來滿足上表「偶發缺陷」的每
  一欄。查下去第二次是**隔壁那頁的 peek 掛載時問的**——掛載就是一次 layout，peek 會自己問一次，那是
  frond ADR-0013 說好的行為。測試在 peek 落地之前就把清單讀走了，讀到的是一份還在寫的清單。

第二筆是這份文件本來想拿來當「偶發缺陷」範本的那一筆，所以留著它比換掉有用：**斷言失敗不等於偶發
缺陷**。上表那一欄要讀成「斷言的是產品**答應過**的事」——一個測試如果在系統還沒安定的時候讀狀態，
它斷言的其實是時序，不是行為。分辨的方法只有一個，就是把第二次是誰觸發的查出來（#168 是靠在 resolver
裡印 stack）。

確定屬於「偶發缺陷」的那一筆是 [#173](https://github.com/yurenju/folis/issues/173)：reload 之後閱讀
位置落後兩次翻頁，因為記錄位置的 `db.progress.put()` 沒有 await，而它的 commit 在忙碌的機器上量到
p90 362ms、最大 1207ms——128 次翻頁裡有一次的寫入隨著頁面一起消失。斷言失敗、斷言的是產品答應過的
事、修在產品，三欄都對上。它跟 #168 的差別不在長相，在**查下去之後第二層的答案**。

兩份 issue 的內文都把「機器負載」寫成原因。**那一行是錯的**，正確的說法是那是放大器；#162 自己另一句
「把一個既有的競態放大到看得見」才是對的。留著是為了記得這個滑坡有多容易。#168 量到的放大倍率是
`--workers=1` 跑 40 次全綠、`--workers=16` 跑 40 次紅 12 次——同一份程式碼，兩個數字，原因一個都沒變。

## 綠燈的標準沒有因此放寬

兩份測試 config（[app](../../packages/app/playwright.config.ts)、
[frond](../../packages/frond/playwright.config.ts)）設的是：

```
retries: 1
failOnFlakyTests: true
```

`retries: 1` 讓 Playwright 重跑一次並把該次標成 flaky，`failOnFlakyTests` 讓**只要有 flaky 就整份
判紅**。所以嚴格度跟原本的 `retries: 0` 一模一樣，換到的只是一件事：**Playwright 現在會告訴你哪一條
不穩**，而不是留下一個紅燈讓人自己翻 log。

畫面巡檢的 [`playwright.sweep.config.ts`](../../packages/app/playwright.sweep.config.ts) **不套**，
維持 `retries: 0`。它一輪十分鐘、`workers: 1`，而它要回答的問題（「這 27 步還走得通嗎」）本來就不需要
重試來確認。

PR 和 main 的標準一樣嚴，不分開設。一旦 PR 可以帶著 flaky 進去，那些 flaky 會累積到 main 上再爆，
而 main 紅的時候誰負責是最模糊的。

## 帳本就是 GitHub issue

貼 **`flaky`** label。要看全部：

```bash
gh issue list --label flaky
```

**第一次紅就開**，不要等到「感覺常常紅」。artifact 只留七天，等你覺得值得記的時候，前幾次的 log
已經過期了——你等於把樣本丟光才開始採樣。

### 最小欄位（開票當下就要有）

門檻低到不痛為止，這幾樣就算數：

- **哪一支**：`檔案:行` 加測試名稱
- **哪一家引擎**：chromium／firefox／webkit，以及其他兩家同一輪是不是綠的
- **run URL**
- **錯誤前幾行**：包含它死在哪個檔案哪一行
- **原因**：測試 race／偶發缺陷／**未定**
- **放大器**：機器忙／未知

最後兩欄**允許寫「未定」**，那也是資訊。但**只填放大器不填原因的不算填完**——那正是上面說的滑坡。

### 開票之前先看一眼 `git log`

```bash
git log --oneline -8 -- <紅的那個檔案>
```

**「第一次紅就開」的門檻壓得很低是刻意的**（artifact 只留七天，等你覺得值得記的時候樣本已經沒了），
但低門檻有一個對稱的代價：修法可能已經在樹上了，而你補開了一張沒有人會發現已經結案的票。

這不是假想的。[#170](https://github.com/yurenju/folis/issues/170) 與
[#171](https://github.com/yurenju/folis/issues/171) 都是這樣來的——CI 紅是 08-13／08-14，修法在
`7c7ecab` 與 `981beea` 當天就進去了，而票是 08-18 補開的，兩張都寫著「原因未定」，其實原因四天前就
寫在 commit message 裡。代價是兩張開了四五天的殭屍票，以及後來各花半小時去證明「它已經好了」。

一眼就夠，不必查得徹底。有人修過就把那個 commit 寫進票裡，票照開——**因為修法在不等於有東西守著它**。
那兩筆查下去都發現沒有任何測試會因為修法被還原而變紅，補上那道守門才是它們真正的價值。

原因這一欄不做成 label，就是因為它常常一開始不知道。把還沒定案的東西做成 label，它會永遠停在錯的
值上，而且沒有人會回來改。

### 之後才補的

拿到更多樣本再往上疊：頻率表（跑幾次、紅幾次）、重現嘗試、為什麼認為跟某個 PR 無關。
[#162](https://github.com/yurenju/folis/issues/162) 和
[#168](https://github.com/yurenju/folis/issues/168) 是這一段該長什麼樣子的範本。

## 按「重跑」之前

**先看一眼是哪一條紅，並確認它在帳本裡**；沒有就照上面開一份最小的，再按。

看是哪一條紅走 Actions API，不要用 `gh pr checks`——Checks 那組在這個 repo 的 token 底下一律 403，
原因與對照表見 [pull-requests.md](pull-requests.md) 的〈盯 CI 到綠〉：

```bash
gh run list --branch <你的分支> --limit 5
gh api repos/yurenju/tidemarks/actions/runs/<run-id>/jobs -q '.jobs[] | "\(.name)\t\(.conclusion)"'
```

這是唯一能讓帳本不漏的機制——按鈕比開 issue 容易太多了，不定這條規矩，帳本一定漏。它沒有做成硬性
檢查（沒有擋住 re-run），因為那會變成擋路的官僚；它靠的是這份文件。

## 想知道一條 flake 有多敏感

`--repeat-each` 比重跑整套 CI 快得多。**在容器裡跑**，理由跟平常一樣（[CLAUDE.md](../../CLAUDE.md)
的〈測試分層〉：host 上的數字跟 CI 說的不是同一件事）。`test-in-container.sh` 會把參數同時餵給兩個
package，所以指定單一檔案的時候不能用它——直接對同一個映像下指令：

```bash
./scripts/test-in-container.sh --project=firefox
```

那一趟會把映像建到最新。接著要幾次就幾次（引擎照 `scripts/container.sh` 的順序，podman 優先、docker
是 fallback，兩個的參數在這裡一樣）：

```bash
podman run --rm --init tidemarks-test npm run test:browser -w app -- --project=firefox tests/browser/reader/paging.spec.ts --repeat-each=20
```

frond 那半要多帶 `--network=none`，理由見 `scripts/test-in-container.sh` 的註解。

跑**兩組對照**，第二組多加 `--workers=1`。不對照就分不出是「機器忙」還是「測試有 race」，因為
`--repeat-each` 本身就在製造負載。

再說一次，因為這裡最容易滑掉：**即使 `--workers=1` 那組全綠，那也只是量到放大倍率，不是把原因修掉
了。** 那個數字的用途是寫進 issue 的頻率表，不是拿來結案。
