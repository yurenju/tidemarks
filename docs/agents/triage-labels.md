# Triage labels

Matt Pocock 的 skills（[mattpocock/skills](https://github.com/mattpocock/skills)）用五個角色講 triage，
這份把角色對到這個 repo 實際的 label。label 的字串跟角色同名，
沒有改過。

| 角色 | 這裡的 label | 意思 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 維護者還沒看過、還沒分類 |
| `needs-info` | `needs-info` | 在等開票的人補資訊 |
| `ready-for-agent` | `ready-for-agent` | 寫清楚了，agent 自己就能做完；spec 也貼這張 |
| `ready-for-human` | `ready-for-human` | 要人來做（要判斷、要真機、要帳號這類） |
| `wontfix` | `wontfix` | 不做 |

另外兩張分類 label 是 GitHub 原本就有的 `bug` 與 `enhancement`。`flaky` 不是 triage 的角色，它是
另一本帳，見 [flaky.md](flaky.md)。

## `/triage` 在這裡有三處不一樣

**開頭的聲明用中文。** `/triage` 要求每一則它貼出去的留言或開的 issue 都以一行聲明開頭，這裡寫成：

```
> *這則是 AI 在 triage 時產生的。*
```

issue 的內文是中文（`CLAUDE.md` 的語言表），聲明跟著內文走。

**不做的需求不另外記在 `.out-of-scope/`。** Matt 的做法是把拒絕過的需求寫成 `.out-of-scope/` 底下的
檔案，之後有新需求進來就先讀那個目錄，看是不是拒絕過。這裡改成：

- 拒絕一個需求：留言寫清楚為什麼，貼 `wontfix`，`gh issue close <n> --reason "not planned"`
- 查有沒有拒絕過：`gh issue list --state closed --label wontfix --search "<關鍵字>"`

不做的理由跟那張 issue 放在一起，就不必再維護一份會漂移的副本。

**寫給 agent 的說明（Agent Brief）照 ticket 的規矩寫。** `/triage` 的 AGENT-BRIEF.md 要求不寫檔案路徑
與行號，這裡蓋過去：它跟從 spec 拆出來的 ticket 是同一種東西，照
[issue-tracker.md](issue-tracker.md)〈issue 內文怎麼寫〉寫到檔案與行號。模板的標題翻成中文：

| Matt 的 | 這裡寫成 |
| --- | --- |
| `## Agent Brief` | `## 給 agent 的說明` |
| `**Category:**`／`**Summary:**` | `**類別：**`／`**一句話：**` |
| `**Current behavior:**`／`**Desired behavior:**` | `**現在：**`／`**應該：**` |
| `**Key interfaces:**` | `**相關的檔案與介面：**` |
| `**Acceptance criteria:**`／`**Out of scope:**` | `**驗收：**`／`**不在範圍內：**` |
| `## Triage Notes`（needs-info 的模板） | `## Triage 紀錄` |
