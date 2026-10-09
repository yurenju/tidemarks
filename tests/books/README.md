# 測試用書

跨瀏覽器 reader 測試用的書，兩本公版加四本自己寫的。**這是 repo 裡唯一可以放的書**：手上流通的
商業 epub 一律不進 repo，而且這個 repo 是公開的，放進來等於直接散布出去。要用實際
書驗，書留在硬碟上原本的位置就好，收尾驗證直接從那裡上傳，見 `docs/agents/verify.md`。

| 檔案 | 用途 |
| --- | --- |
| `kusamakura-vertical-japanese.epub` | 直排日文：草枕／夏目漱石。ruby、傍點、ppd=rtl。直排是本專案的硬需求，所有方向反轉的測試都靠它 |
| `alice-in-wonderland-horizontal.epub` | 橫排英文：Alice。圖文混排 |
| `weiguang-ji-horizontal-chinese.epub` | 橫排繁中，兩章。要一本「就是中文」的書時用它 |
| `emphasis-weight-500-chinese.epub` | 橫排繁中。**中文書怎麼做強調**：`.sans` 同時換字族與把字重提到 500，另有 300 與 600 兩段當對照。字重那一類的變更靠它才看得出來，而市售書拿來截圖不能用（那些圖是公開的，見 `docs/agents/pull-requests.md`） |
| `novel-length-vertical-chinese.epub`<br>`novel-length-horizontal-chinese.epub` | 繁中長篇，直排與橫排各一本，**內文相同**。約 21 萬字、24 章，其中第十三章特別長（約 5 萬字）；ruby 與插圖的比例照繁中輕小說。給翻頁效能量測用（#261 量測長篇中文小說與大量重點下的翻頁效能），要一本「跟真的小說一樣長」的書時用它。由產生器產出，見下面 |

後四本是自己寫的，內文也是自己寫的，所以可以公開重製，跟前兩本一樣。

兩本長篇是**產生器產出的**，不要手改：產生器在 `packages/frond/scripts/novel/`，改完跑
`npm run novel -w @yurenju/frond` 重新產生。輸出是固定的（同一份程式碼產出同樣的位元組），所以沒改
產生器就重跑不會有 diff。反過來，改了產生器卻忘了重跑，frond 的 `committed-novel.test.ts` 會紅。
內文是從一份手寫的詞句庫照固定 seed 組出來的，讀起來不通順，但標點、對話、句長與段長的分布像小說，
而一頁要排多久，就取決於這幾樣。

兩本原本是 frond 的 `tests/books/public/`（含它把 Alice 的 43 張插畫剪到 9 張以進得了 repo 的
處理）。frond 併進這個 repo 之後兩份檔案是同一份，就放在這裡，`packages/frond` 與 `packages/app`
的測試都讀它，所以**這個目錄的檔名不要改**，兩邊的測試都是照名字找的。出處與授權見
`packages/frond/docs/adr/0007-test-fixtures.md`，兩本都可公開重製。

為什麼是實際的書而不是合成 fixture：Tidemarks 測的是「使用者操作一本真的書」這一層（開書、翻頁、
劃重點、拖 Scrubber）。合成 fixture 是 frond 那一層的工具，它要的是「一個檔案對應一種版面病症」；
到了 app 層，一本真的書才會同時帶著目錄、封面、ruby、圖版與足夠多的 section。
