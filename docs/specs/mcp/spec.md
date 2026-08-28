# spine 的 MCP 支援：讀書時切到 agent 就問得到

意圖核心：[docs/intent/2026-07-15-spine-cross-device-reading.md](../../intent/2026-07-15-spine-cross-device-reading.md)

工作項目三件：唯讀（先做）、寫回筆記（待重新審視），以及擋在最前面的「定位下沉到 frond」。

## 要解決什麼

讀書遇到看不懂或想延伸的段落，切到自己常用的 agent app 就能問，**不必手動貼任何東西**。agent 拿得到當前讀到哪、那一段寫了什麼、整個書櫃與所有筆記。

這件事意圖核心一年前就寫進驗收了，接縫也留好了（`worker/index.ts:4`、`worker/auth.ts:152` 的 `SameSite=Lax`）。這份文件補的是當時刻意留空的那些決定。

## 範圍

**做**：OAuth AS、`/mcp`、讀的工具（列書、搜尋、取節、當前位置與內文、筆記）、位置的時間戳、`sendBeacon` 強推。

**不做（延到「寫回筆記」那一件）**：agent 寫回筆記、`annotations` 拆表、`source` 欄位。

## 形狀

### agent 在別的 app 裡，不在 spine 裡

spine 只出一個 remote MCP server；spine 自己不長聊天面板。長了的話等於把一個 LLM 供應商、一把金鑰、一份帳單搬進來，違反意圖核心的第二條（不要引入第二個廠商）。

代價是**手機上要切 app**。意圖核心的第一條是「會不會在手機上多長出一個步驟」，而那條針對的是**管理**動作（匯入、整理書櫃）；這是閱讀當下的動作，那一條不直接適用。這是解讀，不是文件寫的，所以寫在這裡讓後面的人看得到。

**不做 deep link 的「問 AI」按鈕。** 它換到的新鮮度不多（`visibilitychange` → hidden 在切 app 時本來就會觸發），代價卻是維護各家 agent 的 URL scheme，那是會腐爛的東西。使用者的原話是「切到**他們常用的** agent」，那句話的意思就是 agent 可以換，spine 不該綁死在某一家。

同一個理由讓 OAuth 那層一定要收 **Dynamic Client Registration**：不寫死 client id。

### agent 看得到整個書櫃

不是只有正在讀的那本。理由是三個目的裡的第三個，「擴張比書籍更廣的範圍」：讀到一段想到「這跟上個月那本講的是同一件事」，正是 agent 最幫得上忙的時刻，而只給當前這本就看不到那本。

只給書名不給內容更糟：agent 看得到書名卻讀不到內容，只能靠書名瞎猜，比看不到更容易亂講。

實務上的節流不是權限，是**工具的形狀**：列書、搜尋、取某一節，agent 要什麼拿什麼，不是每次對話都把書櫃倒進 context。

### 「閱讀位置」與「當前頁」是兩個東西

這是這份設計最容易糊掉的地方，糊掉之後每個決定都會打架。詞義寫進了 [CONTEXT.md](../../../CONTEXT.md)，這裡講後果：

- **閱讀位置**是一個**點**（`progress.cfi`），跨裝置有意義，server 有。
- **當前頁**是一個**範圍**，是排版的產物（frond 的 CONTEXT.md：「頁是版面的產物，不是書的性質」）。換個 viewport、換個字級就是另一組頁，**server 永遠算不出來**。

讀者嘴上說的「我現在看到的」是後者。所以 frond 要多吐一個事實：當前頁涵蓋的 CFI range。那件事只有 client 知道，而讀者發問的那一刻 client 正好還在，過了那一刻就永遠算不回來。

### 位置一律帶時間戳

離線時推不上去是真的會發生的，那時 agent 拿到的是舊位置，然後很有信心地解釋錯的地方。所以位置這筆資料帶時間戳送出去，工具說明要求 agent 講出「這是幾分鐘前的位置」，講出來讀者才有機會說「不對，我已經翻過去了」。

### `sendBeacon` 強推是承重的，不是收尾

