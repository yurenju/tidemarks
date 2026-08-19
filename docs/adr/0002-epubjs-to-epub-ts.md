# 用 epub.ts 取代 epub.js

閱讀引擎從 `epubjs` 換成 [`@likecoin/epub-ts`](https://github.com/likecoin/epub.ts)（同 API 的 TypeScript rewrite，drop-in）。

觸發點是一個一直修不好的位置 bug：字級調到 160% 時，在某頁按 refresh 會跳回上一頁（100% 時較少但仍會）。診斷發現 `rendition.display(cfi)` 能對到正確 section，卻把畫面定位到該 section 的第 0 欄，而非該 CFI 實際所在的那一欄——欄位偏移沒被套上。這是 epub.js 多欄分頁下 CFI→viewport offset 解析的老問題，且 epub.js 已無積極維護。我們在自家 code 反覆嘗試修正都失敗，而該用法（`display(saved.cfi)`）本身是標準的，bug 落在 library 內部。

**取捨**：我們選了一支社群 fork 而非大家熟悉的 canonical library。理由是 epub.ts 三項嚴格更優：①重寫過的 locations 引擎（大書 43s→159ms），本就可能帶掉此 bug；②可讀的 typed source，真要 patch 內部偏移邏輯遠比讀 epub.js 容易；③活的上游（積極發版），能開精確 repro issue。捨棄的方案是「留在 epub.js 自己寫欄位偏移重算的 workaround」——那正是先前失敗的路，期望值低。

**這不是 revert-gated 的實驗**：即使 drop-in 沒當場修好位置 bug，也留在 epub.ts 上繼續修，不退回 epub.js。因為就算 bug 這次沒解掉，換到更好維護、更好修的 library 本身就是賺的。

**已知風險**：我們對 epub.js 有幾處私有內部的 reach-through（`manager.container`、`manager.layout.delta/height`、`rendition.book`），全關在 [navigator-port.ts](../../src/lib/navigator-port.ts) 與 [scrubber-epub.ts](../../src/lib/scrubber-epub.ts) 兩個 adapter 裡。這些不算 public API，rewrite 可能改結構，而且是 `as unknown as` 穿透、TypeScript 抓不到 drift。驗證只能靠 preview 在 runtime 確認翻頁／直排／Scrubber／TOC 仍正常。
