# Pull requests

從 frond 那份同名文件搬過來的（frond 現在是 `packages/frond`，那份已經刪掉，這份是唯一一份），
搬過來時有一處不一樣：**圖在 host 上產，不在容器裡**
（[ADR-0007](../adr/0007-pr-evidence-is-captured-on-the-host.md)）。判讀的部分另外換了一格，理由在
那節。放圖的方式都一樣——用 pr-image，見〈圖怎麼放〉。

改到 `packages/frond` 的 PR 一樣照這份走：兩個 package 的瀏覽器測試都在同一個容器裡跑
（`npm run test:container`），而判讀的五格問的是畫面，跟改的是哪一層無關。

## 內文怎麼排：第一屏，以及收起來的那一半

PR 的說明長是應該的——底下那些證據每一項都有理由。長的問題不在字數，在於**讀者第幾屏才看得到
最終的那組數字**。#62 是最極端的一份：280 行，證據整整寫了兩套，第 60 行那組（h80）已經被第 233
行那組（h66）推翻了，卻排在前面而且長得跟結論一模一樣。

四條：

1. **第一段先補前提，再講結論。** ⚠️ **不要寫成「第一句就是結論」**——結論幾乎都是用術語寫的
   （ADR 給的名字、自己取的元件名、上一張票的編號），而術語正是新讀者缺的那個東西。#64 改寫的
   時候踩過：第一句寫成「〈別處的位置〉的提示在桌機幾乎不會出現」，而〈別處的位置〉是 ADR-0037
   取的名字，沒讀過那份 ADR 的人不知道那是什麼。要先花一兩句講**那個東西是什麼、平常怎麼運作**，
   再說它壞在哪。

   **一段就好，三四句到頂。** 要短的是讀者不必知道的推論過程，不是讀者非知道不可的前提。
   `Closes #N` 降到第二段——GitHub 的通知與列表只吃得到標題加前面幾十個字，所以**標題負責當結論，
   第一段負責讓那個結論讀得懂**。
2. **接著才是做了什麼。**
3. **判讀用的東西放外面，輔助資料收進 `<details>`。** 分的依據是「這個東西是用來下判斷的，還是
   動手之後才需要的」，不是「敘述 vs 證據」。
4. **新一輪的證據是取代不是追加**（見下）。

| 位置 | 放什麼 |
| --- | --- |
| 外面 | 一句話結論 → 脈絡 → 做了什麼 → **截圖** → 五項清單**壓成一行**（「三家皆跑過，五項皆無」）→ **有話要說的那幾個數字** |
| `<details>` | 完整的三家 × 五格表（只在全無的時候折）、完整座標表、〈截圖怎麼產的〉那段 bash、測試清單、CI 細節、被取代的舊證據 |

**截圖一張都不收進 `<details>`。** 很多時候是看了圖才發現不是自己預期的那樣，那正是判讀本身。

**五項清單有任何一項不是「無」，整張表留在外面。** 有缺陷就是要人判讀的。

**數字只留有話要說的那幾個**：推翻了什麼、或主張了什麼。#62 那兩張座標表十幾格裡，真正有話要說的
是三個——`652×66` 置中（推翻了「滿版」）、手機上 `132 → 102`（高度跟措辭脫鉤，這一輪的主張本身）、
`y72` 在 chrome 收起與升起兩張圖裡相同（橫幅不被 chrome 推動）。其餘是背景，整張表折起來。

⚠️ **收起來不等於刪掉。** 一句原文都不刪，只是不佔第一屏——三十天後圖被 R2 刪了，`<details>` 裡的
文字照樣活著。

### 補了一輪之後，舊的那套證據要降級

看了截圖再改一輪是好事，#62 的 `744e398` 就是這樣來的。但**證據不要用追加的方式長第二套**：外面
只留最終的那一套，被推翻的連同「為什麼被取代」收進一個 `<details>`。用追加寫的話，讀者會先讀到一組
已經作廢、但長得跟結論一模一樣的數字。

### mermaid：畫時間與狀態，不畫數量與幾何

