# RP ID 由部署的人說了算

日期：2026-08-20。

## 決定

WebAuthn 的 **RP ID 一律由部署的人自己填**（build variable `CF_RP_ID`，必填），Worker
**不從送進來的 request 推導它**。官方那一台與自己架的那一份走同一條路，沒有第二套機制。

請求實際打在哪個 hostname 上，只拿來做一件事：**比對**。對不上的時候回一句人看得懂的錯，
而不是讓瀏覽器丟出一個看不出原因的 `SecurityError`。一句話：

> **host 可以用來解釋錯誤，不可以用來決定綁定。**

## 這個問題原本從哪裡來

原本的提案是相反的：`RP_ID` 沒設定的時候，從 request 的 host 推導出來。那個提案有一個具體的
使用者——按下 Deploy to Cloudflare 按鈕自己架一份的人。按鈕會幫他開好 D1、R2、KV，把 id 寫回
他那份設定檔，但它處理不了 `RP_ID`；而按鈕部署出來的網址是 `<worker-name>.workers.dev`，
看起來要等部署完才知道。他填不了，於是 [ADR-0009](0009-open-source-buys-an-exit-not-contributions.md)
要換到的那個退路，會在最後一步斷掉。

**那個使用者不存在了。** [#8](https://github.com/yurenju/tidemarks/issues/8) 把部署路徑統一成
「一律從 Workers Builds 的 build variables 產生設定」之後，資源 id 根本不進設定檔——而「自動
開資源並把 id 寫回設定檔」正是按鈕唯一要解決的事。按鈕那條路因此在
[#3](https://github.com/yurenju/tidemarks/issues/3) 被放棄了。

於是自架的人跟官方走一模一樣的路：在自己的 Cloudflare 帳號開資源、接上 Workers Builds、填同
一批 build variables、`npm run deploy`。他本來就要填七個值，多填一個 hostname 不是額外的負擔，
而且 [docs/deployment.md](../deployment.md) 已經教他怎麼在部署**之前**把那個值看出來：
`<CF_WORKER_NAME>.<你帳號的子網域>.workers.dev`，兩截在 dashboard 上都拿得到。

換句話說，「`RP_ID` 沒設定」這個狀態在這個專案裡不存在。`scripts/deploy.ts` 缺任何一個必填變數
就停掉 build，停在 build log 裡，不會停在半年後某個讀者的登入畫面上。

## 就算它存在，這條路也不該走

上面說的是「不需要」。這一節說的是「不想要」，因為需求會回來，理由不會。

**RP ID 是不可逆的綁定。** passkey 註冊完就跟那個值綁死，值換掉，舊的 passkey 全部作廢
（ADR-0029 為了選網域也付過同一筆代價）。從 host 推導，等於讓外面送進來的請求決定使用者的
passkey 綁在哪個網域上。今天 Cloudflare 的路由讓這個集合剛好等於「部署者自己控制的網域」，
但那是 Cloudflare 的實作細節替我們擋著，不是我們自己的設計擋著。**把一個不可逆的東西架在
別人的實作細節上，是那種出事的時候完全無法補救的安排。**

**而且它會把安靜的失敗換一個入口放回來。** 無狀態的推導表示這個值會跟著 host 走：自架的人先在
`workers.dev` 上註冊了 passkey，之後買了網域接上去，兩個網址都還活著——從新網域登入，passkey
找不到；從舊網址登入，又可以。這正是原本的提案要消滅的那種錯，只是從「部署時填錯」搬到了
「換網域的那一天」，而那一天已經有資料了。

要壓住這件事就得把推導出來的值存起來、用過一次就釘住，於是多一張表、多一條「我要換網域怎麼辦」
的重設流程——為了省掉 dashboard 上的一格輸入框。這個交換不划算。

## 代替方案：比對，不綁定

不推導，填錯的代價還在。而填錯的樣子很難查，這是原本的提案講對的地方——只是症狀跟它寫的不一樣：

- **值填成別人那台的**（照著文件複製貼上最容易發生）→ WebAuthn 規定送給瀏覽器的 RP ID 必須是
  當下這個網域、或它的上層可註冊網域，所以瀏覽器在 `navigator.credentials.create()` 就擋下來，
  丟一個 `SecurityError`。
- **值整個沒設** → `expectedRPID` 與 `expectedOrigin` 是 undefined，驗證那一步丟錯，畫面上出現
  一句「驗證失敗」。

兩種都是當場壞，不是安靜地壞——但兩種的訊息都看不出這是設定問題。所以 Worker 在 passkey 的入口
自己比一次：`env.RP_ID` 跟這次請求實際的 hostname 對不上，就直接回一句「這台的 RP_ID 設成 X，
你現在連的是 Y」。

三個約束跟這個決定綁在一起，每一個都是「看起來該那樣做、但實際上不行」：

1. **比 hostname，不比 `ORIGIN`。** 本機開發時 Vite 在 5001、`wrangler dev` 在 5002，Worker 看到
   的 origin 永遠跟 `ORIGIN` 對不上，比了就是天天紅燈。hostname（`localhost`）則對得起來。
2. **不能用字串相等。** RP ID 允許是 host 的上層網域（host `app.tidemarks.io` 配 RP_ID
   `tidemarks.io` 是合法的），所以規則是 `host === RP_ID || host.endsWith("." + RP_ID)`。完整的
   WebAuthn 規則還要查 Public Suffix List，擋掉 RP_ID 被設成 `com` 這種吃掉半個網際網路的值；
   **這裡省掉**，因為那個值是部署者自己填進 build variable 的，不是外面送進來的，PSL 防的不是他。
3. **只擋 passkey，magic code 一定要留著。** 那道門不看 RP_ID
   （[ADR-0015](0015-an-account-is-only-as-strong-as-its-inbox.md) 說它才是主要的那一道），設定
   填錯的時候它是唯一還走得通的入口。連它一起擋掉，自架的人就真的進不去自己那台了。

## 後果

**官方那台的 preview 版本上，passkey 本來就不能用。** 版本預覽的網址是
`<version>-<worker>.<子網域>.workers.dev`，跟 `RP_ID` 對不起來。這在這份 ADR 之前就已經是事實，
差別只在於加了比對之後，它從一個莫名其妙的失敗變成一句講清楚的話。要在 preview 上登入就走
magic code——那條路在 preview 上照樣通。

**設定填錯的救援路徑是 magic code。** 對自架的人來說這一句要寫在文件裡：passkey 進不去不等於
這台壞了，用 email 那道門進去（沒有 Resend 的話，登入碼會印在 `npx wrangler tail` 的輸出裡），
把 `CF_RP_ID` 改對、重新部署，再重新註冊一次 passkey。開發階段
（[ADR-0004](0004-development-phase-and-launch-line.md)）之內，舊的 passkey 直接作廢就好。

## 什麼情況下會回頭看這份

如果將來真的出現一條「部署的人不可能事先知道自己的 hostname」的路徑——某種一鍵部署、或者
Cloudflare 改掉 workers.dev 網址的組成方式——那麼這份 ADR 的第一節就失效了，值得重新談。

但第二節不會失效。真的走到那一步的時候，該做的不是無狀態推導，而是「推導一次、寫進資料庫釘住、
之後對不上就明確擋下來」，並且為換網域準備一條重設流程。那是另一份 ADR 的事。
