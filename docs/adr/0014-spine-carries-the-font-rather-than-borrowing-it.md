# 字型由 spine 帶，不跟讀者的機器借

日期：2026-08-07。

下面每個數字的量法與重現方式在
[docs/specs/cjk-web-font/measurements.md](../specs/cjk-web-font/measurements.md)。

## 決定

spine 自架 Noto Sans CJK 與 Noto Serif CJK，**繁簡日韓各一套字形都在同一支檔案裡**，讀者開了真的
有漢字的書才下載它。

- **一支 pan-CJK，不是四支。** `NotoSerifCJKtc-Regular` 這一支就涵蓋 ZHT / ZHS / ZHH / JAN / KOR，
  字形變體靠 OpenType 的 `locl` 切換。
- **哪一套字形由 spine 指定**，用 `font-language-override`，依 `chinese.ts` 自己的簡繁判斷，不看書
  怎麼宣告 `lang`。
- **不進 service worker 的 precache。** 字型跟書同一類：讀者匯入了什麼，才付什麼。它存在 Dexie，
  用的時候做成 `blob:` URL 交給 frond。
- **不 subset。** 全字集直接給，罕見字與 CJK Ext B 都在。
- **只下當下用得到的那一支**，每種字型先下 Regular 再下 **Bold**（明體與黑體都帶 Bold）。下載完立刻
  套用，讀者怎麼看到這個下載見〈下載中怎麼讓讀者看到〉。為什麼帶真的 Bold 見〈為什麼帶 Bold〉。

觸發下載的判定**不是** `detectScript` 那個 `Script`：那個判斷在數不到任何字的時候回 `'cjk'`，對決定
行長是安全的預設，對決定要不要下載 16 MB 則方向相反。要另一個判定，實際數到漢字才算——而且**數兩種
字**：漢字說這本書可能是中文，假名或諺文說它不是。漢字統一之下日文書用的大半是同一批 code point，只
數漢字會把每一本日文書都當成中文書、用 `ZHT` 去排，那正是日文讀者一眼看得出來的錯
（舊 repo 的 #55）。日韓書留在平台字型。

## 下載中怎麼讓讀者看到

手機上原本的問題：讀者選了明體，下載在背景跑，畫面卻毫無變化，直到下載完那一刻突然重排。進度那時
只活在設定面板裡，而讀者選完就把面板關掉回去讀了，所以整段下載對他是無感的，重排也就成了「怎麼突然
變了」。可見度切成三層，各答一個不同的問題：

- **面板那行（`webFontNote`）**：忙到哪。精確的 `45% / 12.3MB`，給主動點開面板看的人。沒有
  `Content-Length` 的伺服器算不出百分比，就顯示 MB。
- **Aa 按鈕描邊**：還在不在忙。面板關掉後的持續指示，一小段 accent 沿按鈕的圓角邊框繞行。它不給數字
  ——跨 Regular、Bold 兩支不會歸零重跑，也不受沒有 `Content-Length` 影響，而閱讀畫面要的是「沒卡住」
  而不是一個盯著看的數字。面板開著時交棒給上面那行，描邊只在面板關著時出現。
- **一次性 toast**：忙完了。整批（Regular＋Bold）都下完才跳一次「已套用明體」，不是一支跳一次——大重排
  發生在 Regular 套用那一刻，由還在轉的描邊負責解釋，toast 是結尾補一句，替那一跳收尾。

**失敗也講一句。** 抓不到（離線或 fetch 失敗）時跳一次「目前無法下載字型，先用系統字型」。這更正了本
文件早先「靜默退回」的立場：對一個剛特地選了明體、卻看見畫面沒變的讀者，靜默就是再一次「什麼都沒發
生」。這句 toast 純告知、不要求讀者做任何事（不是要他重試的錯誤框），平台字型照樣頂上，他可以繼續讀
——ADR 要的「不把錯誤丟給讀者處理」仍然成立，改的只是「一個字都不說」。

**已在裝置上的字型完全安靜。** 切到一支已快取的字型（明體↔黑體來回、或重開讀過的書）不動網路，就
沒有描邊、沒有 toast，瞬間切換。整套指示只在真的有網路下載時才出現。

## 為什麼要自架

