# 開發階段與上線界線

日期：2026-07-30。**2026-08-04 換掉觸發事件**，理由見〈原本的事件為什麼作廢〉。
**2026-08-07 補上「遞送」與「保存」的區分**，見〈這條線管的是資料，不是遞送〉。
**2026-08-09 把事件釘在 `OPEN_SIGNUP` 上，並加上白名單期間的承諾**，見〈白名單期間〉。
**2026-08-16 加上〈上線前要做完的事〉**。

## 決定

spine 目前是**開發階段**。「上線」定義成一個可觀察的事件：**開放註冊**那一刻，也就是
`OPEN_SIGNUP` 打開的那一刻（見 [CONTEXT.md](../../CONTEXT.md) 的〈開放註冊〉）。規則在那天翻面：

| | 開發階段（現在） | 上線之後 |
| --- | --- | --- |
| frond 的 API | 隨時可改，兩個 repo 一起改 | 同左 |
| CFI 的輸出格式 | 隨時可改 | **契約**，改了要配 migration |
| IndexedDB schema | 隨時可改，**資料可以丟** | migration 要把資料接過去 |
| D1 schema | 隨時可改，**資料可以丟** | migration 要把資料接過去 |

**一條線管全部**，不是三份政策。上線前的 migration 可以丟資料，上線後一律要接過去。

（早期的說法是「上線前不寫 migration」。那句話現在會誤導：schema 兩邊都要有 migration 檔，
差別在裡面能不能 `DROP`。理由見下一節。）

## 上線前要做完的事

有些決定是刻意延後到上線前才做的。它們不會自己冒出來提醒你，而 `OPEN_SIGNUP` 打開的那天你在
做的是別的事。所以清單放在這裡：**讀到「上線是哪一刻」的人，就是需要看到這張清單的人。**

**這張清單現在是空的。** 唯一列過的那條：換掉暫用的產品名，在 2026-08-19 定名、隨後改完了
（[ADR-0029](0029-the-app-is-called-tidemarks.md)）。它會列在這裡是因為改名要動 WebAuthn 的
RP ID，而 RP ID 換了每一把 passkey 都會失效，**只有在使用者還是維護者一個人的時候做得起**。

其他候選（Stripe 從 test mode 切正式、`packages/site` 的四份法律文件）**還沒有被決定成上線的
前置條件**，所以不列。要加就在這裡加，不要另開一份。

## 白名單期間

上線之前有一段**白名單期間**：`OPEN_SIGNUP` 還沒打開，只有名單上的 email 建得了帳號，而名單
上會有幾個不是維護者的人。那段期間仍然算開發階段，**資料還是可以丟**。

線為什麼不掛在「第一個朋友進來」那一刻：白名單存在的唯一目的，是把上線要用的東西全部做齊
（email 註冊、付款），做齊了才開放。那批人是為了這件事進來的，而且**明知資料會被清掉**，
所以他們不翻這條線。

但「可以丟」在那段期間要多兩個條件，否則它會變成一句沒有人打算執行的授權：

- **丟之前寄信通知**，並且**給得出匯出**。這件事做得到，是因為到那時候 spine 手上第一次有
  email（見 [ADR-0015](0015-an-account-is-only-as-strong-as-its-inbox.md)）。
- **付款走 Stripe test mode。** 白名單要驗的是流程跑不跑得通，不是有沒有人願意掏錢，後者要
  等有陌生人的時候才算數。而**收了真的錢就不能再說「資料可以丟」**：「你付錢了，然後我把你
  的筆記清掉，但我有先寄信」正是 [ADR-0011](0011-the-paywall-follows-the-monthly-bill.md)
  〈停止付費之後不刪東西〉花一整節在避免的那類事。

## 這條線管的是資料，不是遞送

「不寫 migration」講的是**不必保住舊資料**，不是「schema 靠手動送上去」。這兩件事一開始混在
一起，因為 D1 的 schema 曾經是靠跑一個 `CREATE TABLE IF NOT EXISTS` 的檔案送上去的，於是**加一
個欄位的時候，那個檔案什麼都不會做**，而且不會有任何跡象：當時的 `npm run db:apply` 印綠色的成功，
真正的症狀要等 worker 上線之後在 runtime 冒出 `no such column`。這個坑跟資料能不能丟無關，
開發階段一樣踩得到。

所以 D1 的 schema 現在走 `migrations/`（`wrangler d1 migrations apply`，由部署指令在上傳
worker 之前跑；那個指令住在 Cloudflare 的 dashboard 裡，抄本在
[deployment.md](../deployment.md)）。**機制現在就有，內容才是那條線管的事**：

| | 開發階段（現在） | 上線之後 |
| --- | --- | --- |
| 要不要寫 migration 檔 | 要，那是 schema 上去的唯一路徑 | 同左 |
| migration 裡能不能 `DROP` | **能**，砍掉重建是合法的一支 | 不能，資料要接過去 |

這樣寫還有一個好處：那條線翻面的那天，要改的只有下一支 migration 怎麼寫，不必同時去搭一套
從來沒跑過的機制。

IndexedDB 那半不受影響：`db.ts` 的 `db.version(n).stores(...)` 本來就是 Dexie 的 migration
機制，一樣是「機制在、內容可以是破壞性的」。

## 為什麼這件事需要寫下來

