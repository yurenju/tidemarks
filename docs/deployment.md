# 把 Tidemarks 部署到 Cloudflare

Tidemarks 是一個 monorepo（ADR-0018），部署得出去的那一半是 `packages/app`，`wrangler.jsonc`
與 `migrations/` 都在那裡。底下提到的 npm script **一律從根目錄跑**；直接叫 `wrangler` 的那些
是一次性的資源開通，在哪裡跑都可以。

Tidemarks 跑成**一個** Cloudflare Worker，同時供應 PWA（靜態檔案）、登入端點（`/auth/*`）與
同步 API（`/api/*`）。儲存是 **D1**（結構化資料）與 **R2**（epub 檔與封面），外加一個小小的
**KV** namespace，裝唯讀 MCP server 的 OAuth 授權。

一個帳號就是一個 email，有兩把鑰匙：passkey，以及寄到那個信箱的六位數登入碼。寄信要有服務商，
沒有的話碼會印在 log 裡，見步驟 4。

所有東西住在同一個主機名底下，而**這是整份文件裡唯一事後收不回來的決定**，見〈先決定主機名〉。

## 動手之前

- 一個 Cloudflare 帳號
- `npx wrangler login`（或一組 API token），一次性開通那幾步要用。**非必要**，見〈讓它帶你走一遍〉
- 一個 zone 掛在那個帳號底下的主機名。**非必要**，見步驟 5
- Node.js 與根目錄的 `npm install`，如果你也想在本機跑（一份 lockfile 蓋所有 package）

## 讓它帶你走一遍

```sh
npm run setup:cloudflare
```

[`scripts/setup-cloudflare.sh`](../scripts/setup-cloudflare.sh) 就是底下全部的步驟，照你實際會做的
順序排。它會一頁一頁開給你、說那一頁要做什麼、接住你複製回來的 id，最後印成一張表，貼進 build
variables 那個表單就好。每一步都是瀏覽器裡的一個頁面，所以它**不需要 `wrangler login`**，上面那條
先決條件因此是非必要的。

**它是順序，不是說明。** 理由寫在這份文件裡，而理由正是東西不對勁時你要的東西，那支 script 講不出
某一步為什麼存在。它能做的是不讓你走到最後才發現漏了一步，而這件事很要緊：最容易漏的兩步（**驗證
寄件網域**與**設 `COOKIE_SECRET`**）都會部署成功，然後沒有人登得進去。

Ctrl-C 就停，重跑會接著上次的地方走。它只寫進 `.scratch/`（被 gitignore 擋著），而且**一個秘密都不
寫下來**。

## 一次部署是怎麼設定出來的

**這個 repo 裡沒有任何跟帳號有關的值，你也不要把自己的放進去。**
`packages/app/wrangler.jsonc` 只裝每一份部署都成立的東西；資料庫 id、bucket 名字、主機名與寄件位址
是 **Workers Builds 的 build variables**，住在負責建置的那個 Cloudflare 帳號裡。建置的時候
`scripts/deploy.ts` 把它們併進那個檔案，寫出 `packages/app/wrangler.generated.json`，那份才是真的
交給 wrangler 的設定。

**官方那一份與你自己那一份走的是同一條路**，沒有另一條，而且**沒有從筆電部署這回事**：那些值只有
build 環境拿得到，這正是重點：一次部署是「某個分支上發生的事」，不是「某個人星期二做的事」。

改 `wrangler.jsonc` 塞自己的 id 也會動，但仍然是錯的做法：上游一直在改那幾行，所以在一個公開 repo
的 fork 上，每次 `git pull` 都會在那裡衝突。build variables 只花你一次 dashboard 表單。

那些變數：

| 變數 | | 值 |
|---|---|---|
| `CF_WORKER_NAME` | 必填 | Worker 的名字，例如 `tidemarks` |
| `CF_D1_NAME` | 必填 | D1 資料庫名稱（步驟 2） |
| `CF_D1_ID` | 必填 | D1 的 `database_id`（步驟 2） |
| `CF_R2_BUCKET` | 必填 | R2 bucket 名稱（步驟 2） |
| `CF_KV_ID` | 必填 | KV namespace id（步驟 2） |
| `CF_RP_ID` | 必填 | passkey 綁在哪個主機名上。**第一把 passkey 註冊之後就永久鎖死**，改了等於作廢所有 passkey |
| `CF_ORIGIN` | 必填 | `https://` 加上那個主機名 |
| `CF_ROUTE` | 選填 | 自訂網域。不設的話 Worker 回應在 `<CF_WORKER_NAME>.<你的子網域>.workers.dev` |
| `CF_MAIL_FROM` | 選填 | 登入碼的寄件位址，網域要是 Resend 驗證過的。不設就走完全不靠廠商那條路，見步驟 4 |

