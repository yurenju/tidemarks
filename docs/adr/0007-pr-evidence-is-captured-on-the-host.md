# PR 的證據圖在 host 產，不再進容器

日期：2026-08-01。

## 決定

開 PR 前那批給人看的截圖，以及 spec／feature 收尾的實際操作驗證，都改用 **host 上的
playwright-cli**。容器只剩一個用途：`npm run test:container`。

跟著退休的有三樣：`scripts/capture-evidence.sh`、`package.json` 的 `evidence` script、
以及 `tests/browser/evidence/` 那種寫完就丟的 spec。做法改寫在
[pull-requests.md](../agents/pull-requests.md) 與 [verify.md](../agents/verify.md)。

**`tests/browser/` 與 `npm run test:container` 一個字都沒改。** 自動化那一層仍然三家同級，任一
紅燈即紅燈，只是本地預設跑一家、三家由 CI 跑，證據圖也預設只做 chromium 一家，碰到
`packages/frond/src/renderer/` 或直排才三家都要截圖
（[ADR-0039](0039-three-engines-are-ci-s-job-not-the-local-loop-s.md)）。這份 ADR 決定的是
**在哪截圖**，那件事沒有變。

## 這推翻了哪一句話

frond 的 [ADR-0004](../../packages/frond/docs/adr/0004-browser-matrix-and-test-environment.md)
寫著「圖只能在容器裡產生」，spine 的 pull-requests.md 照抄了一整節。**spine 從此不跟隨那一句。**

frond 那邊不動，而且不該動：它是公開 repo，外部貢獻者手上沒有同一台機器；它的 fixture 一律指名
字面（`font-family: 'Noto Serif CJK JP'`），host 沒裝那顆就是滿頁 tofu；而且它的證據 spec 用
`page.setContent` 餵合成 HTML，不需要 app、不需要 dev server，playwright-cli 在 spine 這邊最大的
好處，在 frond 那邊等於零。

## 換到了什麼

**一、真的走過 `<input type="file">`。** 這條路現在三層驗證**沒有一層走過**：容器裡的 spec 用
`setInputFiles`，那是 Playwright 直接塞進 input 的；preview 驗證用 `fetch` 拿 blob 再呼叫
`importEpubFile`，verify.md 自己寫著「別跟 `<input type="file">` 硬碰」。playwright-cli 的
`upload` 走的是真的 file chooser，於是 accept 過濾、change handler 這一段第一次有人走。

**二、WebKit 第一次進得了要匯入書的證據。** 容器裡的 WebKit 存不進 Blob
（`tests/browser/reader/storage.spec.ts`），所以三支 reader spec 都 skip 它，PR 說明只能寫
「WebKit：未能執行」。host 上加 `--persistent` 就過了，匯入、開書、翻頁全部正常。那指向存不進去
的是 ephemeral profile 而不是引擎，量測補在 舊 repo 的 #23。

**三、不固定的步驟不必再包成 spec。** 每次判讀要走的操作都不一樣，而那正是 spec 最不擅長的事。
以前要寫一個檔、跑腳本 build 映像、把輸出目錄掛成可寫才拿得到圖；現在截圖直接落在本機的資料夾裡，
再用 pr-image 傳上去（[ADR-0008](0008-pr-images-are-hosted-not-committed.md)）。

## 放棄了什麼

這一節是這份 ADR 存在的理由。四樣，都是真的：

**一、引擎版本跟 CI 不同。** host 的 playwright-cli 0.1.17 帶 playwright-core
`1.62.0-alpha`，容器是 `1.61.1`；chromium 1232 對 1228、firefox 1534 對 1532、webkit 2327 對
2311，三家全差一版。`Dockerfile` 檔頭要求映像版本必須跟 `package.json` 的 `@playwright/test`
對上，那條規則在證據這條路上不再適用。

差一版還有一個反過來的後果：`node_modules` 裡那份 `playwright` **只在容器裡成立**。它照 revision 號
組執行檔的路徑，而 host 的 `~/.cache/ms-playwright` 只有 provisioning 裝的那組，所以在 host 上
`launch()` 會回 `Executable doesn't exist at …/chromium_headless_shell-1228/…`
（舊 repo 的 #57 有四個引擎的完整對照）。host 上要 playwright 本體
的 API（包括 CDP）是從 playwright-cli 的 `run-code` 拿，見
[verify.md](../agents/verify.md)。

**二、沒有 build-time 的字型守門了。** `docker/verify-fonts.sh` 在映像 build 時斷言六組
fontconfig 解析，理由是字型綁錯會**靜默失敗**，沒有東西會 throw，測試照樣全綠，後面每個幾何數字
都建立在錯的字面上（舊 repo 的 #25 就是這樣過了很久才找到）。
host 上沒有等價的東西。接住它的只剩判讀清單裡「重疊」那一格：字型沒有直排 advance 的症狀就是字疊
在一起，而判讀是逐張圖做的。

**三、圖沒有出處。** 容器的圖有映像和 Dockerfile 的 SHA 釘著，host 的圖什麼都沒有。所以「圖變了
是程式改了還是環境變了」這個問題，現在只能靠記憶回答。曾經考慮在 PR 說明附一段環境紀錄（瀏覽器
revision、`fc-match`、三家的直排 advance 量測，跑一次十一秒），**刻意沒有做**，現階段還沒有
需求，而一條每個 PR 都要記得的規則會在第三個 PR 消失。

**四、換一台機器截出來的圖跟這台不可比。** CLAUDE.md 說這個 repo 在 Linux／macOS、x64／arm64
之間輪替，而字型與瀏覽器版本都是那台機器的事。

## 為什麼現在接受這些代價

host 不是「碰巧裝了什麼」，這台 WSL 由 provisioning 釘住字型與瀏覽器，2026-08-01 那次 firefox
直排疊字就是改 provisioning 修好的。**但這個保證的射程要講清楚**：那份 provisioning 的正本在
Windows host 上，兩個 repo 裡沒有任何一行記錄它。`git clone` 到新機器，沒有東西會告訴你要有
Noto CJK。

再加上一件現在為真、以後未必的事：還在上線線之前
（[ADR-0004](0004-development-phase-and-launch-line.md)），實質單人，PR 是寫給自己看的。

**什麼時候該回來重讀這一頁**：兩個 PR 的圖不一樣而你確定那塊程式碼沒動；或者開始有第二個人開 PR。
第一件事會讓「圖沒有出處」立刻變貴，第二件會讓「跨機器不可比」變成每天的問題。