因為看起來不成立：spine **已經部署了**：`wrangler.jsonc` 裡是真的自訂網域
`app.folis.ink`、真的 D1 database id、真的 R2 bucket。任何人讀了那份設定都會判斷
「這已經上線了」。

「還沒上線」成立的意義不是「沒有資料」，是**「只有我的資料」**。我自己的閱讀進度我可以
決定丟掉，別人的不行。所以這條界線劃的是「誰的資料」，不是部署狀態，而它必須可觀察，
否則 agent 沒辦法自己判斷現在站在哪一邊。

這個許可已經行使過一次：`src/lib/db.ts` 的 v1→v2 註解寫著 `No upgrade logic by design:
pre-sync data is not migrated (confirmed decision)`。這份 ADR 是把那次的臨場決定升成規則，
並且給它一個結束時間。

## 原本的事件為什麼作廢

原本的觸發事件是**「拿掉 passkey-only、開放一般 email 註冊」那一刻**。當時判斷它在收費的
計畫下**永遠不會發生**，理由有兩條，而**兩條在 2026-08-09 都作廢了**（見
[ADR-0015](0015-an-account-is-only-as-strong-as-its-inbox.md)）：

| 當時寫的 | 現在 |
| --- | --- |
| 「passkey-only 是對的產品決定，沒有理由拿掉」 | 有理由：弄丟所有 passkey 等於筆記沒了，而那個代價要由第一個非維護者的使用者承受 |
| 「收費走 Stripe，email 是 Stripe 收的，spine 手上一個都不會有」 | spine 自己收 email 了，因為 magic code 要用，而 [ADR-0011](0011-the-paywall-follows-the-monthly-bill.md) 承諾的「到期前寄信通知」本來就需要它 |

**但換線的判斷本身沒有被推翻，所以線不改回去。** 當時的推理是：**一條永遠不會翻的線比沒有線
更糟**，它會讓 `CLAUDE.md` 一直對每一個 agent 說「資料可以丟」，而那時候付費使用者的書和五年
的筆記正躺在 D1 裡。這句話今天一樣成立，而且更明顯，email 註冊現在**在白名單期間就已經發生
了**，如果線還掛在它身上，那條線已經翻過去了，而東西一件都還沒做齊。

新的事件抓的是這份 ADR 本來就要抓的那件事：**資料開始屬於別人了**，而不是某個實作機制。
它一樣可觀察，一樣不需要判斷，而且不管將來走哪條付款路徑都會踩到。

**2026-08-09 把它從「`users` 表有幾列」改釘在 `OPEN_SIGNUP` 上**，因為白名單期間表裡本來就
會有別人。設定檔裡的一行比資料庫的狀態更好判斷，而且切開放註冊會留下一個 commit，上線該有
一個看得見的時刻。

寫「註冊」不寫「付費」是刻意的：**免費試用的帳號一樣有資料在伺服器上**，那些資料一樣不能丟。

## CFI 是資料，不是 API

`progress.cfi` 與 `annotations.cfiRange` 存的是 frond 產生的字串，在 IndexedDB（每一台裝置）
與 D1（伺服器）各有一份。所以它跟 frond 的其他公開介面**代價完全不對稱**：改一個函式簽名，
兩個 repo 一起改就結束了；改 CFI 的產生方式，要動的是每一台裝置的資料。

真正的風險不是哪天想改 CFI 的設計，是 **frond 修掉一個 CFI 的 bug，然後舊的 CFI 解析到
不同的位置**，那是修正而不是改設計，很容易在沒有人意識到的情況下發生。上線那天起，這種
修正也算 breaking，要配 migration。

**退路存在，但不是免費的。** R2 存著 epub 原檔，而 frond 的 `EpubBook` 零 DOM（`epub-book.ts`
的檔頭自己寫著「neither `document`, nor `DOMParser`, nor any browser object, so it runs in
Node」，`xml.ts` 自帶 parser），所以**在 Worker 裡重算 CFI 是做得到的**；client 端手上也有書。
這條退路是 frond ADR-0005 那個雙層切分換來的。記在這裡是因為需要它的時候不會有人想到它
存在。

## 兩件與上線無關、但一樣走不回頭的事

- **WebAuthn 的 RP ID** 一旦第一個 passkey 註冊就永久釘死在那個 hostname
  （見 [deployment.md](../deployment.md)）。換 hostname 會讓每一把 passkey 失效。
  **但不是死路**：magic code 跟 RP ID 無關，所以「用 magic code 登入 → 加一把新的 passkey」
  搬得過去。自架的人先在 `workers.dev` 上試、之後才換自訂網域，靠的就是這條，文件要講，
  否則沒人知道自己救得回來。（這件事原本由 recovery code 扛，而 recovery code 已隨
  [ADR-0015](0015-an-account-is-only-as-strong-as-its-inbox.md) 拿掉。）
- **拿掉 passkey-only 這件事已經發生了**（[ADR-0015](0015-an-account-is-only-as-strong-as-its-inbox.md)），
  而它**不是上線界線本身**（見〈原本的事件為什麼作廢〉）。它發生在上線之前，所以那支 migration
  可以直接砍掉重建：`recovery_codes` DROP、`users` 重建加 email。passkey 憑證留著，`user_id`
  沒變。如果它晚一年才發生，那會是這份 ADR 涵蓋的所有 migration 裡最大的一次，**在還來得及
  的時候做，是這次真正省下來的東西**。