`src/App.tsx:56` 現在只在**變成可見**時 sync，翻頁走 `scheduleSync()` 的 3 秒 debounce。讀者翻完頁馬上切走，那個 timer 在已經被切到背景的分頁裡跑，手機上會被凍結，agent 拿到**上上一頁**，而讀者只會覺得這功能不準。

沒有它，唯讀那一件驗出來的結論不算數。

## 不可逆的決定

### 定位下沉到 frond 的零 DOM 層（frond#84）

**問題**：給一段文字產生 CFI，或給一個 CFI 取出文字，都需要一棵樹加一套跟 renderer **數出同樣數字**的走訪規則。server 有樹（frond 的 `xml.ts`），缺的是後者。

**選的做法**：把「在樹上定位」從 renderer 層下沉到零 DOM 層，同一份走訪跑在 DOM 與非 DOM 兩種樹上。理由與可行性的證據都在 frond#84。

**被否決的替代方案**，以及為什麼：

- **匯入時預建一份全書「純文字 ↔ CFI」對照表。** 那是**導出資料**，一定會有跟來源對不上的一天（走訪的 filter 一改就要重建），而**沒有東西會告訴你該重建**，症狀是筆記錨到隔壁那段，跟靜默指錯是同一種病。它之後可以當**快取**（Workers 的 CPU 不免費）：快取算錯了丟掉重算，第二份真相算錯了會被當成事實。順序不能反。
- **讓 renderer 在 headless DOM 上跑。** 換不到東西：CFI 定位不需要排版，而真的需要排版的（分頁、矩形）headless DOM 也給不了。代價是引入 runtime 相依，而 frond 是零 runtime 相依的。
- **只讓 agent 錨在當前頁**（client 把整頁的段落清單連同各段 CFI 一起送上來）。這條真的可行、而且省事，一度是首選；被換掉是因為它把能力留在錯的層，agent 讀得到全書卻只錨得到一頁，而那條界線是實作限制長出來的，不是設計想要的。

### 真書只當觀察對象

拿真書撞出瀏覽器與 Node 的解析差異，**進 repo 的是那個差異的結構**，不是那本書：用 frond 的 fixture 產生器合成一份最小的書重現它。真書的內文不進 repo、不進測試、不進 PR 說明、不進截圖。

這條跟「書的內文會進 agent 的對話」不衝突，界線是**這份文字會不會離開讀者**：自己的書進自己的 agent 對話是可以的；外洩到 repo、PR、pr-image 那種公開或半公開的地方不行（pr-image 的 URL 沒有認證，見 [ADR-0008](../../adr/0008-pr-images-are-hosted-not-committed.md)）。

## 筆記模型（「寫回筆記」那一件，方向而非規格）

現在的 `Annotation` 把「書上畫的那一段」與「掛在上面的文字」壓在同一列，所以 agent 想留一句話就被迫連帶畫出一段範圍。拆成錨點／重點／筆記三個東西，一個錨點掛 0..N 則筆記，筆記帶 `source`。

**這一段是在 agent 還沒上線時寫的，動手前要先重讀。** 唯讀到底缺什麼，現在沒有證據。

## 做的順序

1. ~~**frond#84**：定位下沉 + 當前頁 range~~ → **做完了**（[frond#85](https://github.com/yurenju/frond/pull/85) 已 merge，發版 `0.4.9`；接著 [frond#87](https://github.com/yurenju/frond/pull/87) 補上 `sectionIndexOf` 的公開，發版 **`@yurenju/frond@0.4.10`**）
2. ~~**spine#63**：pin `0.4.10` → OAuth AS + `/mcp` + 讀的工具 + `sendBeacon`~~ → **寫完了**（見底下〈做出來長什麼樣〉）。部署那一側**沒有手動步驟了**，`npm run deploy` 一條就夠：

   - KV namespace：binding 不寫 `id`，wrangler 第一次 deploy 自己建（叫 `spine-oauth-kv`）並把 id 寫回 `wrangler.jsonc`，那個改動要 commit。
   - `progress.page_range`：走 `migrations/0002_progress_page_range.sql`，`deploy` 會在上傳 worker 之前跑掉。順帶把整個 D1 schema 從「跑一個 `CREATE TABLE IF NOT EXISTS` 的檔案」換成 migration，理由見 ADR-0004 新增的〈這條線管的是資料，不是遞送〉。
