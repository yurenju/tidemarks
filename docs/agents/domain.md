# Domain Docs

engineering skills 在探索 codebase 時，該如何消費本 repo 的 domain 文件。

## 探索前先讀這些

- 根目錄的 **`CONTEXT.md`**，或
- 根目錄的 **`CONTEXT-MAP.md`**（若存在）— 它指向每個 context 各自的 `CONTEXT.md`，讀取與主題相關的那幾份。
- **`docs/adr/`** — 讀取與你即將動工的區域相關的 ADR。在 multi-context repo 中，也要檢查 `src/<context>/docs/adr/` 裡 context 專屬的決策。

若這些檔案不存在，**安靜地繼續**。不要標記它們缺席，也不要一開始就建議建立。`/domain-modeling` skill（透過 `/grill-with-docs` 與 `/improve-codebase-architecture` 觸發）會在術語或決策真正被釐清時才 lazily 建立它們。

## 檔案結構

Single-context repo（大多數 repo）：

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Multi-context repo（根目錄存在 `CONTEXT-MAP.md`）：

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 這個 repo 的實際形狀

上面那兩種形狀都不完全是這裡。Tidemarks 是 monorepo，而 context 跟著 **package** 走，不是跟著
`src/<context>/`：

```
/
├── CONTEXT.md                   Tidemarks 的：閱讀位置、highlight、書、同步
├── docs/adr/                    Tidemarks 的決定（0001 起）
└── packages/
    ├── app/                     沒有自己的 CONTEXT.md，它就是根目錄那份講的東西
    └── frond/
        ├── CONTEXT.md           渲染層的：Section、頁、CFI、writing mode
        └── docs/adr/            frond 的決定（0001 起，跟上面那組編號重疊）
```

**兩套 ADR 的編號會撞**，所以引用時一定要說清楚是哪一邊的（「frond ADR-0002」加相對路徑）。

## 引用一律寫成 `ADR-0007` 這個形狀

四位數。這條管**所有敘述**：程式碼註解、`CONTEXT.md`、spec、issue 與 PR 內文。

**預設看這句話寫在哪一邊**：`packages/frond/` 底下的裸編號指 frond 那套，其餘指 Tidemarks 那套。
⚠️ **指另一套的時候，`ADR-` 前面一定要帶著 `frond` 這個字**（`frond ADR-0002`、`frond's ADR-0004`
都行），因為那是唯一能把跨過去的引用跟自己那套分開的東西。**「its ADR-0002」不算**，`git grep` 找
不到它，而它讀起來就是 Tidemarks 的 ADR-0002。

理由是這個 repo 有一百多處引用散在原始碼註解與 CSS 裡（光是 frond ADR-0003 就四十幾處）。編號會
因為下面那條規則而搬動，而搬動的時候要找出「哪些指的是這一份」，靠的就是這個寫法。寫「見上一份
排版的決定」或「那份講面板的 ADR」的話，`git grep` 找不到，改號就會漏。

## 一個問題只有一份 ADR

**決定變了的時候，改寫原本那一份**，不開新編號、也不留一份舊的在旁邊。

⚠️ 這條 2026-08-29 換掉了 2026-08-28 訂的「開一份新的、同一批把舊的刪掉」，而那條又換掉了更早
的「ADR 是有日期的紀錄，內文與檔名一律不改」。三條要解的是同一個問題：同一個決定不要留下好幾份
互相引用的版本，讓讀的人得全部讀完才知道現在算數的是哪一句。原地改寫比刪掉多做到一件事：**指過
去的連結不會斷**，而這個 repo 裡指過去的連結有一百多條。

### 「同一個問題」怎麼認

問一句：**這兩份如果同時擺著，讀的人會不會不知道該聽誰的？**

- 會 → 同一個問題，改寫原本那一份。
- 不會 → 兩份講的是不同的事，開新編號。**就算新的那份會影響舊的那份也一樣**：ADR-0039 動到
  frond ADR-0004 訂的「三家瀏覽器同級」，但變的是誰跑，不是那條原則，所以兩份都活著。

### 改寫的時候要做的四件事

1. **標題與檔名跟著換，編號不換。** 這個 repo 的 ADR 標題本身就是結論的一句話，所以
   `ls docs/adr/` 列出來的等於一份決定的目錄；檔名對不上內容的話，那份目錄就會開始騙人。引用一律
   用編號，所以編號不動，指過去的連結全部還活著。