在這之前，讀者看到的字型是「他的機器上剛好裝了什麼」的函式。舊 repo 的 #38
與 舊 repo 的 #72 把堆疊補到能涵蓋 Debian、Ubuntu、Fedora、Apple 與
Windows，那解掉的是「有沒有字可用」。

這張 ADR 解的是另一件事：**可預期性**。同一本書、同一組設定，今天在 iPhone 上是 Songti TC，在 Windows
上是 PMingLiU，在 Linux 上是 Noto Serif CJK，三個都是明體而三個都不一樣。行高、advance、字形全都不同，
所以截圖不能比、量出來的數字不能對，跟讀者談排版的時候講的也不是同一件事。

自己帶字型是唯一能拿掉那個變數的辦法。

## 為什麼不進 precache

現在 app shell 的 precache 是 8 entries / 403.71 KiB。一支 CJK woff2 進來，這個數字跳一個量級：

| | woff2 |
| --- | --- |
| Noto Serif CJK TC Regular | 15.94 MB |
| Noto Serif CJK TC Bold | 16.99 MB |
| Noto Sans CJK TC Regular | 10.90 MB |
| Noto Sans CJK TC Bold | 11.56 MB |

讀英文書的人一輩子用不到這些位元組，沒有理由讓他在安裝的時候先付。`vite.config.ts` 已經畫過這條線
了（`app shell only: books and data live in Dexie, not the SW cache`），字型落在線的哪一邊很清楚：
它不是 app shell，它跟書一樣是「這個讀者要不要」的東西。

## 為什麼是 `blob:` URL，不是 service worker

直覺的做法是把字型放進 Cache API，讓 service worker 攔截書裡的字型請求。**那條路在 Chrome 上是斷的。**

量法是一個受 service worker 控制的頁面，建一個 `blob:` 的 iframe，iframe 裡的 `@font-face` 指向同源
的 `https://…/probe.woff2`：

| | `blob:` iframe 有 SW controller | SW 看到字型請求 |
| --- | --- | --- |
| chromium | **false** | **false** |
| firefox | true | true |
| webkit | true | true |

Chromium 的 `blob:` iframe 不受 service worker 控制，所以離線時那個請求直接落空，書就缺字。而書正是
在 `blob:` iframe 裡（frond 的 ADR-0006）。