PR 內文吃 ```mermaid 圍籬。**只在兩種情況畫**：

- **多方來回的時序** → `sequenceDiagram`。#64 整篇在講「什麼時候會去拉資料」——四個舊觸發時機、
  桌機一個都踩不到、四個新事件各自的節流——現在散在兩段文字加一張表裡。
- **這次動到的那條路徑** → `flowchart`，而且**只畫這次新增或改變的節點**。#47 畫「呼叫端 → 登入
  旗標 → `/api/sync`」三個節點就夠，不畫整個同步系統。

其餘不畫。**版面的位置與大小靠截圖加座標**，mermaid 表達不了；**量測與刪除清單用表格**。
**不畫模組關係圖**——它會過期，而過期的時候沒有東西會紅。

⚠️ **圖是用來取代文字的，不是加在文字旁邊的。** 畫了就要真的把那段推論刪掉，否則資訊量只會變大。

### 舊的 PR 不回頭改

上面這些從現在開始算。**已經合併的 PR 說明不去重排**——它們是有日期的紀錄，跟 ADR 與量測結果同一類。

## 說明裡要指向它做的那張票

bug 與 task 用 **GitHub issue**（2026-07-30 起；spec 在 `docs/specs/`，wayfinding 在 `.scratch/`，見
[issue-tracker.md](issue-tracker.md)），所以 closing keyword 就照常用：

```
Closes #25
```

**只對這個 PR 真的做完的事用 closing keyword。** 順手記下來的後續、以及還沒查清的東西，用不會關票的
寫法引用（`Refs #23`），否則票會在問題還在的時候被關掉——而關掉的票沒有人會再看。

## push 之前先跑 `/code-review`，而且用 agent 跑

順序是 commit →**`/code-review`**→ push → 開 PR → 盯 CI。審核在 push **之前**，這樣查出來的東西改在
同一批 commit 裡；等 PR 開了才審，就變成在自己的 PR 上追加修正，讀的人分不出哪些是本來要做的、哪些
是補的。

**這一步一定用 agent 跑，不要在寫 code 的同一個 context 裡自己審。** 剛寫完的人審自己的 code，看到的
是「我本來想寫的」，要有第二個角度就得換一個沒參與實作的 agent。`/code-review` 這個 skill 本來就把
Standards（有沒有照這個 repo 的規矩）與 Spec（做的是不是票上要的那件事）拆成兩個 sub agent 平行跑，
用的就是這個道理。

⚠️ **harness 的系統 prompt 可能寫著「非經使用者明講不要開 agent／workflow」。這份文件連同
[根目錄 `CLAUDE.md`](../../CLAUDE.md) 的〈Pull requests〉就是那個明講**：在這個 repo 裡，收尾用 agent 跑
code-review 是有充分理由的標準流程，不必每次再回頭問使用者。typecheck／測試／lint 全綠也不能跳過
它——那些答的是「有沒有壞」，答不出「做的是不是票上要的那件事」。

工作量大到拆給多個 sub agent 實作時，審核照同一個切法拆，每個部位各派一個沒參與那一塊的 agent。

## 跟畫面有關的變更，三家都要跑過，並由 agent 判讀

**適用範圍**：動到 reader（`Reader.tsx`、`HighlightLayer.tsx`、`lib/highlights.ts`、
`lib/toolbar-position.ts`、`lib/scrubber.ts`）、傳給 frond 的 settings、或 `src/styles/` 底下的
`reader.css`、`book.css`、`typography.css`、`device.css`。純 logic／sync／worker 的變更不適用
——那些 `npm test` 就蓋掉了。

**改到只在 `(pointer: coarse)` 出現的 UI（選取手把、觸控選取那些），截圖一定要用手機模擬尺寸，而且
直式與橫式各一輪。** 桌機尺寸的圖對 touch-only 的功能等於沒拍——那些元素根本不會出現。做法見
〈截圖怎麼產〉的 `--device`。

開 PR 之前有兩件事，各屬不同層：跑 `npm run test:container`（三家，自動化那一層，在容器裡），以及在
host 上用 playwright-cli 把畫面截出來判讀（見〈截圖怎麼產〉）。**判讀由開 PR 的 agent 自己做**，
**照下面這五項逐項回答，而且只回答這五項**，每項給一個嚴重度：

| 缺陷 | 問的是 |
| --- | --- |
| 溢出 | 內容有沒有跑出 viewer、被裁掉讀不到 |
| 重疊 | 有沒有兩段內容疊在一起，或 highlight 疊在別的字上 |
| 書寫方向 | 直排的字是不是真的由上而下、行由右而左；翻頁方向對不對（直排 left = next） |
| 空白頁 | 有沒有整頁空白或幾乎空白 |
| 錯位 | highlight／選字工具列／Scrubber 拇指有沒有落在該落的位置 |

最後一項是 Tidemarks 換掉 frond 的「裁切」那一格的：字符被切一半是排版層的缺陷，frond 在守；**疊在
book 上的那一層有沒有對準**才是這一層自己的風險，而且是這次遷移新寫的程式碼最容易錯的地方。