**少一個必填的變數，build 就停**，這是刻意的。它**不會**退回去讀 `wrangler.jsonc`，而那份裡面
沒有任何 id：wrangler 會因此去開**第二套**資源，而 build 環境沒辦法把新 id commit 回 repo，那些
id 就這樣掉了，之後每次部署都再開一次，然後失敗在「already exists」（錯誤碼 10014）。這個專案
真的走過這一遭。

build variables 在建置時讀得到、**執行期讀不到**，而這剛好合用：它們的用途是寫出一份設定檔，不是
給 Worker 去讀。Worker 在執行期真的會讀的兩個值（`COOKIE_SECRET` 與 `RESEND_API_KEY`）走的是
Worker 上的 secret，見步驟 3。

### 先決定主機名

`CF_RP_ID` 要在第一次部署之前設好，而且設了之後改不了，改了所有 passkey 一起作廢。所以現在就
決定，不要留到後面：

- **有自訂網域**：用一個專屬的子網域（`tidemarks.example.com`），不要用 apex，這樣 passkey 只綁在
  這個 app 上。那個 zone 要在你的 Cloudflare 帳號底下。`CF_ROUTE` 與 `CF_RP_ID` 都設成它。
- **沒有自訂網域**：你的 Worker 的位址是 `<CF_WORKER_NAME>.<你的子網域>.workers.dev`，而你的子網域
  在部署任何東西之前就看得到，在 dashboard 的 Workers & Pages → Overview。把 `CF_RP_ID` 設成那整個
  主機名，`CF_ROUTE` 不要設。

**設錯了部署照樣成功**：主機名錯不是設定檔錯，而且在有人真的去用 passkey 之前，畫面上什麼都看不
出來。所以 Worker 幫你檢查：在一個 `CF_RP_ID` 蓋不到的主機上要求 passkey，會被拒絕，而且訊息裡把
兩個主機名都寫出來，不是瀏覽器那個沒頭沒尾的 `SecurityError`。

**登入碼刻意不檢查**，這讓它變成回得去的那條路：用寄來的碼登入（沒設 `RESEND_API_KEY` 的話，碼由
`npx wrangler tail` 印出來），改對 `CF_RP_ID`，重新部署，再註冊一次 passkey。用舊值註冊的那把
passkey 反正是回不來的，「事後改不了」講的就是這件事。

`RP_ID` 也可以是主機之上的一層可註冊網域，所以 `example.com` 蓋得到回應在 `app.example.com` 的
Worker。它不能是的，是一個你根本沒有在上面服務的主機名。

## 1. 開儲存資源（一次性）

```sh
# D1 資料庫，記下它回傳的 database_id，那就是 CF_D1_ID
npx wrangler d1 create tidemarks

# R2 bucket（永遠不公開；Worker 會在驗證之後才把物件串流出去）
npx wrangler r2 bucket create tidemarks

# MCP server 的 OAuth 授權要用的 KV namespace，記下它回傳的 id，那就是 CF_KV_ID
npx wrangler kv namespace create OAUTH_KV
```

名字你自己取，填進 `CF_D1_NAME` 與 `CF_R2_BUCKET`。

**這一步不建任何資料表。** migration 由部署那一步套用（步驟 6），而順序正是重點所在：
`wrangler d1 migrations apply` 會把 `packages/app/migrations/` 裡這個資料庫沒看過的全部跑一遍，
並且把跑過什麼記在 `d1_migrations` 這張表裡，所以重跑是安全的，那張記錄表存在的用意就是這個。
加一個欄位等於在那個目錄加一支檔案；改一支既有的 migration，等於在改一件資料庫已經認為自己跑過的事。

KV namespace 列在這裡是刻意的，雖然 wrangler 會主動提議幫你開，理由是上面那個 10014。

## 2. 建 Worker

在 dashboard 走 Workers & Pages → Create → Worker，名字就用你填進 `CF_WORKER_NAME` 的那個。在步驟 6
把它換掉以前，它會先供應一個佔位頁。

