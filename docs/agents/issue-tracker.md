# Issue tracker

**工作項目全部放在 GitHub issue**：bug、task、spec，還有 wayfinding 的地圖與 ticket。用
`gh issue create`／`gh issue list`，在這個 repo 底下跑就會落在對的地方。PR 用 closing keyword 關它們
（見 [pull-requests.md](pull-requests.md)）。

這裡說的 skill 是 Matt Pocock 的 skills（[mattpocock/skills](https://github.com/mattpocock/skills)），
下面簡稱 Matt 的 skill。

**PRs as a request surface: no.** 外部的 PR 不當成需求，`/triage` 不處理它們。

**repo 裡只留量測與判讀。** 支撐某個 feature 的量測、判讀、實驗紀錄放在 `docs/specs/<feature-slug>/`，
進版控。它們跟 ADR 的分工是：**ADR 寫決定與為什麼，這裡寫數字與怎麼重驗**。spec 的 issue 連過去。

**tracker 只有一個，就是這個 repo 的。** 更早的那些 private repo 已經不再使用，那邊的 issue 也不必
去查，理由見 `CLAUDE.md` 的〈這個 repo 是公開的，而且沒有私有的另一半〉。

同一件事**不要兩邊都放**：spec 寫在 issue 裡，就不要在 `docs/specs/` 再放一份。內容放兩份必然漂移，
而漂移之後沒有人知道哪一份是真的。

## spec 以前放在 repo 裡

2026-07-30 起 spec 留在 repo 裡：2026-08-07 以前放在 `.scratch/` 底下，之後是
`docs/specs/<feature-slug>/spec.md`。搬出 `.scratch/` 是因為那個名字在說謊：一份 `.scratch/` 底下卻
被 commit 的檔案，讀的人第一個念頭是「這是不是誰不小心加進來的」。留在 repo 裡的理由是它跟著 branch
走，才對得起那個 branch 的程式碼。2026-10-08 改成 issue，理由是：

- **Matt 的 `/to-spec` 與 `/to-tickets` 本來就是這樣用的**：spec 發在 tracker 上，拆出來的 ticket
  掛成它的 sub-issue。放在 repo 裡，等於每次都要跟 skill 說「這裡不一樣」。
- **spec 不寫檔案路徑**（見下面〈spec 怎麼寫〉），所以「跟 branch 的程式碼對得上」這件事本來就不靠它。
  真的要跟程式碼對得上的是量測，而量測留在 repo 裡。

**舊的 spec 留在原地，不搬。** 程式碼、CSS、ADR 裡大約有 50 處引用指向 `docs/specs/*/spec.md`，
搬走就全部斷掉。它們是那段時間的紀錄，新的 spec 不再寫進去。

## 兩個目錄，界線是「會不會 commit」

| | 進版控？ | 放什麼 |
| --- | --- | --- |
| `docs/specs/<feature-slug>/` | **會** | 量測、判讀、實驗紀錄；2026-10-08 以前的 spec |
| `.scratch/` | **不會**（`.gitignore` 擋著） | 暫存：issue 與 PR 內文的草稿、畫面巡檢的圖 |

## 引用工作項目：寫號碼加標題

不管在 issue、量測檔還是程式碼註解裡，引用一張 issue **寫號碼加標題**（`#61 死區`），不要只寫號碼。

⚠️ **號碼會爛。** 這條規則以前寫的是「路徑會爛，號碼不會」，後面那半句已經被推翻了：搬 repo 不會
把號碼一起搬過來，這個 repo 是從 #1 重新編的。

而號碼爛得比路徑安靜。`#61` 在文字裡只是一段字，不會報錯，讀的人（或 agent）在這裡的脈絡下自然
會以為是這個 repo 的 61 號；等這裡真的編到 61 號，那就是一個**看起來對、實際上完全無關**的引用。
路徑爛掉至少點下去是 404。

所以兩種寫法其實都會爛，差別在壞掉的時候看不看得出來。加上標題的成本幾乎是零，換到的是把一個
安靜的錯誤變成讀得懂的線索。

## spec 怎麼寫

`/to-spec` 的模板，標題換成中文：

| Matt 的標題 | 這裡寫成 |
| --- | --- |
| Problem Statement | `## 問題` |
| Solution | `## 解法` |
| User Stories | `## 使用情境`（編號，每條寫成「身為……，我想要……，這樣……」） |
| Implementation Decisions | `## 實作上的決定` |
| Testing Decisions | `## 測試上的決定` |
| Out of Scope | `## 不在範圍內` |
| Further Notes | `## 其他` |

**spec 不寫程式碼的檔案路徑與片段**，那是 Matt 的規則，這裡照用：路徑很快就會過期，而 spec 講的是
「要什麼」。連到 `docs/specs/<feature-slug>/` 的量測不算，那是證據，不是指著程式碼的路徑。例外也照
Matt：prototype 做出來的狀態機、型別這類比文字更精確的片段，可以節錄進對應的決定裡，註明來自
prototype。

這跟下面〈issue 內文怎麼寫〉要求「具體到檔案與行號」不衝突，兩者是不同的東西：**spec 講要什麼，
從它拆出來的 ticket 才講改哪裡**。所以 `/to-tickets` 拆出來的 ticket：

- 掛成 spec 的 sub-issue（`/to-tickets` 本來就這樣做），先後用原生的 blocked by
- 內文照下面那一節的四段寫：背景、要做什麼、相依性、驗收，取代 Matt 的 Parent／What to build／
  Acceptance criteria／Blocked by
- **要寫到檔案與行號**。這條蓋過 `/to-tickets`「不要寫具體路徑」的規定：ticket 是動手時才讀的，
  過期的代價比 spec 小，而少了它，接手的人要從頭找一次

spec 貼 `ready-for-agent` label（見 [triage-labels.md](triage-labels.md)），有量測就連到
`docs/specs/<feature-slug>/`。內文一樣先寫成檔案、跑過 `zh-lint` 再送。

## issue 內文怎麼寫

**先寫成檔案，檢查過中文再送。** 內文不要直接塞進 `gh issue create --body`：

```bash
node scripts/zh-lint.ts .scratch/issue-body.md
```

過了再 `gh issue create --body-file .scratch/issue-body.md`。這樣中文才檢查得到（見
[`.claude/skills/zh-check/SKILL.md`](../../.claude/skills/zh-check/SKILL.md)），而且引號、驚嘆號與
反引號不會被 shell 吃掉。`.scratch/` 被 `.gitignore` 擋著，那個檔案不會進 repo。

**假設讀的人沒有 context。** 開 issue 的當下你腦子裡有一整串推論，讀的人（下一個 agent，或三個月
後的你）只有這段文字。所以內文不是待辦事項的清單，是把那串推論交出去。

**第一段先補前提，再講結論。** 別直接從 `## 背景` 開始（#49、#51 就是，讀者要讀完一整段才知道這
張票在氣什麼），但也**不要寫成「第一句就是結論」**，結論幾乎都是用術語寫的，而術語正是新讀者缺的
那個東西。#38 改寫的時候踩過這個坑，第一版是：

> ❌ 同一層的兩個測試檔測到同一個命題時，現在的準則答不出該留哪一個。

「層」是什麼、「準則」在哪、「命題」指什麼，三個都要先知道才讀得懂。要先花一兩句把**現在是怎麼
運作的**講一遍，再說壞在哪：

> ✅ 測試分成幾層，快慢差很多：node 層跑純函式，整套不到五秒；瀏覽器層真的開一本書跑在三家引擎裡，
> CI 上要十分鐘。現在的準則說「同一件事只在最低能證明它的那一層測窮盡」，所以兩層撞在一起的時候留
> node 那份。但兩個檔**在同一層**撞在一起的時候，這條規則給不出答案。

**一段就好，三四句到頂**，然後才進 `## 背景`。⚠️ 要短的是讀者不必知道的推論過程，不是讀者非知道
不可的前提，把前提砍掉換來的不是簡潔，是沒有人看得懂。

**標題負責當結論，第一段負責讓那個結論讀得懂。** GitHub 的 issue 列表與通知只吃得到標題加前面幾十
個字，所以標題要能單獨成立。

接著是四件事，照這個順序：

1. **背景**：這是什麼、現在為什麼要處理它。一到兩段，不要假設對方知道任何前情
2. **要做什麼**：具體到檔案與行號。有選擇的地方**把理由寫出來**，不要只留結論
3. **相依性**：卡在哪張後面、哪張卡在它後面，以及**為什麼**。沒有相依也寫一句「沒有前置」
4. **驗收**：怎樣算做完。要寫成看得出真假的樣子，不要寫「改好了」

另外兩條：

- **危險的地方用 ⚠️ 標出來**，尤其是「照著做會壞掉、而且不會馬上發現」那一類。一張 issue 裡通常
  只有一兩處值得標，標太多就沒有作用了
- **語言用中文，而且是一般的中文**（`CLAUDE.md` 規定 issue 與 PR 內文是中文）。不要寫從英文直接
  翻過來的句子與比喻，讀的人要停下來猜意思的話，那句話就沒有寫成功
- **實作細節收進 `<details>`**：哪個檔、哪個常數、逐項的驗收清單，那些是動手之後才需要的。
  留在外面的是拿來下判斷的東西：⚠️ 的警告、驗收條件、相依性。收起來不等於刪掉

### 一組 bullet 在描述狀態，就畫成圖

GitHub 的 issue 吃 ```mermaid 圍籬。**只在兩種情況畫**：

- **多方來回的時序** → `sequenceDiagram`。#60 的〈現在會發生什麼〉是編號 1–5，牽涉 A 裝置、
  B 裝置、伺服器、B 的本機資料庫四方，讀者要自己排時間軸才看得懂進度為什麼會消失
- **狀態機** → `stateDiagram-v2`。#51 的〈要做什麼〉六條各自在講某個狀態，而狀態之間怎麼轉
  一句都沒寫，「長按到一半手指走遠會怎樣」要從第 2 條與第 6 條各撈半句才拼得出來

其餘不畫。**量測結果與引擎對照用表格**（#27 的 543px／506px／超出 37px、#54 的三家 ✅❌），
表格已經是最好的形式。**不畫相依圖**：GitHub 的原生相依性已經在畫面上顯示「被什麼擋著」，
內文要寫的是**為什麼**擋著。

⚠️ **圖是用來取代文字的，不是加在文字旁邊的。** 畫了就要真的把那串編號或那組 bullet 刪掉。

## 當 skill 說「publish to the issue tracker」

`gh issue create`，spec 也是。量測與判讀才在 `docs/specs/<feature-slug>/` 底下建檔（目錄不存在就
一併建立）。

## 當 skill 說「fetch the relevant ticket」

`gh issue view <n>`。若拿到的是 `docs/specs/` 底下的檔案路徑，那是量測或 2026-10-08 以前的 spec，
直接讀檔。

## Issue 之間的相依性

GitHub 的 issue 有**原生的相依性**（blocked by／blocking），設好之後 issue 畫面上會直接顯示「被什麼
擋著」，也擋得住不小心提早開工。`gh` 沒有專門的子指令，走 REST API。

⚠️ **API 吃的是 issue 的 numeric id，不是畫面上那個編號。** 這是唯一容易做錯的地方，把編號當
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

查的時候**兩個方向都查一次**，那是最省事的驗證：

```sh
gh api repos/<owner>/<repo>/issues/11/dependencies/blocked_by -q '[.[].number]'   # → [4, 8]
gh api repos/<owner>/<repo>/issues/4/dependencies/blocking    -q '[.[].number]'   # → [2, 3, 11]
```

**設了相依性，還是要在 issue 內文寫一節〈相依性〉講為什麼。** API 記的是「A 擋著 B」這個事實，讀的人
需要的是理由：是因為檔案會撞、因為順序不能反悔、還是只是比較好做。少了理由，情況變了就沒有人知道
那條線還算不算數。這批 issue 就發生過：方向改掉之後，內文那節還停在舊世界，而事實那一半看起來完全
正常。

**sub-issue 是另一個功能**（`/issues/<n>/sub_issues`），用在「一張大票拆成幾張小票」的層級關係上，
跟這裡的先後關係不是同一件事。用在兩個地方：spec 底下掛著從它拆出來的 ticket（見上面〈spec 怎麼寫〉），
wayfinding 的地圖底下掛著它的 ticket（見下一節）。

## Wayfinding 操作

由 `/wayfinder` 使用，**地圖與 ticket 都是 GitHub issue**（2026-10-08 起）。

以前這一套放在 `.scratch/` 的檔案裡，理由是 ticket 的壽命只有一次探索那麼長，開成 issue 只會留下
一堆沒人要關的票。實際跑起來，那個理由站不住，代價倒是很快就碰上了：

- **票會被關掉。** 每張 ticket 回答完就 close，探索走到終點時地圖也 close，tracker 裡不會剩下懸著的票。
- **`.scratch/` 跟著 worktree 走。** 這個 repo 常常一個 worktree 一個 session，也常換機器；另開一個
  session 去做同一張地圖底下的另一張 ticket，它的 worktree 裡根本沒有那張地圖。2026-10-08 的
  筆記呈現那次（後來搬成 #222）就是這樣，只能把絕對路徑塞給新的 session。issue 在哪台機器、
  哪個 worktree 都讀得到。
- **原生的相依性與 sub-issue 正好是 wayfinder 要的**：地圖底下有哪些 ticket、哪些被擋著，在 GitHub
  的畫面上就看得到，不必打開地圖。

代價是**全部公開**。探索中的問題、prototype 的回饋寫上去就收不回來，所以要照
`CLAUDE.md`〈這個 repo 是公開的，而且沒有私有的另一半〉那一條，用給陌生人讀的標準來寫：內文先寫成
檔案、跑過 `zh-lint` 再送（見上面〈issue 內文怎麼寫〉）。

### 對照

| wayfinder 的說法 | 這個 repo 的做法 |
| --- | --- |
| **Map** | 一張貼 `wayfinder:map` label 的 issue，內文是 Destination／Notes／Decisions so far／Not yet specified／Out of scope |
| **Ticket** | 地圖的 **sub-issue**，貼一張類型 label：`wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling`、`wayfinder:task`。問題寫在內文的 `## Question` 底下 |
| **Blocking** | 原生的 blocked by（見上面〈Issue 之間的相依性〉），內文一樣要寫為什麼 |
| **Frontier** | 見下面〈找 frontier〉 |
| **Claim** | 動工前先 `gh issue edit <n> --add-assignee @me`，沒有 assignee 就是沒人認領 |
| **Resolve** | 答案貼成一則留言，`gh issue close <n> --reason completed`，再到地圖的 Decisions so far 加一行，寫成 `- [<ticket 標題>](<連結>) — <一句話的結論>`，用標題指，不要只寫 `#12` |
| **Out of scope** | `gh issue close <n> --reason "not planned"`，地圖的 Out of scope 加一行；不進 Decisions so far |
| **Asset** | 見下面〈prototype 與 research 的成果放哪〉 |

五張 label 已經建好了，新開地圖的時候直接用，不必再建。

### prototype 與 research 的成果放哪

**prototype** 照 Matt 的 `/prototype`，看問題決定做成什麼：

- **要跟真的 app 放在一起才判斷得了**（要用到真的書、chrome、frond 的排版）：在 app 既有的路由上
  加 `?variant=` 切換，這是 `/prototype` 的 UI 做法裡優先的那一種。⚠️ 它的切換列要擋在正式版外，
  Matt 寫的是 `process.env.NODE_ENV`，這裡是 Vite，要用 `import.meta.env.PROD`。
- **一頁假的畫面就回答得了，或問的是邏輯**：做成一個 HTML 檔，可以發成 artifact 方便看。

**程式碼都 commit 到 `prototype/<name>` 分支並推上去，不 merge 進 main。** 驗證過的決定寫進 spec，
實作的時候照 spec 重寫，不把 prototype 的程式碼直接搬過去。ticket 的留言連到那條分支，⚠️ 並且**用
文字寫出試了什麼、回饋是什麼、結論是什麼**：artifact 預設是私人的，在公開的 issue 裡只有維護者打得開。

根目錄的 `prototype/` 是搬 repo 之前留下來的拋棄式頁面，不是放新 prototype 的地方。

**research** 的結論直接貼成 ticket 的留言。wayfinder 原本的做法是把結果 commit 到一條拋棄式的
`research/<name>` 分支、再從 ticket 指過去；這裡不開那條分支，因為結論放在留言裡就跟它回答的問題
放在一起，不必再點到別處。不經 wayfinder、直接叫 `/research` 的時候也一樣：貼成相關 issue 的留言，
沒有相關的 issue 就先開一張。

### 掛 sub-issue

⚠️ **跟相依性一樣，API 吃的是 numeric id，不是編號。**

```sh
# 先換算：#12 的 numeric id
gh api repos/<owner>/<repo>/issues/12 -q .id

# 把 #12 掛到地圖 #10 底下
gh api --method POST repos/<owner>/<repo>/issues/10/sub_issues -F sub_issue_id=<#12 的 numeric id>
```

### 找 frontier

frontier 是同時符合三個條件的 sub-issue：open、沒人認領、擋著它的票都已經 close。
`issue_dependencies_summary.blocked_by` 數的是擋著它而且**還開著**的票，所以等於 0 就是沒被擋：

```sh
gh api repos/<owner>/<repo>/issues/<地圖>/sub_issues --paginate -q '.[]
  | select(.state == "open" and (.assignees | length) == 0 and .issue_dependencies_summary.blocked_by == 0)
  | "#\(.number) \(.title)"'
```

有好幾張的時候，編號最小的先。
