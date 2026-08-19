# 測試用書

跨瀏覽器 reader 測試用的書，兩本公版加兩本自己寫的。**這是 repo 裡唯一可以放的書**——手上流通的
商業 epub 一律不進 repo，而且這個 repo 是公開的，放進來等於直接散布出去。要用實際
書驗，書留在硬碟上原本的位置就好，收尾驗證直接從那裡上傳，見 `docs/agents/verify.md`。

| 檔案 | 用途 |
| --- | --- |
| `kusamakura-vertical-japanese.epub` | 直排日文——草枕／夏目漱石。ruby、傍點、ppd=rtl。直排是本專案的硬需求，所有方向反轉的測試都靠它 |
| `alice-in-wonderland-horizontal.epub` | 橫排英文——Alice。圖文混排 |
| `weiguang-ji-horizontal-chinese.epub` | 橫排繁中，兩章。要一本「就是中文」的書時用它 |
| `emphasis-weight-500-chinese.epub` | 橫排繁中。**中文書怎麼做強調**：`.sans` 同時換字族與把字重提到 500，另有 300 與 600 兩段當對照。字重那一類的變更靠它才看得出來，而市售書拿來截圖不能用（那些圖是公開的，見 `docs/agents/pull-requests.md`） |

後兩本是自己寫的，內文也是自己寫的，所以可以公開重製，跟前兩本一樣。

兩本原本是 frond 的 `tests/books/public/`（含它把 Alice 的 43 張插畫剪到 9 張以進得了 repo 的
處理）。frond 併進這個 repo 之後兩份檔案是同一份，就放在這裡，`packages/frond` 與 `packages/app`
的測試都讀它——所以**這個目錄的檔名不要改**，兩邊的測試都是照名字找的。出處與授權見
`packages/frond/docs/adr/0007-test-fixtures.md`——兩本都可公開重製。

為什麼是實際的書而不是合成 fixture：Folis 測的是「使用者操作一本真的書」這一層（開書、翻頁、
劃重點、拖 Scrubber）。合成 fixture 是 frond 那一層的工具，它要的是「一個檔案對應一種版面病症」；
到了 app 層，一本真的書才會同時帶著目錄、封面、ruby、圖版與足夠多的 section。