它要先於程式碼存在，是因為 **secret 是掛在 Worker 上的**，而下一步需要一個掛得上去的地方。

## 3. 設 secret（一次性）

```sh
# 這個值不需要任何人知道，所以用產生的，不要自己想一個
openssl rand -hex 32 | npx wrangler secret put COOKIE_SECRET --name <CF_WORKER_NAME>
```

- `COOKIE_SECRET`：任何一段夠長的隨機字串。換掉它只會讓正在進行中的登入流程失效，不影響已經建立的
  session。**它是必填的**，而且它是那個**安靜壞掉**的：沒有它的 Worker 部署會成功，然後沒有人登得
  進去。不要留到後面再說。
- `RESEND_API_KEY`：選填，見步驟 4。

## 4. 把登入碼寄出去

一個帳號由 email 命名，而寄到那個信箱的六位數碼是兩把鑰匙的其中一把（另一把是 passkey）。所以總得
有東西去寄信。

**沒有 key 的話什麼都不寄，碼會進 log**，`npx wrangler tail` 看得到。自架那條路全部就是這樣：一份
你自己跑的 Tidemarks 不需要廠商、不需要驗證網域、也不需要動 DNS。手動測登入走的也是這條，見
`docs/agents/verify.md`。

要給別人登入的 Tidemarks 就不夠了，那時候的廠商是 [Resend](https://resend.com)：

1. 在 Resend 的 dashboard 加你的網域，把它要的 DNS 紀錄發出去（SPF、DKIM，以及 return-path 的
   CNAME）。zone 在 Cloudflare 的話，同一個 dashboard 就做得完。
2. 等網域驗證過。在那之前 Resend 拒收每一封信，**沒有人登得進去**。這一步要早點開始，它是會讓你
   乾等的那一步。
3. 把 `CF_MAIL_FROM` 設成**你剛剛驗證過的那個網域上**的一個位址。這一步最常被漏掉，因為在有讀者
   真的去登入以前，沒有任何東西會抱怨。**寄件網域跟 Tidemarks 服務的那個主機名一點關係都沒有**，
   它們是兩個獨立的選擇，而 Resend 只知道你跟它驗證過的那一個。從它沒驗證過的網域寄，每一次要碼
   都會失敗在 403，而讀者看到的是「寄不出登入碼」。
4. 設 key：

   ```sh
   npx wrangler secret put RESEND_API_KEY --name <CF_WORKER_NAME>
   ```

設了 key 卻沒有 `CF_MAIL_FROM` 的話，它會**大聲拒絕**，而不是安靜退回去印 log。一份自認為在寄信的
部署，絕對不可以把登入碼默默印在讀得到的 log 裡。

真的寄失敗的時候，理由寫在 Worker 的 log 裡，而且寫得明白：Resend 回的狀態碼與它送回來的內容。
先讀那個再猜；從瀏覽器上看起來一模一樣的兩種失敗（網域沒驗證、key 錯了），在那裡差一行。

Resend 是 Tidemarks 唯一會對外講話的廠商，它掛掉的時候，session 掉了的人就進不來。session 撐 90 天，
那就是全部的緩衝；**沒有第二家**（見 [ADR-0015](adr/0015-an-account-is-only-as-strong-as-its-inbox.md)）。

## 5. 掛自訂網域（選做）

整步跳過就繼續待在 `*.workers.dev`。

要掛的話，把 `CF_ROUTE` 設成那個主機名，部署會順手開好 DNS 紀錄與憑證，前提是那個 zone 在你的帳號
底下。

## 6. 接上 build，然後部署

程式碼是在這一步真的出去的。Tidemarks 用
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)：Cloudflare 盯著 GitHub
上的 repo，一有 push 就建置並部署。**這是這裡唯一的部署路徑**，沒有筆電那條，因為 build variables
只住在這個 dashboard 裡。

設定是一段 dashboard 流程（Cloudflare dashboard → Workers & Pages → 你的 worker → Settings →
Builds → Connect）。Builds 有 API，但建一份 build 設定需要一組 **build token**（build runner 拿
去部署的那組 API token），而簽出那組 token 要 user 層級的 API 權限（dashboard 的 session 有，
大多數限定範圍的 token 沒有），所以實務上就是走 dashboard。它是一次性的：

1. 接上你的 GitHub 帳號與 repo（還沒裝的話會順便裝 Cloudflare 的 GitHub App）。
2. build 設定：
   - Build command：`npm run build`
   - Deploy command：`npm run deploy`
   - Root directory：`/`
