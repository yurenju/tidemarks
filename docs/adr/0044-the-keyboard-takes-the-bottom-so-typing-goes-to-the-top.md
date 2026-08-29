# 虛擬鍵盤拿走畫面下緣，所以打字的地方站在上緣

日期：2026-08-30。

## 決定

**任何有輸入框的介面，都貼在可用區域的上緣。**「可用區域」是那個介面被分到的那一塊：手機上是整個畫面，平板與桌機上是面板佔的那一欄。

因此筆記的編輯區在手機上貼著畫面頂端、在桌機上貼著右欄的頂端，而不是像面板本身那樣從底部升起。

**不去問虛擬鍵盤有多高。** 不監聽 `visualViewport`、不算鍵盤 inset、不等 `interactive-widget`。

## 為什麼不去問鍵盤有多高

iOS 有兩件事我們改不動。

**一、版面完全不知道鍵盤來了。** iOS 的預設行為在規範裡叫 `resizes-visual`：鍵盤彈出時 layout viewport 一動也不動，只有 visual viewport 縮小又位移。WebKit 自己的 layout test（`fast/visual-viewport/ios/bottom-bar-with-keyboard`）印出同一刻的兩個矩形：

```
Layout viewport: {top:0,   width:320, height:548}
Visual viewport: {top:375, width:220, height:173}
```

所有 viewport 長度單位都是從 layout viewport 導出的，所以 `100vh`、`100dvh`、`100svh`、`100lvh` 碰到鍵盤的時候是同一個數字，四個都不動。CSS Values 4 把這件事寫成規範，而且點名了鍵盤：

> UAs may have some dynamically-shown interfaces that intentionally overlay content and do not cause any shifts in layout — and therefore have no effect on any of the viewport-percentage lengths. (Typically on-screen keyboards will fit into this category.)

`position: fixed; bottom: 0` 貼的也是那個沒縮的底邊，所以它會被蓋住。這就是筆記面板原本站的位置。

**二、游標被蓋住時，iOS 會捲走整個頁面。** `WKContentViewInteraction.mm` 的 `_zoomToRevealFocusedElement` 動的是外層 scroll view 的 content offset，在 web 這一側就是 `window.scrollY`。所以面板不只被蓋住，還會被整個推出畫面上緣。

唯一知道鍵盤高度的來源是 `visualViewport`，走那條路要處理鍵盤動畫期間的中間值、pinch-zoom 造成的位移、以及 iOS 26 上又冒出來的一個老問題（收鍵盤之後 `offsetTop` 不歸零），而且每一版 iOS 都要重驗一次。真的在做這件事的開發者公開說它「still unreliable」。

**貼上緣就沒有這個問題了。** 游標本來就在鍵盤蓋不到的地方，所以 `_zoomToRevealFocusedElement` 沒有事情要做。

## 為什麼規則寫成「可用區域」而不是「手機」

因為虛擬鍵盤不是手機獨有的，而且它的高度不只一種：

- **iPad 的浮動鍵盤與分離鍵盤**，規範說結果是非矩形時「behavior is user agent defined」，而 WebKit 的 `_contentRectForUserInteraction` 一律只把鍵盤高度當成底部 inset 扣掉，旁邊掛著 `// FIXME: handle split keyboard`。
- **接了實體鍵盤**也一樣會縮：`resizes-content-hardware-keyboard` 那支測試量到 viewport 被縮到 shortcut bar 的上緣。「沒有軟體鍵盤」不等於「沒有東西吃掉高度」。

規則如果寫成「手機直式的時候怎麼樣」，上面每一種情況都要再寫一條。寫成「貼可用區域的上緣」，它們全部落在同一句話底下，而且不必知道任何一種鍵盤有多高。

## 量到的數字

iPhone 393×852pt，注音鍵盤含上方工具列 375pt，佔螢幕高度的 44%。

| | 直式 | 橫式 |
| --- | --- | --- |
| 鍵盤上方可用高度 | 418pt | 178pt |
| 面板高度上限 `min(70vh, 36rem)` | 576pt | 275pt |
| 放不下的部分 | 158pt | 97pt |

重驗的方法：錄一段真機操作，逐格量鍵盤上緣的位置。⚠️ **不要用 Artifact 或任何 iframe 裡的頁面量**，iframe 的 `visualViewport` 不會因為鍵盤而縮，讀數會全部是零而且看起來很正常。

## 這筆帳付給誰

兩處已經寫下來的話被改掉，集中列在這裡，免得之後有人讀到舊句子以為還算數。

1. **「面板在手機上從底下升起」**（`CONTEXT.md`〈面板〉）。錨法本身還在，但編輯狀態不跟著走：面板從底部升起的時候，它裡面的輸入框仍然貼在它自己的上緣。窄畫面上面板佔滿整個畫面之後，那個上緣就是螢幕的上緣。
2. **「面板與 sheet 共用一個元件，分岔只在錨在哪一邊、swipe 的方向、以及寬度」**（[ADR-0023](0023-width-places-things-pointer-sizes-them.md)）。仍然是一個元件，錨法從兩種變成三種：寬畫面是右邊一欄，窄畫面上〈目錄〉與〈筆記〉佔滿整個畫面、〈排版〉留在底部升起。三種全部由 CSS 決定，所以「版面不等 JavaScript」那條沒有動到。

## 代價

**「完成」跑到了拇指搆不到的地方。** 單手拿手機的時候，畫面上半部要換手或伸長。換到的是輸入框全程看得見，而讀者按「完成」之前會先打字，打字的時候手本來就在鍵盤上。真正把這筆代價抵掉的是另一個決定：失去 focus 就存，所以那顆鈕只剩「收起編輯」這一個功能，而 iOS 鍵盤自己就有打勾。

**那塊留白是防的，不是修的。** 鍵盤收起後畫面底部剩下約 152pt 的空白，算出來的溢出量是 158pt，兩者接近，但**成因沒有被證實**。第一次量測跑在 iframe 裡而失效，而「iOS 收鍵盤後會不會自己把 `scrollY` 捲回去」查不到一手答案。所以程式裡做的是 focus 前記住、blur 後還原，那是一道防線而不是根治。真的要確認，得在真機上接 Safari 網頁檢閱器讀 `scrollY`。

**這支 ADR 有保存期限。** WebKit 在 2026-08-13 把 `interactive-widget` 的 flag 打開了，出貨之後 iOS 就能用一行 meta 讓 layout viewport 自己縮。但那時候這條規則仍然是對的：一個貼在上緣的輸入框，在 layout viewport 會縮的世界裡也沒有壞掉，只是不再是唯一的做法。所以那天到了不必回來改，只是可以少防一點。
