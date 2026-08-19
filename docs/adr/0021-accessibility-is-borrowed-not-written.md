# 可及性用借的，不自己寫

日期：2026-08-12。

## 決定

引入 **`@base-ui/react`**（`~1.7.0`）當 headless 元件層，用在抽屜與閱讀器的浮層上。

**不換掉**三樣東西：6 個原生 `<select>`、`Scrubber`、`toolbar-position.ts`。清單與理由在
[docs/specs/ux-replan/spec.md](../specs/ux-replan/spec.md)。

注意套件名：`@base-ui-components/react` 已經 deprecated、凍在 `1.0.0-rc.0`，1.x 全部住在
`@base-ui/react`。

## 為什麼現在

盤點過 `packages/app/src/` 之後的事實：整個 `src/` **一個 `.focus()` 都沒有**。沒有 focus trap、
沒有 return focus、沒有 Esc 關閉、`index.css` 裡連一條 `:focus-visible` 都沒有。設定面板那層
`.panel-backdrop` 是全透明的、沒有 `role="dialog"`、沒有 `aria-modal`。

這些**壞掉的時候不會有人回報**。用鍵盤或讀螢幕軟體的人不會來開 issue 說「你的 dialog 沒有鎖焦點」，
他們只是關掉頁面。所以它是那種靠自律永遠補不完的東西：每一個新浮層都要重寫一次同樣的十件事，而
少寫一件沒有任何訊號。

這一輪要新增三個抽屜、重寫三個浮層，是**唯一一次不必為了引入而動工的時機**。那些元件反正要重寫。

## 為什麼是 Base UI，代價是什麼

它是 unstyled 的，**不帶 CSS**，靠 `data-attributes` 與 CSS variables 上樣式。現有的 959 行
plain CSS 與 8 個 CSS variable 不必動，也不必為了它引進 Tailwind。這是選它而不是選一個有樣式的
套件的主要理由：Folis 的樣式是產品的一部分，不是待替換的預設值。

付出去的是 **57 kB gzip**（`dialog` + `popover` + `slider` + `switch` + `tabs`，共用的 floating
核心只算一次），加上**一個上游**。上游那一項比位元組貴：它大約每月一個 minor，而 1.4.0 曾經整版
壞掉。所以版本範圍取 `~1.7.0` 而不是 `^`，升 minor 要是一個看得見的 commit。

## 那條會一票否決它的線，查過了

閱讀器上同時有自訂的翻頁手勢與 frond 在 iframe 裡的 `pointerup`。一個會鎖住整個畫面的元件庫在這裡
是不能用的，不管它多好。

查證的結果是**不觸發**：

- `modal` 是三值的（`true` / `false` / `'trap-focus'`）。那層 `position: fixed; inset: 0` 的攔截
  元素（`InternalBackdrop`）**只在 `modal === true` 才 render**。Popover 的預設本來就是 `false`。
- 整包**不寫 `touch-action`**（只有 scroll-area 的 scrollbar、drawer 的 swipe 區、number-field 的
  scrub 區三處，各自 scoped），**touch 事件上不呼叫 `preventDefault()`**。唯一的 `preventDefault`
  在 Esc 的 `keydown`。
- popup 開著時它會在 document 掛 capture 階段的 pointer 與 touch 監聽，但那些**只觀察、不取消**。

所以條件是：**閱讀器裡一律不用 `modal={true}`**。這一條寫進 spec，因為它是一個查不出來的規則，
違反了不會有 type error，只會在真機上變成「翻頁忽然沒反應」。

## 三樣不換的東西

**原生 `<select>` 留著。** 手機上它開的是作業系統的選單，那是 Base UI 的 `Select` 換不到的東西。
而且 `[select]` 有一條「開關時無限 render、主執行緒凍死」的 open issue（mui/base-ui#5358）還沒關。
這一項不是妥協，是原生比較好。

**`Scrubber` 留著自幹。** 它的語意是 commit-on-release（拖曳只動預覽、放開才跳）、rtl 鏡射、索引
沒建好就 disabled。那些是政策，不是 slider 的行為。但它現在標的是 `role="progressbar"`、鍵盤完全
操作不了，**那個要補**（`role="slider"`、`tabIndex`、方向鍵），而且那件事跟換不換 library 無關。
把「我需要一個 slider」跟「我需要一個可及的 Scrubber」分開，是這一段的重點。

**`toolbar-position.ts` 這一輪不動。** Base UI 的 `Popover` 要一個真的 DOM 元素當 anchor，而
highlight 的 anchor 是 frond 從 iframe 換算出來的矩形，不是元素。要換得先做一個 virtual anchor，
那是獨立的一件事，不該跟 UX 這一輪綁在一起。

## 反悔要付什麼

一個 runtime 相依會長進每個新元件，所以退掉的成本隨時間長。三個 PR 分開做正是為了這個：第一個 PR
只有兩個抽屜，是純搬家，如果 Base UI 在那裡就不對勁，第二個 PR 還來得及退回去，而要丟掉的只有兩個
抽屜的程式碼。