2. **日期那一行寫成 `日期：<原始日期>，<改寫日期> 改寫。`**，後面接一句話交代前一版的標題與它的
   決定。⚠️ 那句話必須包含**舊標題**與**舊決定的一句話摘要**，不能只寫「改寫過」，因為讀的人要先
   知道那裡有東西可找，才會去挖。完整的前一版用 `git log --follow -- docs/adr/<檔名>` 撈得到，那條
   指令寫在這裡就好，不必寫進每一份 ADR。改寫第三次的時候日期只留原始與最新兩個，中間那次交給
   `git`。原始日期不可考就寫「前一版沒有記日期」，同一天改寫就寫「同日改寫」。

   ⚠️ **2026-08-29 搬回來的那五份（ADR-0002、0005、0019、0038、0040）是例外**：它們的前一版是被
   獨立刪掉的另一個檔案，不是被改名的，所以 `--follow` 接不到，它接到的是這份文件自己的歷史。要
   讀那五份的前一版，先用 `git log --diff-filter=D -- docs/adr/` 找出它被刪在哪一個 commit，再
   `git show <commit>^:<舊路徑>`。
3. **拆成兩個 commit**：第一個只做 `git mv`（純改名，rename 偵測一定接得上），第二個才改內容。
   顛倒過來或混在一起，`--follow` 會因為內容相似度不足而斷掉，而那條 `git log` 是這條規則唯一的
   靠山。
4. **決定舊脈絡留多少**：把文件裡每一段拿去問「**這一段還在管現在的程式，或還擋得住下一次同樣的
   提案嗎**」。答得出來就留在文件裡，用自己的話寫成這份文件現在的敘述，不要寫成「以前是這樣」；
   答不出來的整段砍掉，交給第 2 條那句話指路。不訂行數上限，訂了只會分不出好壞。

   ⚠️ **最常被誤砍的是「還在管現在的程式」那一類。** 例：回訪卡改版時砍掉了 `lastShownAt` 的合併
   特例，而那段程式現在還在跑（`merge.ts` 的 `max()` 合併），文件裡沒有它的理由等於沒有人守得住它。

### 兩種會讓編號空出來的情況

- **兩份併成一份** → 留在**比較早**的那個編號，另一個編號空著。0019 與 0025 都在回答「這個 app 叫
  什麼」，併成 ADR-0019，0025 空著。
- **問題換了一套 ADR**（Tidemarks ↔ frond） → **開新的**，舊的那份刪掉、編號空著。同一份 ADR 放不
  進兩套編號裡，而決定的主詞換了：frond ADR-0008 與 frond ADR-0011 談 frond 自己怎麼散布，接手它
  們的 ADR-0017 談的是 Tidemarks 要不要把 frond 收進來，那是這個 repo 對自己的安排。

**決定被取消、而不是被新的答案取代**（那件事整個不做了）：一樣改寫原本那一份，把它改寫成「這件事
不做，以及為什麼」。不要刪檔，因為會有人再提一次，而那時候要讀的正是這一份。

⚠️ **改寫之後要順手改的是「指過去的那句話」，不是連結。** 「見 ADR-0019 訂的兩條」這種寫法本來就
要求讀的人先去讀另一份文件，而它引的那兩條可能已經被改寫掉了。改成直接把那兩條講出來。

改 `packages/frond/` 底下的東西之前讀它自己那份 `CONTEXT.md`；改 app 讀根目錄那份。碰到兩邊都要
動的，那條線在 `CLAUDE.md` 的〈frond 的邊界〉。

## 使用 glossary 的詞彙

當你的產出提到某個 domain concept（在 issue 標題、重構提案、hypothesis、測試名稱裡），使用 `CONTEXT.md` 定義的術語。不要漂移到 glossary 明確避免的同義詞。

若你需要的 concept 還不在 glossary 裡，這是一個訊號 — 要嘛你正在發明專案沒在用的語言（重新考慮），要嘛存在真正的缺口（記下來給 `/domain-modeling`）。

## 標記 ADR 衝突

若你的產出與既有 ADR 抵觸，明確地把它攤開來講，而不是默默覆蓋：

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
