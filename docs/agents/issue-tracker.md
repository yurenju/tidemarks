# Issue tracker

**2026-07-30 起分成兩半：**

- **bug 與 task 用 GitHub issue**（<https://github.com/yurenju/spine/issues>）。用 `gh issue create`
  ／`gh issue list`。PR 用 closing keyword 關它們（見 [pull-requests.md](pull-requests.md)）。
- **spec（有些人稱 PRD）留在 repo 裡**，以 markdown 檔案存放於 `docs/specs/`。它們是隨程式碼一起
  演進的設計文件，跟著 branch 走比放在 issue 裡好。

之所以搬一半而不是全搬：一張 bug 票的價值在於「被看到、被指派、被 PR 關掉」，那是 issue tracker 的
主場；一份 spec 的價值在於「跟這個 branch 的程式碼對得起來」，那是版本控制的主場。

同一件事**不要兩邊都放**。這條規則落地時，`.scratch/` 底下原有的 issue 檔全部搬進了 GitHub（#23–#29）並刪除，
就是為了這個。內容放兩份必然漂移，而漂移之後沒有人知道哪一份是真的。

## 兩個目錄，界線是「會不會 commit」

| | 進版控？ | 放什麼 |
| --- | --- | --- |
| `docs/specs/<feature-slug>/` | **會** | spec，以及支撐它的量測與判讀 |
| `.scratch/` | **不會**（`.gitignore` 擋著） | wayfinding，探索過程的暫存 |

spec 曾經也放在 `.scratch/` 底下，2026-08-07 搬出來。理由是那個名字在說謊：一份 `.scratch/` 底下卻
被 commit 的檔案，讀的人第一個念頭是「這是不是誰不小心加進來的」。現在名字跟事實對得上，
`.scratch/` 裡的東西真的不會進版控。

## 慣例（`docs/specs/` 這一半）

**實作 ticket 不放這裡**，那是 GitHub issue 的事。

- 一個 feature 一個目錄：`docs/specs/<feature-slug>/`
- spec 放在 `docs/specs/<feature-slug>/spec.md`
- 支撐這個 feature 的量測、判讀、實驗紀錄放同一個目錄，各自取名（`measurements.md` 這類）。它們跟
  ADR 的分工是：**ADR 寫決定與為什麼，這裡寫數字與怎麼重驗**
- spec 引用工作項目時**寫 issue 號**（`#26`），不要寫檔案路徑。路徑會爛，號碼不會

## issue 內文怎麼寫

**假設讀的人沒有 context。** 開 issue 的當下你腦子裡有一整串推論，讀的人（下一個 agent，或三個月
後的你）只有這段文字。所以內文不是待辦事項的清單，是把那串推論交出去。

四件事，照這個順序：

1. **背景**——這是什麼、現在為什麼要處理它。一到兩段，不要假設對方知道任何前情
2. **要做什麼**——具體到檔案與行號。有選擇的地方**把理由寫出來**，不要只留結論
3. **相依性**——卡在哪張後面、哪張卡在它後面，以及**為什麼**。沒有相依也寫一句「沒有前置」
4. **驗收**——怎樣算做完。要寫成看得出真假的樣子，不要寫「改好了」

另外兩條：

- **危險的地方用 ⚠️ 標出來**，尤其是「照著做會壞掉、而且不會馬上發現」那一類。一張 issue 裡通常
  只有一兩處值得標，標太多就沒有作用了
- **語言用中文，而且是一般的中文**（`CLAUDE.md` 規定 issue 與 PR 內文是中文）。不要寫從英文直接
  翻過來的句子與比喻——讀的人要停下來猜意思的話，那句話就沒有寫成功

## 當 skill 說「publish to the issue tracker」

`gh issue create`。只有 spec 才在 `docs/specs/<feature-slug>/` 底下建檔（目錄不存在就一併建立）。

## 當 skill 說「fetch the relevant ticket」

`gh issue view <n>`。若拿到的是檔案路徑，那是 spec（`docs/specs/`）或 wayfinding 的 child
（`.scratch/`），直接讀檔。

## Wayfinding 操作

由 `/wayfinder` 使用，**這一套完全在 `.scratch/` 裡跑**，沒有搬到 GitHub。理由：wayfinding 的
child 是「一個待回答的問題」而不是「一件待做的工作」，它的生命週期只有一次探索那麼長，開成 issue 只會
在 tracker 裡留下一堆沒人要關的票。

同一個理由讓它不進版控：探索收斂之後，該留下來的東西會變成 issue 或 `docs/specs/` 底下的檔案，過程
本身不必跟著 repo 走。代價是換機器、換 worktree 就接不上進度，那是刻意接受的。

**map** 是一個檔案，每張 ticket 對應一個 **child** 檔案。

- **Map**：`.scratch/<effort>/map.md` — 內容為 Notes / Decisions-so-far / Fog。
- **Child ticket**：`.scratch/<effort>/issues/NN-<slug>.md`，從 `01` 開始編號，問題寫在內文。`Type:` line 記錄 ticket 類型（`research`/`prototype`/`grilling`/`task`）；`Status:` line 記錄 `claimed`/`resolved`。
- **Blocking**：頂端附近的 `Blocked by: NN, NN` line。當它列出的每個檔案都是 `resolved` 時，這張 ticket 才解除 block。
- **Frontier**：掃描 `.scratch/<effort>/issues/`，找出 open、未被 block、且未被 claim 的檔案；編號最小者優先。
- **Claim**：動工前先設 `Status: claimed` 並存檔。
- **Resolve**：在 `## Answer` heading 底下附上答案，設 `Status: resolved`，再把一則 context pointer（摘要 + 連結）附加到 `map.md` 的 Decisions-so-far。
