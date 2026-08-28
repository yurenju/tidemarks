# chrome 的層與下緣

兩件事，同一條 bar：讓 chrome 在視覺上是**另一層**，以及讓手機上的 Scrubber 離開**系統手勢區**。

> **2026-08-22：底下寫的顏色與陰影已經不算數了。** 視覺方向換成 Indigo Dye，`--accent` 改名
> `--tide`（而且從綠變藍），`--shadow-*` 整組移除，「浮起來」現在由表面階數說。版面、尺寸與
> 行為那幾段不受影響。值的正本在 `packages/app/src/index.css`，規則在
> [docs/design-system.md](../../design-system.md)，理由在
> [ADR-0022](../../adr/0022-the-interface-is-a-print-shop.md)。

「chrome 浮一階」這個決定本身在
[ADR-0028](../../adr/0028-chrome-floats-one-step-above-the-book.md)，這裡不重述理由，只寫規格與
量得到的數字。畫面上有什麼、狀態怎麼走在 [ux-replan/spec.md](../ux-replan/spec.md)；斷點與
指標判斷在 [device-sizing/spec.md](../device-sizing/spec.md)。

## 一、chrome 是另一層

三條 bar 的底色是 **`--surface-raised`**，不是 `--surface-page`。

| | `.chrome-top` | `.chrome-nav` | `.chrome-bottom` |
| --- | --- | --- | --- |
| 底色 | `--surface-raised` | `--surface-raised` | `--surface-raised` |
| 陰影 | 無 | 無 | 無 |
| 髮線 | 留著 | 留著 | 留著 |

不分主題、不分螢幕大小：**三條一致，兩個主題一致，桌機手機一致。** 顏色分家會讓同一個狀態
〈找〉的三個部分看起來是三個不相干的東西。

### 跟著換面的兩個東西

換掉一條 bar 的底色，就要換掉所有「靠跟那張紙同色來隱形」的東西。有兩個：

| | 原本 | 改成 |
| --- | --- | --- |
| Scrubber thumb 外圈的環 | `--surface-page` | `--surface-raised` |
| `:focus-visible` 的暈 | `--surface-page` 寫死 | `var(--halo, var(--surface-page))`，三條 bar 自己設 `--halo` |

兩個都是**洞，不是顏色**，它們靠的是跟背後那張紙同色。留著舊值的話會在較深的 bar 上畫出一圈淺色
光暈，而焦點暈那一個踩在全 app 最常被鍵盤走到的四顆按鈕上。兩個都不在 accessibility tree 裡，
只有量得出來。

`.scrubber-preview` **不改**：它 `bottom: 100%` 浮在 Scrubber 上方，對調之後那個位置是書而不是
bar，所以 `--surface-page` 仍然是它背後那張紙。它另外有 1px 的 `--line-firm` 與 `--shadow-panel`。

### 不在範圍裡

〈標〉狀態那條顏色列不在這個範圍裡。它貼著選取、位置是算出來的，跟 chrome 互斥（CONTEXT.md
〈chrome〉），本來就不是同一層。

## 二、`.chrome-bottom` 內部的順序

Scrubber 在上，章節名在下。

```
┌─────────────────────────────┐
│  ●──────────────────○       │  ← Scrubber（軸）
│      I: Down the Rabbit-Hole │  ← 章節名，置中
└─────────────────────────────┘
```

**桌機手機一致。** 順序分兩套的話，日後每次動這條 bar 都要想兩遍；而桌機把章節名放在軸下面也
說得通，軸是主角，章節名是它現在指到哪的註解。

**章節名置中。** 兩個理由：

1. Scrubber 對直排／RTL 書會鏡像（[ADR-0001](../../adr/0001-scrubber-mirrors-for-vertical-books.md)），
   rail 的頭尾左右對調。靠左的文字壓著一條會翻面的軸，方向上是打架的；置中沒有方向。
2. 對調之後它是 running head，不是一行標題，而印刷書的頁眉本來就置中。

**已知的代價，接受：** `.reader-chapter` 有 `text-overflow: ellipsis`，文字塞滿時置中沒有效果。
所以短章節名會置中、長章節名看起來靠左，對齊方式隨章節名長度變動。兩種狀態都可讀，而且沒有
第三種。

DOM 順序就是視覺順序，**不用 CSS 的 `order`**：`order` 會讓 tab 與螢幕閱讀器的次序跟看到的不
一樣。

### 章節名那一行永遠佔位

封面不屬於任何章節，所以那裡沒有話說（CONTEXT.md「沒話說就不說」照舊，`aria-hidden`）。但**那一
行的高度要留著**，`min-height: calc(var(--type-note) * var(--leading-text))`。

原本是整個元素不 render，兩個後果：

1. bar 少一行，rail 從 56px 掉回 29px，**又回到手勢帶裡**。第三節整套做法在封面上等於沒做。
2. 讀者從封面翻進第一章的那一下，bar 突然長高、**rail 在拇指底下跳位**，而那正是他們正要伸手去
   碰它的時刻。

兩個狀態各自截圖都看不出來，只有在切換的那一格才成立。