改成把位元組包成 Blob、`createObjectURL`，再讓那個 `blob:` URL 進到書的 `@font-face`，三家的
`document.fonts.load()` 都回報 `loaded`。所以位元組要留在 Dexie，交付的形式是 `blob:` URL，而 frond
收 url 的欄位必須接受 `blob:` scheme（[frond#92](https://github.com/yurenju/frond/issues/92)）。

## 那個 `blob:` URL 要建一次，留著用

`@font-face` 是 per-document 的，而書每重建一次 document 就要重新解析一次字型。重建不只發生在換書：
`applySettings` 就是 rebuild，所以改字級、改行距、改主題都會經過這裡。

15.94 MB 的 woff2 解析一次要 chromium 571 ms、firefox 576 ms、webkit 244 ms。這筆只在**第一次**付：

| | 第 1 次 | 第 2 次 | 第 3 次 |
| --- | --- | --- | --- |
| 同一個 `blob:` URL（chromium） | 571 ms | 2 ms | 0 ms |
| 每次重建 URL（chromium） | 601 ms | 602 ms | 537 ms |

三家都是同一個形狀。`URL.createObjectURL` 每呼叫一次就產生一個新的 URL，即使底下是同一個 Blob，字型
引擎也當成另一份字型重新解析。所以 **objectURL 建一次就留著**，不要在 `frondSettings` 或 rebuild 的
路徑上重建它。寫成每次重建的話，讀者每拉一次字級滑桿都會卡半秒。

同一個理由，Dexie 那一欄要存 **Blob 而不是 ArrayBuffer**：ArrayBuffer 讀出來就是記憶體裡的 16 MB，
Blob 讀出來還只是一個參考，真正被讀進去是字型引擎解析它的那一刻。

## 為什麼一支就夠

Noto CJK 的每個 region 版都涵蓋完整的 glyph 集，字形變體靠 `locl` 切換。直接讀
`NotoSerifCJKtc-Regular.otf` 的 sfnt table：

- **GSUB**：`hani` / `kana` / `latn` 三個 script 底下，ZHT、ZHS、ZHH、JAN、KOR 五個 langsys 全在，
  每個都掛 `locl`。
- **cmap**：龙 U+9F99、门 U+95E8、么 U+4E48（簡體）、働 U+50CD（日）、한 U+D55C（韓）、
  𰻞 U+30EDE（Ext G）全部有 glyph。
- **直排**：GSUB 有 `vert` `vrt2`，GPOS 有 `vert` `vhal` `vpal` `halt` `palt`，`vhea` / `vmtx` /
  `VORG` 三張表都在。

Variable font 這條路不划算，順帶記在這裡：`NotoSerifCJKtc-VF.otf` 是 52.81 MB，比 Regular 加 Bold
兩支 static 加起來（47.7 MB）還大。

## 為什麼用原本的 family 名

自架那份的 `@font-face` 就叫 `Noto Serif CJK TC` 與 `Noto Sans CJK TC`，不另取別名。因為
`@font-face` 贏得過本機同名的字型：這台機器裝了 `Noto Serif CJK TC`（明體），拿 Sans 的位元組冒充
這個名字宣告 `@font-face`，三家畫出來都是黑體。

好處是 [chinese.ts](../../src/lib/chinese.ts) 的堆疊裡本來就有這兩個名字，語意不必變。但**順序要
變**：`'Noto Serif TC'` 現在排在 `'Noto Serif CJK TC'` 前面，讀者機器上剛好有前者的話，它會贏過
自架的那份，可預期性就破了。自帶字型可用時，那個名字要排在堆疊第一。

沒有 Reserved Font Name，所以留原名在授權上也沒有問題（見下）。

## 為什麼字形由 spine 指定，不由書的 `lang`

因為書的 `lang` 常常說不清楚，而說不清楚的時候三家都猜錯邊。同一支字型，同一段字：

| 元素上的 `lang` | chromium | firefox | webkit |
| --- | --- | --- | --- |
| `zh-TW` | TC 字形 | TC 字形 | TC 字形 |
| `zh-CN` / `zh-Hans` | SC 字形 | SC 字形 | SC 字形 |
| **`zh`** | **SC 字形** | **SC 字形** | **SC 字形** |
| 完全沒有 | TC 字形 | TC 字形 | TC 字形 |

**一本繁體書只要宣告 `lang="zh"`，三家都會把它畫成簡體字形**，而中文 epub 宣告 `lang="zh"` 非常常見。

這個缺陷在自架之前不存在：讀者拿到的是 PingFang TC 或 Songti TC，那些字型本身就是 TC 字形，沒有
`locl` 可切。所以它是自架帶進來的新變數，必須跟著自架一起處理。

`font-language-override` 不必碰書的 `lang` 屬性。那個屬性還有斷詞與無障礙的用途，改它才是真的覆寫
書的宣告。

**只有 chromium 與 firefox 認這個屬性，webkit 完全沒實作。** 動工時實測更正了原本的說法：不是「元素
上沒有 `lang` 時才忽略」那種窄缺口，而是整個屬性在 webkit 上不存在——`CSS.supports('font-language-override', '"ZHT"')`
回 `false`，計算值是空的，畫出來跟沒設一模一樣。所以 iOS 與 macOS Safari 上的讀者拿到的是書自己的
`lang` 決定的字形，也就是他們本來就在的位置：**字型照樣載入，只有簡繁字形切換不生效，不是壞掉**。
webkit 有 `-webkit-locale` 能做到同一件事，但那要一張 `ZHT → zh-TW` 的對照表，是政策不是語法轉換，
留給另一張票。（這也更正了 frond#92 原本寫「三家都認」的表格。）

判斷簡繁用內文而不是 `dc:language`，理由跟〈書寫系統〉同一條，metadata 說謊是常態。

## 為什麼帶 Bold

只帶 Regular 的話，標題與強調是瀏覽器**合成**的粗體，三家演算法不同——「同一本書在每台機器上是同一個
字型畫的」在那些字上不成立，而那正是這張 ADR 的目的。動工前先量了它到底差多少（墨水覆蓋率，完整表格
在 [measurements.md](../specs/cjk-web-font/measurements.md) 第八節）：真 Bold 三家之間差 1–2%，合成粗體
差 14–18%，**差一個數量級**。

兩種字型都帶真的 Bold。明體受的傷比黑體重（合成比真 Bold 重 25–27% 對黑體的 10%，因為明體筆畫有粗細
對比、字腔小，描邊加粗先吃掉那些空隙），所以明體先帶——但標題在黑體上一樣是合成的、一樣三家不一致，
而目標是「每台機器同一個字」，不是「難看到某個門檻才管」。補 Bold 是低風險的：advance 完全沒動（同段
字三家三種畫法都是 288.00px），不改變分頁、不動存好的閱讀位置。判讀留言在
舊 repo 的 #92。

## 為什麼不 subset

因為不需要。既然不是每個讀者都付這筆下載，就沒有為了體積去切字集的動機，而不切就沒有「這本書剛好
有幾個罕見字，於是同一頁出現兩種字型」這件事。

順帶避開一個坑。`subset-font`（harfbuzz 的 wasm 版）在字集超過大約 13000 字之後**靜默丟掉整張 CFF
table**：21000 字那次吐出一個 40020 glyph、沒有任何 outline、只有 0.31 MB 的檔案，過程不報錯。這種
壞字型會一路通過 build 進到讀者手上。

（subset 本身不會弄丟直排：拿一本真書的字集切出來的字型，GSUB 的 `vert` `vrt2` `locl` 與 GPOS 的
`vert` `vhal` `vpal` 都還在。那條先驗過才決定不用它的。）

## 為什麼不用 Google Fonts

Google Fonts 的 Noto Serif TC 切成 108 片 unicode-range。切片配 runtime cache 只救得到「已經畫過的
那幾片」，讀者離線打開一本沒讀過的書就是缺字；要預先全載就得點名 URL，而那些 woff2 的檔名帶 hash、
CSS 隨 UA 變、隨時可能換版，沒有一組可以寫死的 URL。

gstatic 給的一年 `max-age` 不能當離線保證：HTTP cache 是分區的（Chrome 2020 起，Safari 更早），別的
網站載過不會讓 spine 省掉第一次，而且它隨時可以被回收。它是效能機制。

自架另外解掉第三方請求的隱私問題，也讓自架 spine 的人不必連 Google。

## 為什麼不偵測讀者本機已有的 Noto

`document.fonts.check()` 問得出來，Linux 讀者也確實常常已經裝了 Noto CJK。不做，因為本機那份的版本
不可控（發行版可能停在 2.001，我們帶的是 2.003），字形與 metrics 都可能有差。省下那 16 MB 的代價是
目標在這群人身上退回「有字可用」，而且看截圖的時候無法確定對方用的是哪一版。

## 授權

兩支都是 **SIL Open Font License 1.1**，copyright holder 是 Adobe（Serif `© 2017-2024 Adobe`
2.003，Sans `© 2014-2021 Adobe` 2.004），**沒有 Reserved Font Name**。

- 字型放進 `public/fonts/` 供瀏覽器下載就是散布，所以 OFL 全文與 copyright notice 要跟著部署出去，
  不能只躺在 repo 裡。
- OFL 禁止的是單獨販售字型本身。spine 賣的是 app（[ADR-0011](0011-the-paywall-follows-the-monthly-bill.md)），
  字型是隨附，那是 OFL 明確允許的 bundling。
- 沒有 RFN，所以轉 woff2 之後仍可保留 `Noto Serif CJK TC` 這個 family 名，跟
  [chinese.ts](../../src/lib/chinese.ts) 堆疊裡既有的名字對得上。

## 代價

- **repo 胖約 55 MB**（明體 Regular+Bold、黑體 Regular+Bold 四支）。commit 進去的是衍生檔案，來源
  版本與轉檔方式要另外記，因為檔案本身不會說。
- **第一次開中文書要等一段背景下載。** 進度看得到，但在慢的網路上那是分鐘等級。
- **下載完套用的那一刻書會重排**，讀者眼前那一頁的內容邊界會移動。位置守得住（走的是
  `applySettings` 那條既有的路），但畫面會跳一下。
- **粗體暫時不統一。** 只帶 Regular 的期間，標題與強調由瀏覽器合成粗體，而合成演算法三家不同，所以
  目標在那些字上不成立。
- **多一個判定要維護**，而且它跟 `detectScript` 長得很像，以後容易有人以為重複了就合併掉。
- **綁在 frond 的新 API 上**（[frond#92](https://github.com/yurenju/frond/issues/92)），frond 要先
  merge、先發版，spine 才動得了。
