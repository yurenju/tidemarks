# PR 的證據圖託管在 Vercel Blob，不 commit 進 repo

日期：2026-08-02，2026-10-08 改寫。前一版的標題是「PR 的證據圖託管在 R2，不 commit 進 repo」，決定是
用 pr-image 0.1 把圖傳到 Cloudflare R2，30 天後由 bucket 的 lifecycle rule 刪掉。「不 commit 進 repo」
那一半沒有變，變的是圖放在哪裡、放多久。

## 決定

開 PR 用的截圖用 [pr-image](https://github.com/yurenju/pr-image) 傳到 Vercel Blob，PR 說明直接內嵌它給的
公開 URL。**圖不 commit 進 repo**，也不用釘 SHA 的 blob 連結指過去。**傳上去的圖永遠不會自動刪除**。做法
寫在 [pull-requests.md](../agents/pull-requests.md)。

`docs/evidence/` 底下既有的 75 張圖在 2026-08-19 一併刪掉了，那個目錄不再存在。理由有兩條：
PR 是流動的東西，合併之後幾乎沒有人回頭看；而開源前要逐張確認沒有版權書的內文
（[ADR-0010](0010-spine-is-never-the-path-to-a-book.md)），只要圖還在，每次規則變動都得重掃一次。

代價照實記：**舊 PR 說明裡指向這些檔案的 blob 連結從此是破的**。0.1 時期傳到 R2 的圖也一樣，30 天到了
就破。接住它們的是同一條規則：〈圖旁邊一定要附數字〉，那些數字與判讀表是文字，寫在 PR 內文裡，不隨圖消失。

## 這推翻了哪一句話

pull-requests.md 的〈圖怎麼放〉整節，以及它那句「spine 是 private repo，那條路不通」。

那句話沒有錯：`raw.githubusercontent.com` 對私有 repo 要認證，Markdown 的 `![](…)` 帶不了憑證，圖就是
破圖。錯在它證明的範圍：它證明的是 **GitHub 那條路**不通，不是所有路都不通。pr-image 的 URL 公開可取，
於是內嵌又成立了。

2026-10-08 那次改寫推翻的是前一版自己的一句話：「圖 30 天後會消失」。

## 為什麼從 R2 換到 Vercel Blob

pr-image 0.1 要一個 R2 bucket、一個 custom domain、一把 R2 API token，再加一個 1Password service account
（不是每個方案都開得出來），換一台機器還要重跑 `pr-image init`。0.2 只讀一個環境變數
`PR_IMAGE_BLOB_TOKEN`。這個專案現在會在 Docker Sandbox 裡開發，而 sandbox 的 proxy 可以在請求送出時才
把真的 token 換進去，sandbox 裡只看得到一個佔位值。設定從一整套服務變成一個變數，token 也不必放進
開發環境。pr-image 那邊的理由寫在
[pr-image ADR-0003](https://github.com/yurenju/pr-image/blob/main/docs/adr/0003-vercel-blob-and-permanent-images.md)。

## 換到了什麼

**一、圖看得到，不必點進去。** 判讀的價值幾乎都在並排：Chromium 一格、WebKit 一格，或修正前一格、修正
後一格。blob 連結沒辦法並排，四個連結等於要開四個分頁，於是實際上沒有人開。Markdown 表格的儲存格放得下
`![](…)`，「成對放，不要單張」這條規則到這裡才第一次真的執行得動。

**二、git 歷史不再長圖。** 那個目錄當時已經是 75 張、6.7 MB，而其中絕大多數只在一個 PR 被讀過一次。

**三、少四個步驟，也少一種死法。** 舊做法是 commit、push、`git rev-parse HEAD`、把 SHA 填進說明，順序
錯一次連結就是死的（先寫說明後 push 是最常見的那種）。現在 `pr-image upload --markdown` 印出來的就是可以
貼的東西。

**四、圖不會再過期。** 前一版最大的代價是半年後回頭讀一個 PR，看到的是一排破圖。現在只要 store 還在，
圖就在。

## 放棄了什麼

這一節是這份 ADR 存在的理由。四樣，都是真的：

**一、圖還是可能一次全部破掉，而且沒有預警。** 以免費的 Hobby 方案來說，額度是 1 GB 儲存、每月
2,000 次上傳。圖從不刪除，佔用的空間只會增加。額度用完時 Vercel 會把整個 store 封 30 天，很可能連讀取
也一起封，於是**所有 PR 裡的圖一起失效**，不只是新的傳不上去。pr-image 看不到用量，事前不會警告。

接住它的仍然是〈圖旁邊一定要附數字〉：數字與判讀表是文字，活得下來。圖不會再過期，這條規則還是承重
的，理由從「圖會過期」換成兩件更根本的事：圖可以整批失效，而且**圖本來就不能被否證**。一張截圖只說
「我看起來覺得對」，寫下來的座標與頁數才說得出「哪裡對、差多少」，讀的人也才有東西可以反駁。

**二、圖沒有出處，而且連 repo 都不在。** [ADR-0007](0007-pr-evidence-is-captured-on-the-host.md)
已經放棄了「圖有映像與 Dockerfile 的 SHA 釘著」，這裡再放棄「圖在 repo 裡、跟著那次 commit 走」。一個
pr-image 的 URL 什麼都不編碼，不知道是哪個 commit、哪台機器、哪個瀏覽器版本截出來的。那些只存在於 PR
說明的文字裡，寫了才有。

**三、圖離開了 GitHub 的權限範圍，而且不會自己回來。** pr-image 的 URL 是公開的，沒有認證，拿到 URL 的人
就看得到那張圖。前一版至少有 30 天的期限，現在沒有了：傳錯的圖會一直公開，直到有人進 Vercel 後台手動刪掉。
pr-image 本身沒有刪除的指令。所以〈不要截版權內的書〉與〈不要截帶著自己帳號的畫面〉兩條比以前更要緊。

**四、多一個外部相依，而且綁著方案的條款。** Vercel 的免費 Hobby 方案只限非商業用途，而 Tidemarks
有付費方案，所以 store 要開在哪個方案底下，要照條款判斷，不是技術上做得到就好。沒裝 pr-image 或沒有
token 的時候圖就是放不了，文件寫的是「先裝，不要退回舊做法」，因為那條舊做法正是這份 ADR 淘汰掉的
東西，退回去等於把兩種寫法同時留在 repo 裡。

## 為什麼現在接受這些代價

跟 ADR-0007 同一組理由，射程也一樣：還在上線線之前
（[ADR-0004](0004-development-phase-and-launch-line.md)），實質單人，PR 是寫給自己看的。判讀的價值
幾乎全部發生在開 PR 到合併之間那幾天，就算哪天整個 store 被封，損失的也是早就判讀完的圖。

**什麼時候該回來重讀這一頁**：store 的用量接近額度，或真的被封過一次；store 所在方案的條款有變；
或者開始有第二個人開 PR，那個人要用同一個 store 的 token 還是自備一個，得先決定。
