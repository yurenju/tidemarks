# frond 擁有事實，spine 擁有政策

frond 負責「這本書在這個 viewport 下是什麼樣子、現在在哪裡」——解析、分頁、定位、直排幾何、資源解析、TOC href 解析。spine（或任何上層）負責「使用者怎麼操作它」——手勢、點擊分區、UI、同步。frond 只吐**事實**（`direction: 'rtl'`、`writingMode: 'vertical-rl'`、`fraction: 0.37`），不做任何互動決策。

這條線不是設計出來的，是 spine 在 epub.js 上流血流出來的。spine 的 `src/lib/` 有一半是在跟 library 打架的補丁，而每一個補丁都指向同一件事：責任該在 library 這邊，卻漏到了應用層。

| spine 的補丁 | 修的是什麼 |
| --- | --- |
| `vertical.ts` `detectVerticalBook` | epub.js 只讀 `<html>` 的 writing-mode，InDesign 書宣告在 `<body>` |
| `vertical.ts` `SCROLL_EPSILON = 4` | 分數 DPI 下 scrollTop 湊不滿，section 邊界永遠跨不過去 |
| `vertical-layout.ts` `verticalColumnCss` | column-width 必須等於一個 viewer 高且需 `Math.floor`，分數像素會讓分頁崩掉 |
| `vertical-layout.ts` `zeroBodyPadding` | 用 MutationObserver 持續對抗 epub.js 每次 relayout 塞回的 inline `!important` padding |
| `toc.ts` `resolveSpineHref` | nav href 把 `,` percent-encode 成 `%2c`，`spine.get` 對不到，點 TOC 靜默無反應 |
| `scrubber-epub.ts` `normalizeHref` | TOC href 的 `../` 前綴對不上 spine href |
| `navigator-port.ts` | 整檔存在的理由就是 epub.js 的 API 形狀不能直接用；`manager.container`、`manager.layout.delta` 全靠 `as unknown as` 穿透私有內部 |

最硬的旁證是 `resolveSpineHref` 與 `normalizeHref` ——「把 TOC href 解析到 spine section」這一件事，在同一個 repo 裡被獨立實作了兩次、解的還是不同病症、彼此不知道對方存在。這就是責任沒收進 library 的代價。上表所有項目都屬於 frond。

## Consequences

**`RenditionPort` 這個 interface 應該消失。** 它存在的唯一理由是「epub.js 的 API 不是我要的形狀，所以在外面再包一層」。frond 從第一天就長成上層要的形狀，就不需要這層轉接——**frond 自己就是那個 port**。`navigator-port.ts` 的 interface 可直接當作 frond 公開 API 的第一版草稿：它是被真實需求逼出來的，比白紙上的設計準。

**frond 必須自己提供 fake / in-memory 實作，並視為公開 API 的一部分。** `RenditionPort` 的另一半價值是「可用 fake 做單元測試」，這個好處不能隨著 port 消失而消失。上層測試 Navigator 這類純決策模組時，不該自己造假物。

**明確拒絕：frond 不吃手勢。** 直排時「往左滑 = 下一頁」看似 library 該知道的事，其實不是。frond 該說的是「這本書是 rtl」這個事實，上層該決定的是「所以左滑等於 next」這個政策。

拒絕的理由有兩條，而且**兩條都不依賴「frond 還有別的消費端」**——它就是為 spine 而做的：

**一、產品表面沒有邊界。** `Renderer` 沒有辦法只吃一半：接了 swipe 就得同時知道點擊
分區、選字中不翻頁、連結優先，接著是長按、雙擊、慣性、邊緣回彈。這串東西沒有天然的
盡頭，而 frond **無從得知 spine 對每一項的答案**。

**二、測試金字塔。** ADR-0005 的雙層切分（`EpubBook` 純 TypeScript、零 DOM）是解析層
能在 Node 裡測的前提。UI 政策一旦進核心層，pointer 語意就被拖進解析層那一側。反向也
成立：spine 的 `navigator.ts` 之所以能用一個兩方法的 fake 做單元測試，正是因為翻頁**決策**
不在 frond 裡；沉下去之後 spine 那些測試只能改成開瀏覽器。

**而這個拒收是絕對的。** 曾經有一層放得下「要 import 才生效的預設政策」——
`@yurenju/frond-react` 那組 unstyled 元件裡的 `useSwipePaging()` / `useKeyboardPaging()`。
那個套件 2026-07-30 收掉了（唯一的消費端從來沒用它），所以 frond 裡再也沒有任何一層擺得下
UI 政策，連預設值都沒有落點。

**手勢的推論需要事實，而事實在核心層是分開送的**：`Renderer` 送的是 `pointerdown` 與
`pointerup` 兩個獨立的事實（各自帶座標、`hasSelection`、`isLink`），「這是一次往左滑，所以是
下一頁」的推論在消費端完成。核心層不配對任何一組 down／up。

## 逃生閥：先問「痛的原因是什麼」

「這件 UI 的事在 spine 做很痛，是不是該搬進 frond」——這個問題會反覆出現，而且方向
是單向的，因為「放在 frond 裡比較方便」幾乎永遠成立。要問的是**痛的原因**：

| 痛的原因 | 修法 |
| --- | --- |
| spine 拿不到只有 frond 知道的事實 | **frond 補上那個事實**，決定權留在 spine |
| 這件事本身就繁瑣（很多情境、很多例外） | **留在 spine**。繁瑣不是搬家的理由 |

這條規則只能讓 frond 的 API 變豐富，不能讓政策往下沉——這是刻意的。它跟 ADR-0003
的介入門檻是同一個形狀：那邊「書醜不是介入理由」，這邊「繁瑣不是搬家理由」。

**section 邊界穿越就是第一類的範例，而且是這份 ADR 自己的歷史。** 當年 spine 要處理
「這一節讀完了、該翻到下一節」，痛的原因是它得讀 frond 內部的捲動幾何——那就是
`RenditionPort` 整層存在的理由。修法不是把翻頁交給 frond，而是讓 `next()` / `previous()`
自己走到隔壁 section。frond 多做完一件它本來就知道的事，「往左滑等於 next」仍然在
spine，而整層轉接消失了。

## 事實清單補一項：這本書是簡體還是繁體

`spine` 的 `chinese.ts` / `epub.ts` 現在自己做三件事：從 `readingOrder` 取前 N 字散文、
剝掉標籤、數簡繁對照表猜變體，最後挑字型堆疊。前兩件搬進 frond，第三件留在 spine。

切在這裡的理由是老的那條線：「這本書是簡體還是繁體」跟 frond 已經在吐的
`direction: 'rtl'`、`writingMode: 'vertical-rl'` 是同一類東西，而「所以要用
`'Noto Serif TC', 'PMingLiU', …`」是平台與產品的選擇。ADR-0003 的 0.5.0 修訂已經把後者
判給讀者設定（`genericFamilies`），這裡只是把前者收回來。

**推測也算事實，只要誠實回報不確定。** `detectVariant` 在沒有信號時回 `null`，這與
`detectVerticalBook` 讀 `<body>` 還是 `<html>` 的 writing-mode 同屬一類：都是推論，都是
frond 該做的推論。