**清單只有這五項，不能加、也不能換成「看起來對嗎」——這不是形式。** LLM 的判讀是非決定性的：問
「這張圖看起來對嗎」每跑一次得到不一樣的答案，也沒辦法跟上一個 PR 的判讀比較。固定成這五項、輸出
結構化欄位，判讀才落在欄位上而不是印象上。

（frond 的 [ADR-0001](../../packages/frond/docs/adr/0001-reimplementation-not-port.md)
把這件事叫作「封閉式缺陷清單」，取自問卷的 closed-ended question。這裡不用那個詞——它要讀者先有問卷
那套術語才解得開，而規則本身一句話就講得完。）

判讀結果寫進 PR 說明，**按瀏覽器分開寫**——哪一家出現哪一項本身就是資訊，三家不一致比三家一起壞更
常見。**沒有發現缺陷也要寫**（「三家皆跑過，五項皆無」），否則讀 PR 的人分不出「跑過而沒事」與「根本
沒跑」。三家五項**全無的時候整張表收進 `<details>`，外面留那一行就好**；有任何一項不是「無」，
整張表留在外面（見〈內文怎麼排〉）。

**WebKit 在這一層是跑得動的**，雖然 `packages/app/tests/browser/reader/storage.spec.ts` 那邊仍然 skip 它。那個
skip 是容器裡的暫時性 profile 存不進 Blob，host 上開 `--persistent` 就沒有這件事。所以三家都要有
判讀，沒有一家可以留空。

**這是開 PR 前的作者側檢查，不是 CI 閘門。**

## 圖旁邊一定要附數字

視覺判讀不可省略，也不可單獨採信。截圖是給人看的證據，不是可以被否證的斷言。放圖的同時要寫出量到的
值（矩形座標、頁數、墨水像素數）並指出是哪一條測試在守它。只有圖沒有數字的 PR 說明，等於把「我看起來
覺得對」寫進紀錄。

frond 那邊有一個現成的範例，它的判讀表把「委派段像素有變／指名段像素沒變」兩欄並排，第二欄就是排除
「其實是重排造成的位移」這個混淆變因的對照組。

## 圖怎麼放：`pr-image`

