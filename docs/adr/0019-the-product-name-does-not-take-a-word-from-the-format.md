# 產品的名字不佔用格式的詞彙，spine 改名為 Folis

日期：2026-08-11。

## 決定

這個 app 叫 **Folis**。行文裡寫 `Folis`，識別字、套件名與網域寫 `folis`。

**一個名字，不是兩個。** Folis 同時是軟體的名字與服務的名字；「官方那一台」與「自己架的那一份」
的區別由**主機名**扛，不由第二個名字扛。這一條不是這裡新定的，是
[ADR-0009](0009-open-source-buys-an-exit-not-contributions.md) 已經定過的：**解法是名字，不是
授權，README 寫明 `app.folis.ink` 是官方唯一的託管服務。** 那句話這次一併補進兩份 README，因為
在此之前它只存在於 ADR 裡。

apex `folis.ink` **留給官方網站**（舊 repo 的 #110 剩下的
那一半），app 永遠住在 `app.` 底下。這其實已經是既成事實：WebAuthn 的 RP ID 是
`app.folis.ink`，而 RP ID 在有 credential 之後不可變。

**這份文件庫在 2026-08-11 以前寫下的 `spine` 就是 Folis。** ADR 的內文與檔名一律不改——它們是
有日期的紀錄，改寫等於竄改當時說過的話，而編號與檔名是別的文件引用時用的錨點。同理，
`docs/superpowers/specs/` 底下那兩份設計文件的檔名也不改。散在程式碼註解裡的 `spine` 照
`CLAUDE.md` 那條「一次只改手上那個檔案」的節奏處理，不做全庫掃描。文件裡指向
`github.com/yurenju/<舊 repo>/…` 的連結也不批次改寫，GitHub 的 redirect 接得住。

> **2026-08-20：最後那句不成立了。** 舊 repo 後來轉成 private，redirect 跟著失效，那些連結對外
> 一律 404。所以它們**還是批次清掉了**——內容對讀者有意義的改寫進本文，純粹是工作追蹤的整句刪除。
> 上面關於 ADR 內文與檔名不改的那幾句沒有變。

## 為什麼：`spine` 是 EPUB 封裝格式的元素名

`<spine>` 是 package document 裡定義閱讀順序的那個元素。拿它當產品名的代價，不是美感問題，是
**每一句話都要先問「你講的是哪一個 spine」**。而這個代價在這個 repo 裡已經量得到，有兩個地方為
它付過錢：

- **frond 的 `CONTEXT.md` 把規格原詞列進 `_Avoid_`**，改用 W3C Publication Manifest 的
  `readingOrder`。理由寫了兩條，第二條就是「消費端專案就叫 spine，沿用會讓每一句 spine 都帶
  歧義」。
- **`packages/frond/src/epub/package-document.ts` 把那個字關進一個 function**，並且在註解裡
  說明為什麼它只准出現在那裡。

也就是說，解析層為了避開產品名，放棄了格式自己的用詞。**那是反過來的**：格式的詞彙是既定的，
產品的名字是可以選的，讓不動的那一方去繞開可以選的那一方，代價會一直付下去。

**spine（書脊）當初是個好名字**，這裡不假裝它不是。它壞在一件取名那天看不見的事：這個專案後來
長出了自己的 EPUB 解析層（frond，見 [ADR-0003](0003-epub-ts-to-frond.md)），而解析層非講
`<spine>` 不可。取名的時候用的還是 epub.js，那個字被包在別人的函式庫裡，從來不會出現在這邊的
文件裡。

## 為什麼是 Folis

拉丁文 **folium** 是葉，也是**書頁**（folio 同源）。一個字同時是植物的葉子與書的一頁，而這個
app 從頭到尾只做一件事：把書的一頁畫出來。

`folis.ink` 不是為了這次改名才註冊的。網域早在 2026-08-09 就換過去了（見
`docs/superpowers/specs/2026-07-15-spine-cloudflare-sync-design.md` 的補記，當時付掉的代價是既有
passkey 全部報廢）。所以這次不是換網域，是**讓名字追上已經存在了兩天的網域**。

渲染層叫 frond，那也是葉（蕨葉）。兩個名字現在同源了，**那是巧合，不是理由**。寫在這裡是因為
未來的讀者一定會以為它是設計出來的，而事後編出來的一致性會稀釋真正的理由。

## 這個字被釋放了，但 frond 還是用 `readingOrder`

改名之後，`spine` 在這個 repo 裡只剩一個意思，就是格式裡那個元素。frond `CONTEXT.md` 那條
`_Avoid_` 的**第二條理由因此作廢**，要刪掉。

但 `readingOrder` 留著，因為**第一條理由自己站得住**：`readingOrder` 是 W3C Publication Manifest
與 Readium 的正式用詞，而 `spine`（書脊）是行話，字面與「閱讀順序」的關聯只有內行人知道。

釋放不等於該用。真正划算的是反過來看：**Folis 比 spine 好的一半，正是它讓 `<spine>` 這個字可以
只指規格裡那個元素**——而需要只指那個元素的地方，全 repo 只有 `package-document.ts` 裡一個
function。

## 換名字要付什麼：三個沒有 rename 的東西

`wrangler d1` 沒有 rename（只有 create / delete / execute / export / time-travel / migrations），
`wrangler r2 bucket` 也沒有。IndexedDB 同樣沒有改名的 API。所以三個叫 `spine` 的儲存資源全部
**開新的、不搬資料**：

| 資源 | 做法 |
| --- | --- |
| D1 | 新建 `folis`，`migrations/` 從第一支跑到最後一支建出 schema |
| R2 | 新建 `folis`，舊 bucket 驗過再刪 |
| Dexie（讀者裝置上） | 換成 `folis`，本機的書、筆記、閱讀位置歸零 |

不搬，換到的不只是省事：**`migrations/` 那一疊從零跑到底這件事，在此之前從來沒有發生過**。現在
這個 D1 是一路長上來的，而從零跑一次正是自己架一份的人第一天要做的事，也正是〈退路〉承諾他做得
到的事。

這整段只有在**開發階段**付得起（[ADR-0004](0004-development-phase-and-launch-line.md)）：改名的
那天使用者是維護者一個人。〈上線〉之後同一個改名要寫的是搬家程式，不是 create。

也因此**不寫一次性的相容程式**：localStorage 不讀舊 key，程式裡不呼叫 `Dexie.delete("spine")`。
那種程式碼的壽命是永遠，而它服務的人數是一。舊的 database 由維護者自己在 devtools 清掉。

## 這條原則下次用得上

這個專案還會取名字（`packages/site`、匯出格式、MCP 的 tool 名）。這份 ADR 留下的不是「我們改名
了」，是取名的時候要先做的一次檢查：

> **這個字在 EPUB、CFI、WebAuthn、HTTP 這些我們非引用不可的規格裡，已經有意思了嗎？**

有的話就換一個。規格的詞彙不會為了我們讓路。