3. 建議的觸發條件（跟 dashboard 的預設一樣）：
   - `main` 分支 → build 加 `npm run deploy`（production）
   - 其他所有分支 → build 加 `npm run versions:upload`（preview 版本，不吃 production 流量）。
     **不要寫 `npx wrangler versions upload`**，理由見下面那段。
4. 把〈一次部署是怎麼設定出來的〉那張表裡的 build variables 填完，然後觸發第一次 build。它會套用
   migration 並且部署。

   **上面那個表單裡的每一個指令都必須是根目錄的 npm script，絕對不要直接叫工具。** 根目錄的
   `package.json` 知道每個 package 住在哪裡，所以搬動 package 的時候，沒有人需要記得回去改
   dashboard 裡的一個表單。寫成 `wrangler` 的指令會在 repo 根目錄找設定，而那裡沒有
   `wrangler.jsonc`。而且它宣告這件事的方式，是 merge 之後的一次部署失敗。上面那個 preview 指令
   當年就是這樣在 app 搬進 `packages/` 的時候壞掉的。

Cloudflare 為此簽出來的 build token 已經蓋得住這裡每一次部署要做的事，D1 也含在內。真的有 build
因為權限失敗的話，見下面那節。

步驟 3 設的 secret 住在 Worker 上、部署換不掉它們，build 環境不需要拿到。

### migration 由 deploy 指令跑，而且只在 `main` 上跑

`wrangler deploy` 不套用 migration，所以總得有別的東西去做。`deploy` 是
`node scripts/deploy.ts production`：產生設定 → 套用 migration → 部署。少了 migration 那一步，一次
加了欄位的 push 就會部署出一個去讀那個欄位、而資料庫還沒有那個欄位的 Worker：**它壞在第一個請求
上，不是壞在部署的時候**。

**它是一支 npm script，不是打進 dashboard 的一串指令**，所以有哪些步驟、順序是什麼，都住在這個 repo
裡，看得到也審得到。dashboard 裡放的是 `npm run deploy`，之後再也不用改。
[Cloudflare 的設定文件](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)給的
deploy 指令範例就是 `npm run deploy`；至於 dashboard 收不收 `a && b` 這種串起來的寫法，文件沒寫，
那是不要往那裡塞的第二個理由。

**只有 production 那個觸發條件會跑 migration。** 分支的 build 一定不能跑：那會在還沒有人 merge 之前，
就把那個分支的 migration 套到 production 的資料庫上，而且沒有回復這回事。preview 版本跟 production
共用同一個 D1，所以在它的分支落地之前，它會比資料庫**少一支** migration，而那個方向才是對的。
`scripts/deploy.ts` 一支檔案同時管兩種模式，就是為了讓這條規則是一個**讀得到的 `if`**，而不是「另一支
script 剛好少寫了一行」。

### build token 要做得到哪些事

Workers Builds 會自己簽一組 API token，而這裡的一次部署要它蓋得住：

| 步驟 | 權限 |
| --- | --- |
| `d1 migrations apply --remote` | D1 Edit |
| 上傳 Worker 與它的靜態檔 | Workers Scripts Edit |
| 第一次部署時建 `OAUTH_KV` | Workers KV Storage Edit |
| 綁定 R2 bucket | Workers R2 Storage Edit |
| 維持自訂網域與它的憑證 | Workers Routes Edit、SSL and Certificates Edit（zone） |

**Workers Builds 簽出來的 token 本來就全部帶著**，2026 年 8 月對著一組真的 token 檢查過，那組還
帶著一長串這個 Worker 根本用不到的產品範圍（Vectorize、Hyperdrive、Cloudchamber、Browser Run……），
那正是自動產生的 token 的特徵，不是人手挑出來的。所以正常情況下不必補任何東西。

不要拿[文件上那份清單](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)當依據，
它比 dashboard 實際簽出來的短，而且**整個漏掉 D1**。有 build 因為權限失敗的時候，直接去讀那組 token。