圖用 [pr-image](https://github.com/yurenju/pr-image) 傳到 R2，換一個公開的 URL 回來，直接內嵌進 PR
說明。**圖不 commit 進 repo。**

```bash
pr-image upload --markdown chromium-before.png chromium-after.png
```

印出來的就是可以貼的 Markdown，一個檔一行：

```
![chromium-before](https://pr-image.yurenju.me/OjMjwaQH2zkR4ZXk68M4zA.png)
![chromium-after](https://pr-image.yurenju.me/Bn4GAYpownDGz8Hz8CKZ-Q.png)
```

**alt text 取自檔名**，所以截圖的時候名字就要取好（`chromium-before`、`webkit-reader`），不要
`shot1.png`。不加 `--markdown` 就只印裸的 URL，`url=$(pr-image upload shot.png)` 接得住。

`pr-image: command not found` 的話**先裝，不要退回舊做法**——安裝步驟在
[pr-image 的 README](https://github.com/yurenju/pr-image#per-machine-setup)，要 Cloudflare R2 加
1Password service account，不是 `npm install` 一行就好。裝不起來就把這件事講出來，別自己找替代路徑：
下一段那兩條都試過了，都是死路。

以前這一節寫的是「commit 進 `docs/evidence/`，PR 內文用釘 SHA 的 blob 連結指過去」。那是被 private repo
逼出來的繞路——`raw.githubusercontent.com` 對私有 repo 要認證，Markdown 的 `![](…)` 拿不到憑證，圖會變
破圖；網頁介面拖放產生的 `user-attachments` URL 只有瀏覽器 session 拿得到，`gh` 沒有上傳附件的指令。
pr-image 的 URL 兩件事都不受影響，圖真的內嵌得進去，所以那條繞路連同它的代價（每個 PR 往 git 歷史塞
幾百 KB 的 PNG、讀的人要點進去才看得到）一起不必了。

**代價是圖 30 天後會消失**，bucket 的 lifecycle rule 在刪，沒有東西會提醒你。所以上一節那條「圖旁邊
一定要附數字」在這裡是承重的，不是建議：三十天後回頭看這個 PR，活著的只剩你寫下來的數字，以及判讀表
——判讀表本身用文字寫在 PR 內文裡，它才是可以被否證的那一半。

`docs/evidence/` 已經刪掉了，連目錄都不在——**截圖一律不進 repo，沒有例外，也沒有舊路可以退**。
舊 PR 說明裡指向那些檔案的連結因此是破的；為什麼接受這件事，見
[ADR-0008](../adr/0008-pr-images-are-hosted-not-committed.md) 的補記。

## 截圖怎麼產

在 host 上用 playwright-cli，三家各走一遍**同一串**操作。為什麼在 host 而不在容器、放棄了什麼，見
[ADR-0007](../adr/0007-pr-evidence-is-captured-on-the-host.md)；圖為什麼落在 repo 外面、傳上去而不是
commit，見 [ADR-0008](../adr/0008-pr-images-are-hosted-not-committed.md)。

前提是 dev server 要先起著（`npm run dev`，5001）。**同時開著好幾個 worktree 的時候 5001 會被占住，
而 `npm run dev` 是直接掛掉，不是換一個 port 繼續**（[vite.config.ts](../../packages/app/vite.config.ts)
把 `strictPort` 開著，理由寫在那裡）。掛掉是好事——真的往上飄的話它會坐到 5002，也就是 API 的位置，
而畫面上看不出來。

要換 port 走 `PORT`，別去傳 vite 的旗標：

```bash
PORT=5011 npm run dev
```

換了 port 就把網址一起換掉，下面那支 `pr-evidence.sh` 讀的是 `TIDEMARKS_URL`：

```bash
export TIDEMARKS_URL=http://localhost:5011/
```

⚠️ 換了 port 之後 **sync 那半不會通**：`/api` 與 `/auth` 是 proxy 到 5002 的 `wrangler dev`，那個位置
寫死在 config 裡。只截書架與閱讀的圖不受影響，要驗登入就得把 5001 空出來。

骨架長這樣。**把瀏覽器弄到「可以拍」的那幾行 `source` 進來，中間那段每次現寫**：

```bash
source scripts/pr-evidence.sh
SHOTS=$(mktemp -d)                # 圖落在 repo 外面：它們要傳上去，不是 commit 進來

for B in chromium firefox webkit; do
  pw_fresh "$B" "$B"              # 乾淨的 profile、語言釘成 en
  playwright-cli -s=$B resize 1000 700          # 跟 playwright.config.ts 的 viewport 對齊
                                                # touch-only 的 UI 改用 --device，見下面那條
  pw_import "$B" "$PWD/tests/books/kusamakura-vertical-japanese.epub"
  pw_open_book "$B" "草枕"        # 省略書名就開書架上第一本

  # ── 這次要走的操作，從這裡開始 ──
  # ── 到這裡結束 ──

  pw_fonts_ready "$B"
  playwright-cli -s=$B screenshot --filename=$SHOTS/$B-reader.png   # 檔名會變成 alt text
  playwright-cli -s=$B eval "$MEASURE"    # 要寫進說明的數字，跟圖同一趟，見下面那條
  playwright-cli -s=$B close
done

pr-image upload --markdown "$SHOTS"/*.png   # 印出來的三行直接貼進 PR 說明
```

[`scripts/pr-evidence.sh`](../../scripts/pr-evidence.sh) 只收**每次都一樣的那一段**：開一個乾淨的
瀏覽器、釘語言、把書放進去、打開它。拍的是什麼仍然每次現寫，因為那正是這件事的內容。**這不是把證據
變成一套固定的測試**——那是 `capture-shots.sh` 的巡檢，它在容器裡跑、目的完全不同（ADR-0027）。

為什麼要有這支檔案：這幾行在這個專案的 session 紀錄裡被重寫了三十次以上，而**下面八條坑，每一條都
住在這幾行裡**。5001 被占、`delete-data` 排錯邊、用中文選英文按鈕、`upload` 前面漏了 click——寫進
函式一次，下一個人就不必再從錯誤訊息裡一條一條摸回來。

⚠️ 下面那八條還是要讀。`pr-evidence.sh` 擋掉的是「照著做會踩到」，擋不掉「你自己寫變體時踩回去」，
而**錯誤訊息長什麼樣**仍然要認得——它們多半不指向真正的原因。

**那段 bash 連同填好的操作一起貼進 PR 說明，收在 `<details>` 裡。** 它就是「做法」本身——以前那裡放
的是一段文字描述，現在貼上去的東西跟實際跑過的是同一份。收起來是因為它是重現用的，不是判讀用的
（見〈內文怎麼排〉）；**文字還在**，三十天後圖被刪了它照樣活著。

### ⚠️ 數字跟圖是同一趟，不是兩支腳本

PR 說明要圖，也要量到的數字，而兩者是**同一組操作**走出來的：匯入書、寫進 IndexedDB、開書、reload、
resize。那組 setup 在三家引擎裡跑一遍要兩分鐘上下，而它跟你想量什麼、想拍什麼完全無關。

實際發生過的事：一支 `shots.sh` 拍完圖（122 秒），接著另寫一支 `measure2.sh` 去量數字（137 秒）——
兩支的 SEED 一樣、`stock()` 一樣、三家引擎 × 三個視窗的迴圈一樣，**唯一的差別是最後一行**一個
`screenshot`、一個 `eval`。那 137 秒量的是兩分鐘前就在畫面上的東西。

所以量測寫成一段 `$MEASURE`，跟 `screenshot` 並排放在同一個迴圈裡。開瀏覽器之前先想清楚這一趟要帶
回來什麼，比回頭再開一次便宜得多。

### ⚠️ 要在 host 上量東西就用 playwright-cli，不要自己寫 node script

想量「這個元素現在多寬」的時候，第一個反射通常是寫一支 `import { chromium } from "playwright"` 的
`.mjs`。**這條路在這台機器上一定會卡兩次，而且每次卡的地方一樣：**

1. `playwright` 這個名字不在相依裡（只有 `@playwright/test`），而且從 repo 以外的目錄跑還會多一層
   `Cannot find module`——script 通常寫在暫存目錄，所以兩件事會一起發生。
2. 瀏覽器不在 npm 預設的位置，要自己指 `executablePath` 進 `~/.cache/ms-playwright/`。而那底下**有
   兩份**，長得很像但不是同一個：

   ```
   chromium-1232/chrome-linux64/chrome
   chromium_headless_shell-1232/chrome-headless-shell-linux64/chrome-headless-shell
   ```

這不是推測，是三次各自發生過的事：`pr-55-mobile-testing`（在 code-review 的 sub agent 裡）、
`mattpocock-skills-issue-66`、以及 folis 的 `frontend-ui-ux-review`。三次都靠 `ls ~/.cache/ms-playwright/`
加一發 `sed` 修好，**兩次修出來的路徑還不一樣**，三次都沒有寫下來，所以第三次還是從頭摸。

`playwright-cli eval` 量到的是同一個 `getBoundingClientRect()`，而它已經知道瀏覽器在哪。issue 66 那個
session 一小時之後就在用它做同一件事——所以問題不是不知道有這個工具，是**想到的順序不對**。

真的需要 playwright 的 `page` 物件（例如要開 CDP session 問字型）也不必自己寫 script，
`playwright-cli run-code` 收的就是 `async (page) => {…}`；做法見 [verify.md](verify.md) 的
〈CLI 問不出來的東西〉。

八件會踩到的事。前七件 `pr-evidence.sh` 已經處理掉了——**寫在這裡是為了讓你認得它們的錯誤訊息**，
以及自己寫變體時知道哪幾行不能動：

- **介面上的按鈕用英文選，書名不要。** `Import epub`、`‹ Shelf`、`About <書名>` 都是 Tidemarks 自己
  的文案，而英文是原文（[ADR-0031](../adr/0031-english-is-the-source-and-chinese-becomes-a-translation.md)），
  所以畫面上出現的就是它——**中文選不到**。書名是那本 epub 自己的字，跟介面語言無關，`草枕` 就是
  `草枕`。

  ⚠️ **這一條害過人，而且是從這份文件害的。** 骨架裡曾經寫著 `{ name: '匯入 epub' }`，那是 i18n 之前
  的字；改成英文原文之後沒有人回來更新這裡，於是照著複製貼上的人拿到一個選不到東西的選擇器，而**下
  一行的錯誤訊息指向別的地方**（見下一條）。

  所以連帶一條規矩：**發現這份文件裡的選擇器跟程式碼對不上，就順手把這裡改掉**，跟著你手上那個
  改動一起 commit。不必去掃全部，只改你剛好撞到的那一個——這跟 CLAUDE.md 的〈一次只改手上那個檔案〉
  是同一個節奏。文件裡的選擇器沒有測試在守，唯一會發現它過期的人就是下一個照著做的人。

  **同一件事的另一半：截圖裡的語言要自己釘。** app 的語言是從 `navigator.languages` 挑的
  （[locale.ts](../../packages/app/src/lib/locale.ts) 的 `loadLocale`），所以不釘的話，畫面上是哪種
  語言由**這台機器**決定，不由 app 決定——同一個 PR 換一台機器截就換一種語言，而可比性正是這些圖存在
  的理由。容器裡那兩份 Playwright 設定各釘一行 `en`（CLAUDE.md 的〈瀏覽器那層怎麼找東西〉），host 上
  沒有設定檔可釘，所以骨架自己寫進 `localStorage`，然後 `goto` 一次讓它生效。釘 `en` 是因為英文是原文，
  不可能缺詞條。要看中文或日文的畫面就把那一行的值改掉。

- **一步沒中，後面照樣跑完，而錯誤會出現在別的地方。** ⚠️ **失敗的 playwright-cli 離開碼是 0**，
  錯誤只印在 stdout 的 `### Error`——實測過，`set -e`、`||`、`$?` 三個都攔不到它。所以整串會踩在一個
  沒發生的步驟上跑完。骨架裡最容易中的是 `upload`：**它需要前一行的 `click` 先把檔案選擇器打開**，
  少了那個 click，同一個原因會長出兩種完全不同的症狀。

  ```
  # 症狀一：upload 自己抱怨，但講的不是真正的原因
  The tool "browser_file_upload" can only be used when there is related modal state present.

  # 症狀二：upload 安靜地什麼也沒做，錯誤延到兩行以後才爆
  Error: "getByTestId('book-open').first()" does not match any elements.
  ```

  症狀二特別會騙人，它讀起來像「書還在匯入、等一下就好」，於是就去加 `sleep`——加到幾秒都沒用，因為
  書架**從頭到尾是空的**。四個 session 各自被這兩句話帶偏過。

  `pr-evidence.sh` 的每一次呼叫都走一個 `pw()`，它讀 stdout 找 `### Error`，中了就把整段印到 stderr
  並回 1——那是唯一拿得到的訊號。自己寫的時候要嘛照做，要嘛**不要把輸出導掉**（`>/dev/null 2>&1`
  一加，整串跑完只剩一張看起來像「書沒進去」的圖，連錯誤都看不到）。

  另一個習慣是**一沒中就先 `playwright-cli snapshot`**。snapshot 印的是當下畫面的 aria 樹，上面那次
  一跑就看到 `paragraph: No books yet.`——書架是空的，跟按鈕的名字無關，一行定案。

- **開書要點 `getByTestId('book-open')`，不能用書名選**（`pw_open_book`）**。** 這一行原本寫成
  `getByRole('button', { name: '草枕' })`，那會選到兩個東西：

  ```
  strict mode violation: getByRole('button', { name: '草枕' }) resolved to 2 elements:
      1) <button title="Open 草枕" class="book-cover" data-testid="book-open">
      2) <button aria-label="About 草枕" class="ghost book-more" data-testid="book-more">
  ```

  `getByRole` 的 `name` 預設是**子字串**比對，所以卡片角落那顆 ⋯ 的 `aria-label`（`About 草枕`）也
  被書名選中，strict mode 於是兩個都不點。**書名選不動任何一本書，換一本書也一樣**，這不是 `草枕`
  這三個字的問題。

  後果值得知道：這一行失敗了，**後面那幾行還是會跑完**，於是截出來的是一張書架的圖——如果又把輸出
  導掉（`>/dev/null 2>&1`），連錯誤訊息都看不到，圖看起來就只是「書沒開」。用
  `tests/browser/support/library.ts` 的 `openBook()` 同一個選擇器，順帶讓文件與測試開書的路徑是同
  一條。
- **touch-only 的 UI 要把 `resize` 換成 `--device`，而且裝置名稱大小寫敏感。**

  ```bash
  playwright-cli -s=$B open --browser $B --persistent --device "iPhone 15" http://localhost:5001/
  playwright-cli -s=$B open --browser $B --persistent --device "iPhone 15 landscape" http://localhost:5001/
  ```

  `iphone 15` 這種寫法會被**無聲忽略**，退回 1280x720 的桌機尺寸——不報錯，只是截出來的圖上那些手把
  一個都不會出現，看起來就像功能沒做出來。三家都收 `--device`；Firefox 拿不到 `isMobile`，但拿得到
  viewport 與 `hasTouch`，所以 `(pointer: coarse)` 一樣成立。

  一輪的最小組合是**引擎 × 直式／橫式 × 直排書／橫排書**，外加一張拖曳進行中的（手指還沒放開、
  顏色列還沒出現的那個狀態）。⚠️ 從 host 用滑鼠拖曳在 Firefox 上不會產生 pointer 事件，所以它那張
  只能停在長按。
- **`--persistent` 不能省**（`pw_fresh`）**。** Tidemarks 把 epub body 存成 Blob，而暫時性 profile 存不進去——WebKit 上匯入
  會直接失敗（`Error preparing Blob/File data to be stored in object store`）。
- **`delete-data` 也不能省，而且要夾在兩次 `open` 中間**（`pw_fresh`）**。** `--persistent` 的另一面是資料會留到下一輪，
  上次匯入的書會出現在這次的書架裡。這一行有兩件事要順著它排：**session 沒開著的時候它什麼也不做**
  （不會報錯，只是沒清到），**清完它會把 browser 關掉**。所以順序是開一次給它東西刪、清、再開一次
  拿來用。這一段原本寫成 `delete-data` 在 `open` 前面，照著跑出來的圖，書架上會多一本上一輪讀到一半
  的書——而那種錯誤看起來完全像是這次改動造成的。
- **截圖前要等 `fonts.ready`，不要用 `sleep` 猜**（`pw_fonts_ready`）**。** 少了這一步會截到排版還在飛的畫面：每個字畫在同一
  個位置，跟字型壞掉長得一模一樣。實測 firefox 上 `sleep 3` 不夠。
- **數字用 `eval` 量**，跟 spec 裡的 `expect` 量的是同一個 `getBoundingClientRect()`：

  ```bash
  playwright-cli -s=chromium --raw eval "el => JSON.stringify(el.getBoundingClientRect())" e42
  ```

判讀「重疊」那一格常會需要再往下問一層：**畫出來的字實際上用了哪個 face**。圖上分不出「字型沒有直排
advance」和「排版算錯」，但 CDP 問得到——做法在 [verify.md](verify.md) 的〈CLI 問不出來的東西〉，那段
可以直接貼。（測試映像少一套帶直排 advance 的字型、整節漢字疊在一起那個缺陷拖那麼久才找到，就是
因為當時沒有這個問法。）

### 傳上去的圖是公開的，先想清楚畫面上有什麼

`pr-image` 的 URL 沒有認證，任何拿到它的人都看得到那張圖，30 天內都算數。**repo 是私有的不代表圖是私有
的**，這兩件事在這裡分家了。所以截圖之前先看一眼畫面上有什麼：

- **不要截版權內的書。** 授權不因 repo 私有而改變，而現在圖是真的公開在網路上，不只是「PR 說明會被
  轉貼」的風險。要示範實際排版就用 `tests/books/` 那兩本公版書。
- **不要截帶著自己帳號的畫面。** email、登入碼、token、sync 的伺服器回應——收尾驗證那條路
  （[verify.md](verify.md)）本來就要登入，所以這件事最容易發生在那裡。除錯過程的畫面本身沒問題，
  該遮的是畫面上的身分。

會踩到的時候通常不是「截了一張機密的圖」，而是「截了一張正常的圖，角落有東西」。所以是先看再傳，不是
傳完再回想——傳上去就收不回來了，pr-image 沒有刪除的指令，只有 30 天後 bucket 自己刪。

## PR 開出去之後：盯 CI 到綠

開完 PR 不算做完。**CI 綠了才算**，而開 PR 的 agent 要自己盯到那一刻，紅了就修——不是丟給下一個人
去發現。上面那些是作者側的檢查，這一節是 CI 那一側，兩邊蓋的東西不一樣：容器裡跑過一輪只說「這台機器
上會過」。

### 盯

```bash
gh run list --branch <你的分支> --limit 5          # 拿 run id
gh run watch <run-id> --interval 30 --exit-status  # 卡在這裡等它跑完
gh run view <run-id> --json conclusion,jobs -q '.conclusion, (.jobs[]|"\(.name)\t\(.conclusion)")'
```

⚠️ **不要寫成 `sleep 420; gh run list`。** 一輪 CI 八分鐘，那八分鐘省不掉；`sleep` 多付的是間隔的
尾巴，而 `gh run watch --exit-status` 一結束就回來，寫起來還比較短。

**Checks API 那一整組都不要用**，改用上面的 `gh run`。這不是設定漏開：fine-grained token 的權限
清單裡**沒有 Checks 這一格**，所以去設定頁找也找不到，`gh run view` 自己吐的那句
「it is not currently possible to create a fine-grained PAT with the `checks:read` permission」
是準的。碰到的會是這些：

| 想做的事 | 用不了（Checks） | 改用（Actions） |
| --- | --- | --- |
| 看 PR 的 CI 過了沒 | `gh pr checks <n>` | `gh run list --branch <分支>` |
| 卡著等 CI 跑完 | `gh pr checks <n> --watch` | `gh run watch <run-id> --exit-status` |
| 看某個 commit 的 CI | `gh api .../commits/<sha>/check-runs` | `gh run list --commit <sha>` |
| 逐個 job 的結果 | `gh run view` 的 ANNOTATIONS 段 | `gh api repos/yurenju/tidemarks/actions/runs/<run-id>/jobs` |

換得過來是因為這個 repo 的 CI **只有 GitHub Actions 一家**（`.github/workflows/` 就一支）。Checks
API 的用處是把各家 CI 的結果匯整成一份，只有一家的時候，直接問 Actions 拿到的是同一批資料。哪天接了
Actions 以外的 CI，那家的狀態就真的看不到了。

失敗時 `gh pr checks` 是**吐一串 `Resource not accessible by personal access token` 就結束**，
看起來很像 CI 壞了或 PR 不見了——認得這個訊息，不要往那個方向查。

一輪大約 8 分鐘，四個 job：`test`（Vitest，一分鐘內回報）與 `browser (chromium|firefox|webkit)`
（各自在容器裡跑 frond 與 app 兩套）。

### 紅了先拿到錯誤本文

```bash
gh run view <run-id> --log-failed
```

**它有時會回 `log not found`**，尤其是 job 剛結束那幾分鐘，等一下也不一定會有。這時候走 artifact，
Playwright 的報告每個 engine 各上傳一份：

```bash
gh run download <run-id> -n playwright-report-webkit -D <暫存目錄>
```

要看的是 `app/data/*.md`——Playwright 的 error context，一個失敗一個檔，裡面有錯誤訊息、失敗的那行
程式碼，以及**失敗當下畫面的 aria snapshot**。那份 snapshot 常常比錯誤訊息有用：這次 webkit 紅掉，
訊息是「`book-open` 找不到」，snapshot 顯示的卻是書架上一行「無法匯入 …：Unable to open database
file on disk」——書根本沒進去，跟被斷言的那顆按鈕無關。

### 判斷是不是自己弄壞的

兩件事一起看，不要只看一件：

1. **main 上同一個 job 現在是什麼顏色**（`gh run list --branch main`）。本來就紅的不是你弄的。
2. **在本機容器裡重現**。挑那一個 engine、那一支測試就好，不必跑整套：

   ```bash
   ./scripts/test-in-container.sh --only=app --project=chromium -g "那支測試的名字"
   ```

   改完再跑一次同一行確認，然後三家都跑一遍確認沒有打到別人（`--project=chromium --project=webkit`，
   **逗號分隔不吃**，要重複寫 `--project`）。

   **`--only=app` 不能省。** 少了它，腳本會先跑 frond 那套，而 `-g`（或一個 app 底下的檔案路徑）在
   frond 那邊 match 不到任何測試，Playwright 當成錯誤直接中止，app 那半根本輪不到。

   指定檔案的時候路徑**相對於那個 package**：`tests/browser/reader/paging.spec.ts`，不是
   `packages/app/tests/…`。Playwright 的 cwd 在 package 裡，寫成全路徑一樣是 `No tests found`，而那句
   錯誤看起來像「這支測試不存在」。

   測試檔在映像裡是 `COPY . .` 進去的，所以**改完要重 build**——腳本自己會做，一趟大約十幾秒。這也是
   為什麼這裡叫的是腳本而不是 `podman run`：直接下 podman 跳過的不只是 build，還有 issue #185 的比對，
   而它擋的正是「跑的不是你磁碟上這份 code」。

### 紅的不是你造成的時候

重跑一次確認它是 flaky：

```bash
gh run rerun <run-id> --failed
```

回 `cannot be rerun; Resource not accessible by personal access token` 的話，是那顆 token 的
Actions 只給了 read——重跑要 **Actions: Read and write**。這種時候講出來讓人去按或去補權限，
**不要為了重跑而推空 commit 一直試**，那只是把不穩定的東西洗成綠色。

環境層的紅（容器、IndexedDB、字型、網路）跟這個 PR 的改動分開處理：**開一張 issue 記著，PR 說明裡用
`Refs #N` 指過去**，不要用 closing keyword，也不要順手在這個 PR 裡一起修——兩件事混在一個 diff 裡，
之後沒有人分得出哪個修好了哪個。

## 與收尾驗證的關係

三層，不重疊：

| | 蓋什麼 | 什麼時候 |
| --- | --- | --- |
| `npm test`（Vitest／Node） | 決策模組的純邏輯：方向反轉、TOC 攤平、highlight 裁切、settings 對映 | 每次改動 |
| `npm run test:container`（Playwright／三家，容器裡） | 真的開一本真的書、翻頁、劃重點、拖 Scrubber | 動到 reader 就跑，開 PR 前一定跑 |
| playwright-cli（host 上，[verify.md](verify.md)） | 自動化蓋不到的：需要登入的 sync、真機手勢、拿手上的實際書試 | spec／feature 收尾前 |

收尾驗證不去重驗前兩層蓋掉的東西。它跟這份文件的判讀都跑在 host 的 playwright-cli 上，但仍然是兩件
事：判讀看的是三家排出來的畫面，收尾驗證看的是一條真人會走的流程。