## 三、下緣讓開系統手勢區

### 問題

Android 與 iOS 的螢幕下緣都是系統的手勢區（切換視窗、回主畫面）。**Android 的
`setSystemGestureExclusionRects` 只對左右邊有效，底邊排除不掉**，不是調參數能解的，只能把控制項
移上去。

在瀏覽器分頁裡，瀏覽器自己的工具列擋在下面，等於白送一段緩衝。**PWA `display: standalone` 底下
那段緩衝沒有了。**

改之前的數字，390×844、`any-pointer: coarse`（thumb 22px）：

| | 距螢幕下緣 |
| --- | --- |
| rail 中線 | 17 px |
| thumb 底緣（含 2px 環） | **4 px** |
| 可觸區（`.scrubber-track`，22px 高） | 6–28 px |
| iOS home indicator 安全區 | 34 px |
| Android 上滑手勢帶 | 24–48 px |

整條可觸區都落在兩個平台的手勢帶裡面。

### 做法

**兩件事各換到一半：**

1. **對調**（第二節）把 rail 從整條 bar 的底部換到頂部，中線抬到約 40px。
2. **保底底部內距** `--chrome-bottom-safe`，掛在 `@media (any-pointer: coarse)`，值 12px。
   桌機不動。

改之後 rail 中線約 **52px**，清楚在手勢帶外面。`.chrome-bottom` 從約 58px 變成約 70px，
書在手機上少 12px。

### 明確不做：`viewport-fit=cover`

開了 `viewport-fit=cover`，iOS 就**不再自動內縮**，頂列會跑到瀏海／動態島底下，變成上下都要
處理。不開的話 `env(safe-area-inset-bottom)` 在 iOS 回傳 0，而 iOS 本來就已經內縮了，12px 的
固定內距剛好是缺的那段留白；Android 的手勢帶本來就不在 viewport 裡，缺的也是同一段。

所以這一輪**不引入 `env()`**，只加固定內距。要走到 edge-to-edge 是另一支 issue，那時候頂列、
`背景色`、橫放三件事要一起處理。

## 四、`theme-color` 跟著主題走

`<meta name="theme-color">` 在執行期跟著解析後的主題更新，值對齊 **`--surface-raised`**。

系統列在視覺上是頂列的延伸，同色才不會多出一條無意義的接縫。

manifest 裡的 `theme_color` / `background_color` 字面值**留著**，值不變：manifest 在任何 CSS
之前就被讀，它是安裝時與啟動畫面的 fallback，不是執行期的正本。

## 五、驗證

### 自動化

`packages/app/tests/browser/reader/hand-held.spec.ts` 加一條：390×844 下 **rail 中線離 viewport
下緣 ≥ 44px**。

44 而不是 52：52 是這組值算出來的結果，44 是這條規則要守的東西（Android 手勢帶的上界 48 減去
一點，並對齊 `--tap-min`）。測試要在數字被改回去的時候紅，不是在數字被微調的時候紅。

新增 `chrome-layers.spec.ts`，守第一節與第四節：三條 bar 同色、那個顏色不是書頁的、焦點暈是 bar
的顏色、`theme-color` 等於解析後的 `--surface-raised`、深色主題下這些照舊成立。

最後一項不只是重跑一次：`--surface-raised` 定義成 `var(--paper-250)`，`App.tsx` 讀得到十六進位
是因為自訂屬性在 computed value 那一刻就代換完了。哪天不成立，meta 會安安靜靜地掛上字串
`var(--paper-250)`，而 app 裡面看不出來。

跟著要改的既有斷言：

- `chrome-placement.spec.ts`「章節在 Scrubber 上面」→ 改成在下面。**這是一條守門測試**，改寫
  它要停下來看一眼：新的斷言守的是「章節名在軸下面、貼著它、而且不在頂列裡」。
- `hand-held.spec.ts`「entries 在 Scrubber 上面」的註解說「軸守著下緣」，改完之後軸不在下緣了，
  註解要跟著改；斷言本身照舊成立。

### 底列變高，`--chrome-slide` 就要跟著長

**這一條是測試找出來的，不是設計出來的。** `--chrome-slide` 是 8rem，而底列加了
`--chrome-bottom-safe` 之後，站在它上面、走同一段距離的 entries 停在畫面內 6px，收起來的時候書上
留著一條 bar 的邊。兩家引擎的 `hand-held.spec.ts`〈sends the entries back to the bottom edge〉同時
紅。

改成 **10rem**。那個 token 自己的註解早就寫好了規則：滑過頭花在畫面外，不用錢；滑不夠會留一條 bar
在書上。所以是加到「下次再往 bar 加一行也還夠」，不是加到剛好。

### 手動

`npm run test:container` 三家跑過之後，host 上用 playwright-cli 產四組截圖：淺色／深色 ×
手機／桌機。真機的部分看兩件事，都是自動化蓋不到的：

- PWA（加到主畫面）底下，拇指從 rail 拖到底，**不會觸發系統的回主畫面手勢**。
- 淺色主題底下 Android 的系統列不是黑的。
