# Folis 是暫名，上線前一次換掉

日期：2026-08-16。

## 決定

`Folis` 從現在起是**暫定的名字**。它繼續用在每一個地方（行文、UI 文案、識別字、套件名、
資源名、網域），不特別迴避、不改寫成「the app」。換名字整批留到**上線之前**做一次。

死線掛在 [ADR-0004](0004-development-phase-and-launch-line.md)：`OPEN_SIGNUP` 打開之前要換完。
那份 ADR 的〈上線前要做完的事〉列著這一條，因為讀到「上線是哪一刻」的人，正是需要看到這張
清單的人。

這份 ADR 取代 [ADR-0019](0019-the-product-name-does-not-take-a-word-from-the-format.md) 的
〈決定〉那一段（「這個 app 叫 Folis」）。ADR-0019 的內文與檔名照它自己訂的規則不改，它是一份
有日期的紀錄。它另外兩件事仍然成立：**一個名字不是兩個**（官方那一台與自己架的那一份由主機名
區分），以及**產品名不佔用格式的詞彙**。

## 為什麼要換：folium 這個詞源已經被同類產品佔滿了

ADR-0019 給 Folis 的理由是拉丁文 **folium**（葉，也是書頁）。同一個字根，閱讀 app 這個類別裡
已經有三個產品在用：

| 產品 | 是什麼 |
| --- | --- |
| [Foliate](https://johnfactotum.github.io/foliate/) | Linux 桌面 EPUB reader，在 Flathub 上發行 |
| [foliate-js](https://github.com/johnfactotum/foliate-js) | 同一個作者的**瀏覽器 EPUB 渲染程式庫**，Foliate 3.0 起用它 |
| [Folium Reader](https://play.google.com/store/apps/details?id=com.folium.app.folium_reader) | Google Play 上的 EPUB／PDF reader |

`Folis` 跟這三個都不是字面撞名，撞的是詞源，而**讀者分辨名字靠的不是拼字**。

三個裡面最麻煩的是 foliate-js：純 JS、無相依、在瀏覽器裡渲染 EPUB、用 CFI 定位，跟 frond
是同一種東西。所以這不只是產品名撞到一個 app。Folis 跟 frond 都是「葉」，兩個名字用的是同一個
字根，而那個字根已經被這個類別裡最有名的 reader 佔走了。

**ADR-0019 留下的取名檢查看不到這件事。** 那條檢查問的是「這個字在 EPUB、CFI、WebAuthn、HTTP
這些非引用不可的規格裡，已經有意思了嗎」。Foliate 通得過，它不是規格詞彙。這次沒有把檢查補成
正式規則（多一條流程只會多一件沒有人記得跑的事），但下一次取名要知道：**撞的可能不是字面，
是詞源**，而要查的地方是 GitHub、npm、Flathub、App Store、Google Play。

## 為什麼不現在改

因為取名很難，而現在取的名字會在產品還沒定型的時候定下來。ADR-0019 就是這樣來的：那次是為了
解決 `<spine>` 撞到格式詞彙而在一天之內取的，取得快，然後撞到 Foliate。

延後買到的是資訊：上線之前這個 app 會長成什麼樣、對誰講話、定價怎麼講，那些都還在變，而名字
最好在那些定下來之後選。

## 延後付得起，因為 Folis 現在只是文字

這不是猜的，量得到：

- **上一次改名是一天做完的。** spine → Folis 在 2026-08-11，六個 commit（`c372f5b`、`8dea506`、
  `d9b15d7`、`2622dd8`、`5c20d8f`、`31cbb94`）。
- **現在 `folis` 出現 296 次、約 70 個檔案，全部是文字。**
- **沒有視覺識別綁在名字上。** 沒有 wordmark、沒有 logo、沒有 OG 圖。
  `packages/app/public/favicon.svg` 是一個抽象圖形，不帶字母，而且它的紫藍配色跟
  [ADR-0022](0022-the-interface-is-a-print-shop.md) 的紙、墨、一個綠對不上，本來就要換。
- **儲存資源怎麼換 ADR-0019 已經寫過**：D1、R2、Dexie 都沒有 rename，開新的、不搬資料，
  開發階段付得起（[ADR-0004](0004-development-phase-and-launch-line.md)）。
- **`app.folis.ink` 是 WebAuthn 的 RP ID，換 hostname 會讓每一把 passkey 失效。** 上線前使用者
  是維護者一個人，而且 magic code 跟 RP ID 無關，搬得過去（見 ADR-0004
  〈兩件與上線無關、但一樣走不回頭的事〉）。這個代價在 2026-08-09 換網域時已經付過一次。

所以延後的成本是**每多寫一份文件、多一份 legal、多一頁 site，就多幾個 `Folis` 要換**，而那些
`sed` 全部改得掉。真正會讓改名變貴的是把名字發布到 repo 外面，而在 `OPEN_SIGNUP` 打開之前
那件事還沒發生。

## 文件裡會同時留著三個名字，那沒關係

ADR-0019 訂的節奏是：ADR 的內文與檔名不改、程式碼註解照 `CLAUDE.md` 的「一次只改手上那個檔案」、
指向舊 repo 的連結不批次改寫。下一次改名照同一條規則走，所以這個 repo 裡會同時留著三個名字：
spine、Folis、下一個。

這個狀況現在就有，而且沒有人被它絆到：`0010-spine-is-never-the-path-to-a-book.md` 與
`0014-spine-carries-the-font-rather-than-borrowing-it.md` 這兩個檔名裡的 spine 指的是產品，
不是格式元素。ADR-0019 用一句話就把所有舊名字處理掉了（「2026-08-11 以前寫下的 `spine`
就是 Folis」），下一次再寫一句。一句話換一次全庫 sweep，這筆划算。

## frond 不跟著改

frond 也是葉，而 foliate-js 跟它做同一件事，所以同一個撞名它也沾到。**還是不改。**

理由是它是函式庫不是產品：它不再對外發布（[ADR-0017](0017-frond-moves-in-and-stops-being-published.md)），
沒有人要靠這個名字在 npm 上找到它，讀到這個名字的只有打開 `packages/frond/` 的人。撞名的代價是
「讀者以為你是誰的仿品」，而 frond 沒有那種讀者。

ADR-0019 寫「frond 跟 Folis 同源，那是巧合，不是理由」。Folis 走了以後那句話會失去對照的一半。
記在這裡是為了讓未來的讀者知道：frond 留下來不是漏掉了，是評估過的。
