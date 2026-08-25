# Issue tracker

**工作項目分兩半放**（2026-07-30 起）：

- **bug 與 task 用 GitHub issue**。用 `gh issue create`／`gh issue list`，在這個 repo 底下跑就會落在
  對的地方。PR 用 closing keyword 關它們（見 [pull-requests.md](pull-requests.md)）。
- **spec（有些人稱 PRD）留在 repo 裡**，以 markdown 檔案存放於 `docs/specs/`。它們是隨程式碼一起
  演進的設計文件，跟著 branch 走比放在 issue 裡好。

之所以搬一半而不是全搬：一張 bug 票的價值在於「被看到、被指派、被 PR 關掉」，那是 issue tracker 的
主場；一份 spec 的價值在於「跟這個 branch 的程式碼對得起來」，那是版本控制的主場。

**tracker 只有一個，就是這個 repo 的。** 更早的那些 private repo 已經不再使用，那邊的 issue 也不必
去查——理由見 `CLAUDE.md` 的〈這個 repo 是公開的，而且沒有私有的另一半〉。

同一件事**不要兩邊都放**。這條規則落地時，`.scratch/` 底下原有的 issue 檔全部搬進了 GitHub 並刪除，
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
- spec 引用工作項目時**寫 issue 號加標題**（`#61 死區`），不要寫檔案路徑

⚠️ **號碼會爛。** 這條規則以前寫的是「路徑會爛，號碼不會」，後面那半句已經被推翻了：搬 repo 不會
把號碼一起搬過來，這個 repo 是從 #1 重新編的。

而號碼爛得比路徑安靜。`#61` 在文字裡只是一段字，不會報錯，讀的人（或 agent）在這裡的脈絡下自然
會以為是這個 repo 的 61 號；等這裡真的編到 61 號，那就是一個**看起來對、實際上完全無關**的引用。
路徑爛掉至少點下去是 404。

所以兩種寫法其實都會爛，差別在壞掉的時候看不看得出來。加上標題的成本幾乎是零，換到的是把一個
安靜的錯誤變成讀得懂的線索。

## issue 內文怎麼寫

**假設讀的人沒有 context。** 開 issue 的當下你腦子裡有一整串推論，讀的人（下一個 agent，或三個月
後的你）只有這段文字。所以內文不是待辦事項的清單，是把那串推論交出去。

**第一段先補前提，再講結論。** 別直接從 `## 背景` 開始（#49、#51 就是，讀者要讀完一整段才知道這
張票在氣什麼），但也**不要寫成「第一句就是結論」**——結論幾乎都是用術語寫的，而術語正是新讀者缺的
那個東西。#38 改寫的時候踩過這個坑，第一版是：

> ❌ 同一層的兩個測試檔測到同一個命題時，現在的準則答不出該留哪一個。

「層」是什麼、「準則」在哪、「命題」指什麼，三個都要先知道才讀得懂。要先花一兩句把**現在是怎麼
運作的**講一遍，再說壞在哪：

> ✅ 測試分成幾層，快慢差很多：node 層跑純函式，整套不到五秒；瀏覽器層真的開一本書跑在三家引擎裡，
> CI 上要十分鐘。現在的準則說「同一件事只在最低能證明它的那一層測窮盡」，所以兩層撞在一起的時候留
> node 那份。但兩個檔**在同一層**撞在一起的時候，這條規則給不出答案。

**一段就好，三四句到頂**，然後才進 `## 背景`。⚠️ 要短的是讀者不必知道的推論過程，不是讀者非知道
不可的前提——把前提砍掉換來的不是簡潔，是沒有人看得懂。

**標題負責當結論，第一段負責讓那個結論讀得懂。** GitHub 的 issue 列表與通知只吃得到標題加前面幾十
個字，所以標題要能單獨成立。

接著是四件事，照這個順序：

1. **背景**——這是什麼、現在為什麼要處理它。一到兩段，不要假設對方知道任何前情
2. **要做什麼**——具體到檔案與行號。有選擇的地方**把理由寫出來**，不要只留結論
3. **相依性**——卡在哪張後面、哪張卡在它後面，以及**為什麼**。沒有相依也寫一句「沒有前置」
4. **驗收**——怎樣算做完。要寫成看得出真假的樣子，不要寫「改好了」

另外兩條：

- **危險的地方用 ⚠️ 標出來**，尤其是「照著做會壞掉、而且不會馬上發現」那一類。一張 issue 裡通常
  只有一兩處值得標，標太多就沒有作用了
- **語言用中文，而且是一般的中文**（`CLAUDE.md` 規定 issue 與 PR 內文是中文）。不要寫從英文直接
  翻過來的句子與比喻——讀的人要停下來猜意思的話，那句話就沒有寫成功
- **實作細節收進 `<details>`**：哪個檔、哪個常數、逐項的驗收清單，那些是動手之後才需要的。
  留在外面的是拿來下判斷的東西——⚠️ 的警告、驗收條件、相依性。收起來不等於刪掉

### 一組 bullet 在描述狀態，就畫成圖

