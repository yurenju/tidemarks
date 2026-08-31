# ADR-0047：書存成 bytes，字型存成 Blob

日期：2026-08-31

## 狀態

已採用。

## 前提

Tidemarks 把讀者的書放在瀏覽器的 IndexedDB 裡：epub 本身、封面圖，還有字型。同一個資料庫、
同一套 API，但這三樣東西可以用兩種形狀存：

- **`Blob`**：瀏覽器把它當成一份檔案。從 IndexedDB 讀出來的時候拿到的是一個參照，實際的位元組
  留在瀏覽器自己的儲存裡，直到有人真的去要。
- **`ArrayBuffer`**：就是位元組本身。讀出來就是完整的一份在記憶體裡。

## 問題

**ephemeral 的 WebKit session 存不進 `Blob`。** 三個位元組也不行，錯誤訊息是：

```
Error preparing Blob/File data to be stored in object store
```

同一個 object store 收 `ArrayBuffer` 完全沒問題。Chromium 與 Firefox 兩種都收。
（`packages/app/tests/browser/reader/storage.spec.ts` 兩邊都量，這不是傳聞。）

「ephemeral」指的是沒有 profile 目錄的 session。讀者手機上的 Safari 有 profile，所以真實的讀者
碰不到這件事，但 **Playwright 發出來的每一個 context 預設都是 ephemeral 的**。而書本來是以
`Blob` 存的，所以在 WebKit 底下的測試裡，一本書根本匯不進去。

這件事付了兩輪代價。第一輪是整套 reader 測試直接跳過 WebKit。第二輪是改成讓每一支 WebKit 測試
各自 `launchPersistentContext`，換到一個 profile。但 persistent context 自己就是一個瀏覽器，
所以那等於**每一支測試各開關一次瀏覽器**，量到大約一秒，乘上四百多支。

## 決定

**書存 bytes，字型繼續存 `Blob`。**

| | 形狀 | 為什麼 |
| --- | --- | --- |
| epub 本身（`BookRecord.file`） | `ArrayBuffer` | 開書就是解析它，本來就會整份進記憶體 |
| 封面（`BookRecord.cover`） | `{ bytes, type }` | 同上，而且它小 |
| 字型（`FontRow.file`） | `Blob` | 一份 19 MB，而它只會被交給 `URL.createObjectURL` |

分界線是**這份資料是不是本來就會被讀進記憶體**：

- 一本書要能被讀，就得被解析，而解析就是把它整份攤開。存成 `Blob` 省不到任何東西，只是在
  `EpubBook.open()` 之前多一次 `.arrayBuffer()`。
- 一份字型從頭到尾沒有人要看它的位元組。它被丟給 `URL.createObjectURL`，然後瀏覽器自己去讀。
  存成 `ArrayBuffer` 就是憑空多 19 MB 在記憶體裡。

封面多帶一個 `type`，因為那是唯一推導不出來的東西：epub 的 manifest 說它是 jpeg 還是 png，而
`URL.createObjectURL` 需要知道。epub 自己則永遠是 `application/epub+zip`，所以 `file` 不帶。

## 換到的東西

**`tests/browser/support/fixtures.ts` 回到 Playwright 原本的行為，只多一條 route。** 這比省下
的那一秒重要：手工共用的 context **沒辦法**支援 `test.use({ hasTouch, isMobile, locale,
colorScheme })`，那四個是建立 context 的時候就定死的，而這套測試有十七個地方在設它們。交回給
Playwright 之後這件事免費，也不必在任何地方維護一份「有哪些 context 設定」的清單。那種清單
會過期，而且過期的時候不會紅燈。

WebKit 那個兩倍的 test timeout 也一起拿掉了，它本來就是為 persistent context 加的。

## 代價

**還有一支測試需要 profile。** `reader/font-weight.spec.ts` 會走字型那條路，而字型還是 `Blob`，
所以它用 `testWithProfile`。整個 workaround 剩下這一支，代價從四百多支變成一支。那支測試本身
慢得不合理（要下載 19 MB 才能驗一個字重），記在 [#169](https://github.com/yurenju/tidemarks/issues/169)。

**已經在讀者裝置上的資料要轉。** Dexie v5 做這件事，但轉換不在 upgrade 裡面：IndexedDB 的
transaction 碰到第一個不屬於它的 await 就會關掉，而 `blob.arrayBuffer()` 正是那種 await。所以
v5 只留一個記號，真正的轉換在 `db.on("ready")` 裡跑，Dexie 會擋住其他查詢等它做完。

⚠️ **不要改成把舊資料丟掉。** 那個版本寫過，看起來無害（`file` 是 null 正是延後下載要處理的
狀態），但那只對「位元組已經在伺服器上」的書成立。**沒註冊的讀者沒有伺服器**，那本書會留在
書架上、每次打開都回「Download failed」，而且之後去註冊也修不好：推送的時候 `sync.ts` 會跳過
沒有內容的書，伺服器那筆就這樣生出來、永遠沒有檔案。封面更糟，重抓的條件掛在 `hasCover`，而
那個欄位只有拉取會設，所以從來沒同步過的書會直接失去封面而且沒有回頭路。

## 這不推翻 ADR-0014

字型不進 bundle、第一次要用的時候才下載，那條沒有變。這份只講**下載完之後用什麼形狀存**。
