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

**兩套 ADR 的編號會撞**，所以引用時一定要說清楚是哪一邊的（「frond ADR-0002」加相對路徑），
而且**不要重編**：frond 的 ADR 之間互相引用，重編會把那些引用全部改掉，換不到東西。

## 決定被取代的時候，舊的那份要刪掉

寫一份新的 ADR 取代舊的決定時，**同一批就把舊的那份刪除**。舊決定裡還會影響下一個決定的脈絡，
用**最多三行敘述**寫進新的那份；只是在講「當初怎麼走到這裡」的，刪掉。編號留洞，不要重編。

2026-08-28 以前的規則相反，寫的是「ADR 是有日期的紀錄，內文與檔名一律不改」。那條的原意是不要
竄改當時說過的話，但它的代價是每一份新的 ADR 都得先把舊的複述一遍才講得清楚差在哪，同一個決定
於是留下三四份互相引用的版本，而讀的人要全部讀完才知道現在算數的是哪一句。歷史留在 `git log`
裡，那裡查得到，文件裡不必再留一份。

⚠️ **刪掉之後要改的是「指過去的那句話」，不是連結。** 「見 ADR-0019 訂的兩條」這種寫法本來就
要求讀的人先去讀另一份文件，改寫成直接把那兩條講出來，文件會比原本好讀。

改 `packages/frond/` 底下的東西之前讀它自己那份 `CONTEXT.md`；改 app 讀根目錄那份。碰到兩邊都要
動的，那條線在 `CLAUDE.md` 的〈frond 的邊界〉。

## 使用 glossary 的詞彙

當你的產出提到某個 domain concept（在 issue 標題、重構提案、hypothesis、測試名稱裡），使用 `CONTEXT.md` 定義的術語。不要漂移到 glossary 明確避免的同義詞。

若你需要的 concept 還不在 glossary 裡，這是一個訊號 — 要嘛你正在發明專案沒在用的語言（重新考慮），要嘛存在真正的缺口（記下來給 `/domain-modeling`）。

## 標記 ADR 衝突

若你的產出與既有 ADR 抵觸，明確地把它攤開來講，而不是默默覆蓋：

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