GitHub 的 issue 吃 ```mermaid 圍籬。**只在兩種情況畫**：

- **多方來回的時序** → `sequenceDiagram`。#60 的〈現在會發生什麼〉是編號 1–5，牽涉 A 裝置、
  B 裝置、伺服器、B 的本機資料庫四方，讀者要自己排時間軸才看得懂進度為什麼會消失
- **狀態機** → `stateDiagram-v2`。#51 的〈要做什麼〉六條各自在講某個狀態，而狀態之間怎麼轉
  一句都沒寫——「長按到一半手指走遠會怎樣」要從第 2 條與第 6 條各撈半句才拼得出來

其餘不畫。**量測結果與引擎對照用表格**（#27 的 543px／506px／超出 37px、#54 的三家 ✅❌），
表格已經是最好的形式。**不畫相依圖**：GitHub 的原生相依性已經在畫面上顯示「被什麼擋著」，
內文要寫的是**為什麼**擋著。

⚠️ **圖是用來取代文字的，不是加在文字旁邊的。** 畫了就要真的把那串編號或那組 bullet 刪掉。

## 當 skill 說「publish to the issue tracker」

`gh issue create`。只有 spec 才在 `docs/specs/<feature-slug>/` 底下建檔（目錄不存在就一併建立）。

## 當 skill 說「fetch the relevant ticket」

`gh issue view <n>`。若拿到的是檔案路徑，那是 spec（`docs/specs/`）或 wayfinding 的 child
（`.scratch/`），直接讀檔。

## Issue 之間的相依性

GitHub 的 issue 有**原生的相依性**（blocked by／blocking），設好之後 issue 畫面上會直接顯示「被什麼
擋著」，也擋得住不小心提早開工。`gh` 沒有專門的子指令，走 REST API。

⚠️ **API 吃的是 issue 的 numeric id，不是畫面上那個編號。** 這是唯一容易做錯的地方——把編號當
`issue_id` 送進去會綁到完全不相干的另一張票（那個 id 是全 GitHub 唯一的，別的 repo 也算），而且**不會
報錯**。

```sh
# 先換算：#4 的 numeric id
gh api repos/<owner>/<repo>/issues/4 -q .id

# 設「#11 被 #4 擋著」
gh api --method POST repos/<owner>/<repo>/issues/11/dependencies/blocked_by \
  -F issue_id=<#4 的 numeric id>

# 解除（路徑上也是 numeric id）
gh api --method DELETE repos/<owner>/<repo>/issues/11/dependencies/blocked_by/<#4 的 numeric id>
```

查的時候**兩個方向都查一次**，那是最便宜的驗證：

```sh
gh api repos/<owner>/<repo>/issues/11/dependencies/blocked_by -q '[.[].number]'   # → [4, 8]
gh api repos/<owner>/<repo>/issues/4/dependencies/blocking    -q '[.[].number]'   # → [2, 3, 11]
```

**設了相依性，還是要在 issue 內文寫一節〈相依性〉講為什麼。** API 記的是「A 擋著 B」這個事實，讀的人
需要的是理由——是因為檔案會撞、因為順序不能反悔、還是只是比較好做。少了理由，情況變了就沒有人知道
那條線還算不算數。這批 issue 就發生過：方向改掉之後，內文那節還停在舊世界，而事實那一半看起來完全
正常。

**sub-issue 是另一個功能**（`/issues/<n>/sub_issues`），用在「一張大票拆成幾張小票」的層級關係上，
跟這裡的先後關係不是同一件事。目前沒有在用。

## Wayfinding 操作

由 `/wayfinder` 使用，**這一套完全在 `.scratch/` 裡跑**，沒有搬到 GitHub。理由：wayfinding 的
child 是「一個待回答的問題」而不是「一件待做的工作」，它的生命週期只有一次探索那麼長，開成 issue 只會
在 tracker 裡留下一堆沒人要關的票。

同一個理由讓它不進版控：探索收斂之後，該留下來的東西會變成 issue 或 `docs/specs/` 底下的檔案，過程
本身不必跟著 repo 走。代價是換機器、換 worktree 就接不上進度，那是刻意接受的。

**map** 是一個檔案，每張 ticket 對應一個 **child** 檔案。

- **Map**：`.scratch/<effort>/map.md` — 內容為 Notes / Decisions-so-far / Fog。
- **Child ticket**：`.scratch/<effort>/issues/NN-<slug>.md`，從 `01` 開始編號，問題寫在內文。`Type:` line 記錄 ticket 類型（`research`/`prototype`/`grilling`/`task`）；`Status:` line 記錄 `claimed`/`resolved`。
- **Blocking**：頂端附近的 `Blocked by: NN, NN` line。當它列出的每個檔案都是 `resolved` 時，這張 ticket 才解除 block。（GitHub issue 那邊有原生的相依性可以用，見上面那節；wayfinding 這一套刻意留在檔案裡，因為它整組都不進 GitHub。）
- **Frontier**：掃描 `.scratch/<effort>/issues/`，找出 open、未被 block、且未被 claim 的檔案；編號最小者優先。
- **Claim**：動工前先設 `Status: claimed` 並存檔。
- **Resolve**：在 `## Answer` heading 底下附上答案，設 `Status: resolved`，再把一則 context pointer（摘要 + 連結）附加到 `map.md` 的 Decisions-so-far。