3. 用一段時間
4. **spine#64**：重讀那張票，再決定要做什麼

跨 repo 的等待期已經過了，所以「先寫不要 push」那條現在不適用，0.4.9 在 npm 上，lockfile 指得到，CI 不會因為新 API 不存在而紅。

### 做出來長什麼樣

| | |
| --- | --- |
| OAuth AS | `@cloudflare/workers-oauth-provider` 包住整個 worker（`worker/index.ts`），原本的 worker 變成 `defaultHandler`。`allowPlainPKCE: false`、收 DCR（`/oauth/register`）、`/oauth/token` 發 token |
| 同意頁 | `worker/authorize.ts`，worker 直接吐 HTML。沒有 session 就轉回 app 登入，登完自己彈回來（`src/lib/authorize-return.ts` 擋 open redirect） |
| passkey 與 OAuth 的接縫 | 就 `completeAuthorization({ userId })` 一行，props 只放 `userId` |
| `/mcp` | 無 session 的 Streamable HTTP，一個 POST 一個 JSON 回應。協定層是純函式（`worker/mcp/protocol.ts`），沒有起 HTTP server 也測得動 |
| 讀的工具 | `list_books`／`get_reading_position`／`get_book_contents`／`get_section_text`／`search_books`／`list_annotations` |
| CFI ↔ 文字 | `worker/mcp/library.ts`，跑在 frond 的零 DOM 層上。讀不出來就是讀不出來，不退回整節開頭 |
| 當前頁 | `progress.pageRange`（D1 的 `page_range`），client 每次 `relocate` 存下來 |
| 強推 | `beaconDirty()`（`src/lib/sync.ts`），`visibilitychange` → hidden 時打 `sendBeacon` |

**沒做的**：MCP server 不主動推東西給 client（GET `/mcp` 直接回 405），因為唯讀的工具沒有東西要推。

### frond 那趟的產出，兩件值得記著

**撞出一個獨立的真 bug**：`xml.ts` 沒做 XML 1.0 §2.11 的行尾正規化，所以 CRLF 寫的書在 frond 這邊比瀏覽器多出 `\r`，跨行的 TOC 標題與 metadata 一直夾著它。是逐字元對照測試抓到的，不是讀程式碼看出來的，這正是當初堅持「對照測試不能留到最後」的那個理由的實例。

**版權書掃過一輪**：34 本、1638 節、667 萬字元、每家瀏覽器各 132,847 個 CFI，三家皆零差異。掃描 spec 是一次性的、不進 repo，輸出只有結構（codepoint、offset、section path），書的內文沒有離開那台機器。

### 一個曾經的缺口，已經補掉

`sectionIndexOf`（「這個 CFI 屬於第幾節」）原本沒進 frond 的公開面，所以拿到一個**存下來的裸 CFI** 時問不出要 parse 哪一節。當時的繞法是「把 section index 另存一份跟著 CFI 走」。

**那個繞法作廢了**（[frond#86](https://github.com/yurenju/frond/issues/86) → 0.4.10）。這裡留著紀錄是因為它示範了一件會重複發生的事：**繞法是 denormalization 的時候，先問那個值是不是本來就推導得出來**。section index 本來就編在 CFI 的 `/6/N` 裡，多存一欄只是多一個會跟 CFI 對不上的東西。缺的是一個 export，不是一個欄位。

## 驗收

- 在手機上讀一本 `tests/books/` 的公版書，**不貼任何東西進 agent**，問「解釋我現在看到的這段」，agent 答的是那一段。
- 翻頁之後**立刻**切去 agent，拿到的是剛翻到的那一頁，不是上一頁。
- agent 答得出「我在別本書裡讀過類似的東西嗎」。
- 離線時去問，agent 會講出「這是幾分鐘前的位置」。

## 回頭要看的

意圖核心留了這題，這份設計就是為了讓它有答案：

> Claude 那塊真的有在用嗎？還是它其實是「聽起來很好但實際上不會做」的功能？

**什麼時候回來看**：唯讀那一件上線、自己用滿兩週之後。如果那時候一次都沒切過去問，「寫回筆記」就不該做，該做的是把這整條路拆掉。
