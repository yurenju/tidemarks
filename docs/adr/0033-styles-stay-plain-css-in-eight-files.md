# 樣式維持原生 CSS，只拆成八個檔案

日期：2026-08-23。

## 決定

`packages/app/src/index.css` 從 2848 行拆成八個檔案，放在 `packages/app/src/styles/`，
`index.css` 只剩一份 `@import` 清單。

**不引入任何樣式方案**：不用 CSS Modules、不用 Tailwind、不用 CSS-in-JS、不用 vanilla-extract
那一類 build-time 的 token 系統。也**沒有加 `@layer`**（理由在最後一節）。

八個檔案是**原檔案的連續切片**，順序一行都沒動。拆完 build 出來的 CSS 與拆之前**位元組完全相同**
（Vite 算出來的內容 hash 一樣），所以這次改動證明得了自己沒有改到任何東西。

## 為什麼要拆

不是因為 2848 行「太多」。這個檔案本來就是有結構的——每一段前面都有一段講「為什麼」的註解，
`grep` 一個 class 名一次就中，**找東西從來不是問題**。真正付出代價的是另外兩件事：

1. **它超過單次讀取的上限。** agent 一次讀 2000 行，2848 行讀不完，想通盤理解要讀兩次、花掉
   將近 30k token。
2. **加新規則的時候不知道該放哪。** 而預設的答案（往檔尾加）在這裡剛好是最糟的一個：檔尾是
   寬度斷點區，加在那裡的規則只在寬視窗成立。

八個檔案裡最大的 515 行，兩件事都解掉了。

## 為什麼不用 CSS Modules

它解的是**命名衝突**，而這裡沒有命名衝突：120 個 class 選擇器，一個一個東西，沒有一個撞名。
付出的代價則有兩項，都是真的：

- **瀏覽器測試綁在 class 名上。** `.viewer-mount`、`.toc-item`、`.reader`、`.viewer`、
  `.scrubber-preview`、`.highlight-toolbar` 都直接出現在 `tests/browser/` 的 selector 裡，
  hash 掉之後這批全部要改寫。
- **`.viewer-mount` 是跨 package 的約定**——app 的樣式伸進 frond 的容器。那個約定靠一個穩定的
  class 名成立，換成 hash 就要用別的方式重新表達。

而且它幫不上最大的那一塊：token、暗色主題、`@font-face`、全域的 button／field／focus、四個寬度
斷點——**這些全部是全域的**，CSS Modules 一行都 scope 不了。

## 為什麼不用 Tailwind

**這份 CSS 的註解就是設計決定的正本。** `docs/design-system.md` 自己寫著「這份文件會過期，那個
檔案不會」——為什麼沒有影子、為什麼暗色的 `--surface-cover` 要比書頁亮、為什麼 focus 環畫在封面
外面，這些都住在規則旁邊。Tailwind 把樣式搬進 JSX 的 `className` 字串，那裡放不進一段解釋，
於是這批理由不是搬家，是消失。

其次它會帶進第二套詞彙。ADR-0022 的立場是一套很小、意義明確的詞（紙 6px、控件 3px、軌道 999px、
圓點 50%），而 `rounded-sm/md/lg` 是另一套；兩套並存的結果通常是兩套都不算數。

最後，這個 app 的樣式有一大票是不尋常的——直排、`any-pointer` 查詢、`clip-path` 切出來的箭頭、
iOS Safari 的 backdrop 修法。utility class 對常見情況很省，對這些會退化成一長串任意值，比原本的
CSS 更難讀。

## 為什麼不用 CSS-in-JS 或 vanilla-extract

CSS-in-JS 跟 Tailwind 同一個問題（註解無處可放），再加一個 runtime。這個 app 要離線開書、在意
首次繪製，沒有理由為了整理檔案付這個。

vanilla-extract 這類有一個誘因是真的：**token 有型別**。`lib/tokens.test.ts` 存在的唯一理由就是
抓 `var(--不存在的名字)`——CSS 對這種錯誤完全不出聲——而那正是型別系統該做的事。但代價是整個
token 層要改寫成 TS 物件，而那 466 行是整份設計註解最密的地方。用一支跑起來只要幾毫秒的測試，
換一整套建置系統，划不來。

## 為什麼沒有順便加 `@layer`

`@layer` 會讓「誰蓋誰」由 layer 決定，而不是由誰寫在後面決定。那對拆檔是有價值的：現在
`device.css` 之所以贏，純粹是因為它 import 在最後，這件事很脆弱。

沒有一起做，是因為它**不可能是純搬移**。layer 之間不能靠 specificity 互相蓋，所以某些現在「後面
那條贏」的地方跨了 layer 之後行為會變。混進一個動到 2848 行的搬移裡，就沒有人有辦法分辨哪些是
搬、哪些是改。

留在這裡當一個已知的下一步：真的痛了再做，而且要單獨做。

## 代價

- **`device.css` 必須是最後一個 import**，而這件事只有註解在守。它裡面 29 個選擇器在前七個檔案
  裡都已經設過，specificity 完全相同（media query 不加分），純粹靠順序取勝。
- **兩處分組是彆扭的**，因為切片必須連續：`.toc-item` 落在 `book.css` 而不是它的殼旁邊，一條
  `max-width: 30rem` 卡在標記工具列中間而不在 `device.css`。搬動它們是改行為，不是改位置。
- **元件檔案看不出自己被 `device.css` 改了什麼。** 緩解的做法是在真的被覆寫的那幾條規則旁加一行
  指路的註解，只說「去看 `device.css`」，不複述值——值會變，「被覆寫」這件事不會。