失敗的方式至少是安全的那一種：migration 那一步報錯，Worker 根本不會被上傳。要認得出它的長相，因為
[CI 裡的 migration 有失敗得很沒有輸出的前科](https://github.com/cloudflare/wrangler-action/issues/221)。

`wrangler d1 migrations apply` 會問你要不要確認；在非互動的 runner 裡它自己回答 yes。

### 為什麼不用 GitHub Actions

Cloudflare 自己對外部 CI 的答案是
[`cloudflare/wrangler-action`](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)，
而把 `d1 migrations apply --remote` 當成它的一個 step，是社群裡常見的形狀。那樣確實比一個 dashboard
設定看得見。

這裡不用，是因為 Workers Builds 已經接上了：兩邊會在同一個 push 上一起發動，而彼此沒有先後，所以
migration 可能落在它要服務的那個 Worker **後面**，而那正是這一整節要防的失敗。**要嘛一條部署路徑，
要嘛零條。** 哪天 Workers Builds 不用了，那個 action 就是回頭路。

兩種形狀 Cloudflare 都沒有寫進文件：
[D1 migration 的參考文件](https://developers.cloudflare.com/d1/reference/migrations/)只講機制，
一個字都沒提部署順序；而 GitHub Actions 的範例部署的是一個不碰資料庫的 Worker。所以這一節是一個
**決定**，不是照著誰的食譜做。

## 7. 誰可以建帳號

`OPEN_SIGNUP` 不存在的期間，一個位址只有在 `signup_allowlist` 這張表裡才建得了帳號。已經存在的帳號
不受影響：閘門站在**建帳號**那一刻，所以把一列刪掉，不會把任何人鎖在他自己的資料外面。

```sh
npx wrangler d1 execute <CF_D1_NAME> --remote \
  --command "INSERT INTO signup_allowlist (email, added_at) VALUES ('reader@example.com', unixepoch() * 1000)"
```

要對所有人開放註冊，就在 `wrangler.jsonc` 的 `vars` 裡加 `"OPEN_SIGNUP": "true"` 再部署，而且是刻意
這樣設計的：對 Tidemarks 自己來說，那一次編輯**就是**上線那條線
（[ADR-0004](adr/0004-development-phase-and-launch-line.md)），它應該在版控裡留下一個 commit。
多加一個朋友則不該需要一次部署，這就是為什麼名單在資料庫裡，而開關不在。

## 在本機跑

兩個行程：Vite 的 dev server（前端）與 `wrangler dev`（API）。Vite 把 `/api` 與 `/auth` 轉給 5002 埠
上的 wrangler。

```sh
# 一次性：本機的 D1 資料表（拉到新的 migration 之後要再跑一次）
npm run db:migrate:local

# 一次性：本機的 secret 與變數
cat > .dev.vars <<'EOF'
RP_ID=localhost
ORIGIN=http://localhost:5001
COOKIE_SECRET=dev-cookie-secret
EOF

npm run worker:dev      # 終端機 1：API 在 :5002
npm run dev             # 終端機 2：app 在 :5001
```

`RP_ID=localhost` 讓你對著 `http://localhost:5001` 註冊與使用**真的** passkey（瀏覽器把 localhost
當成安全來源）。這也是為什麼 `wrangler.jsonc` 裡沒有 `vars` 完全不影響本機開發：那些東西在這裡的
落點是 `.dev.vars`，而它被 gitignore 擋著。本機的 D1／R2 狀態住在 `.wrangler/`（一樣 gitignore）。

這裡沒有 `RESEND_API_KEY`，所以登入碼由 `wrangler dev` 印在它自己那個終端機裡。先把你的位址加進
本機的 `signup_allowlist`，否則碼根本不會發出來：

```sh
npx wrangler d1 execute DB --local \
  --command "INSERT INTO signup_allowlist (email, added_at) VALUES ('you@example.com', 0)"
```

## 營運上要知道的幾件事

- **備份**：D1 有時間點還原（Time Travel）；R2 的物件只會被新增或變成孤兒，不會被就地改寫。app 裡
  的「完整匯出」也會產生一份自己讀得完的 JSON 備份。
- **刪一本書**留的是墓碑，R2 上那個物件**不會**被回收（一個檔案大約 5 MB；哪天儲存真的變成問題再回
  來處理）。
- **session** 撐 90 天。passkey 全丟不等於帳號沒了：用寄來的登入碼回得去，再從帳號面板加一把新的。
  信箱掉了才是另一回事，帳號的強度就跟它一模一樣。
- **登入碼**活 10 分鐘，扛得住五次猜錯，用過一次就作廢。再要一組，上一組就失效。`magic_codes` 裡的
  列會在同一個位址發新碼的時候順手清掉。
