# spine 不成為拿到書的路徑

日期：2026-08-04。

## 決定

**spine 永遠不成為「沒有那本書的人也拿得到那本書」的路徑。**

| | |
| --- | --- |
| 匯出整本書給**使用者自己** | 可以 |
| 分享**一段引文**（文字或圖片） | 可以 |
| 整章、多段拼得回原書的量、書櫃連結、epub 檔本身 | **不行** |

引文卡片**在 client 產生**：使用者自己存檔、自己散布。spine 不 host、不給公開網址，
所以**沒有 OG preview**。

## 為什麼

使用者上傳的是自己的書，而 spine 對那些檔案的來源沒有查核的能力。收費把 spine 從一個個人
專案變成營利的託管服務，在著作權法上不站在同一格。

現在的位置其實很好，而且是設計出來的：**spine 沒有任何分享功能。** 沒有公開書櫃、沒有分享
連結、沒有多人共讀，上傳只給自己看——那是**寄物櫃**，不是散布平台。寄物櫃業者對客人塞了
什麼進去，責任輕得多。

而**破壞這個位置只要一個功能**。「分享一段書摘給朋友」聽起來人畜無害、是產品清單上最不
起眼的一項，做下去就從寄物櫃變成有公開網址的散布管道。這種決定通常不是想清楚才做的，是
某天覺得「加一下也還好」。寫下來就是為了擋那一天。

## 引文可以，因為引文不是書

看到卡片的人拿到的是一段話，不是書。Kindle、Apple Books、Readwise 都在做同一件事。

所以界線不在「有沒有分享」，在**分享的東西是不是書**。

## 圖片在 client 產生，才是決定性的那一步

- **client 產生**（canvas 畫完，使用者自己存下來貼出去）→ spine 是**工具**，跟截圖鍵同一類。
  書的文字沒有經過 spine 的伺服器再吐給第三人。
- **server 產生 + 一個公開網址** → **spine 在出版**。那個網址上掛著別人書裡的文字，沒有
  認證、搜尋引擎爬得到，而且是 spine 發的。

會滑向後者的誘因很具體：**貼到社群平台要好看就要 OG preview，而 OG preview 需要一個公開
網址。** 那一步看起來只是讓分享好看一點，實際上是從工具變成出版商。**放棄 OG preview 是
這條規則的價格，不是疏漏。**

同一個分法這個 repo 已經用過一次：[ADR-0008](0008-pr-images-are-hosted-not-committed.md)
因為 pr-image 的網址沒有認證，所以真書的內文不准進去。

## 同類服務怎麼畫這條線：Readwise Reader

（查於 2026-08-04，來源是 Readwise 的官方文件與服務條款。）

Readwise Reader 一樣收使用者上傳的 EPUB，而且它**有**一整套公開分享機制：在 Reader 裡標註過
的文件可以產生公開連結，「anyone with that link can view the document along with your
highlights, notes, and tags」。

但它排除一類：

> "for privacy reasons, this option isn't available on certain user-uploaded documents such as
> EPUBs and PDFs"

**線的位置跟 spine 一樣——使用者自己上傳的書產生不了公開連結——但它給的理由是隱私，不是著作
權。** 這個差別要記著：**不能**拿 Readwise 當成「業界也認為公開分享書是著作權問題」的佐證，
它沒有這樣說。能拿來當佐證的只有一件事，而那件事也夠了：**一家有法務的公司，獨立地在同一個
位置畫了同一條線。**

### 兩件要學

**一、條款要明講上傳的人自己負責。**

> "You represent and warrant that you have all rights necessary to upload User Content to the
> Service."
>
> "You assume all risk associated with your User Content ... and you have sole responsibility for
> the accuracy, quality, legality and appropriateness of your User Content."

**二、不脫 DRM，也不教人怎麼脫。** Readwise 的說法是：有些平台就是不給 DRM-free 的 EPUB，從那裡
買的書匯不進來（「Amazon wants you to read on a Kindle or in their app」）。它給的公版書來源是
Standard Ebooks。spine 任何文件都不提供脫 DRM 的做法或指引。

### 一件要反著做

Readwise 對使用者內容主張的授權**寬得驚人**：

> "a non-exclusive, worldwide, royalty-free, fully paid-up, transferable, sublicensable (directly
> and indirectly through multiple tiers), perpetual, and irrevocable license to copy, display,
> upload, perform, distribute, store, modify, and otherwise use your User Content"

用途寫的是「service development and improvement」。永久、不可撤回、可轉授、可散布、可修改
——這一段字面上涵蓋了
[ADR-0009](0009-open-source-buys-an-exit-not-contributions.md) 表格第一列那個懷疑（「會不會拿
去訓練」）。

**spine 的條款只主張營運需要的最小授權**：為了把書存起來，再送回給你本人。這件事幾乎不花成本，
而它正是花錢買不到的那種信任訊號——因為同類服務已經把相反的版本寫在自己的條款裡了。

以上三條都屬於「開始收費前」那批。

### 一件查不到的

「Share highlight as image」產生的圖是 Readwise 存在自己的網址上，還是在裝置上畫完就給你，官方
文件沒寫。所以**不能說 spine 的「圖在 client 產生」比 Readwise 嚴格**——只能說 spine 自己選了
看得見的那一邊，理由在下一節。

## 第二個理由：一個人扛不起

一旦 host 公開內容，就長出一整套本來不存在的工作——濫用檢舉、DMCA 窗口、內容審核、被拿去
洗版時的處理流程。那是一份**永遠不會結束**的工作，而它換到的只是分享連結上有一張縮圖。

## 跟 MCP 不衝突

使用者自己的 agent 讀使用者自己的書，內容沒有離開讀者。界線是**這份文字會不會離開讀者**
——[docs/specs/mcp/spec.md](../specs/mcp/spec.md) 已經畫過這條線，這份 ADR 只是說明
它承重。
