# Pull requests

從 frond 那份同名文件搬過來的（frond 現在是 `packages/frond`，那份已經刪掉，這份是唯一一份），
搬過來時有一處不一樣：**圖在 host 上產，不在容器裡**
（[ADR-0007](../adr/0007-pr-evidence-is-captured-on-the-host.md)）。判讀的部分另外換了一格，理由在
那節。放圖的方式都一樣——用 pr-image，見〈圖怎麼放〉。

改到 `packages/frond` 的 PR 一樣照這份走：兩個 package 的瀏覽器測試都在同一個容器裡跑
（`npm run test:container`），而判讀的五格問的是畫面，跟改的是哪一層無關。

## 說明裡要指向它做的那張票

bug 與 task 用 **GitHub issue**（2026-07-30 起；spec 在 `docs/specs/`，wayfinding 在 `.scratch/`，見
[issue-tracker.md](issue-tracker.md)），所以 closing keyword 就照常用：

```
Closes #25
```

**只對這個 PR 真的做完的事用 closing keyword。** 順手記下來的後續、以及還沒查清的東西，用不會關票的
寫法引用（`Refs #23`），否則票會在問題還在的時候被關掉——而關掉的票沒有人會再看。

## 跟畫面有關的變更，三家都要跑過，並由 agent 判讀

**適用範圍**：動到 reader（`Reader.tsx`、`HighlightLayer.tsx`、`lib/highlights.ts`、
`lib/toolbar-position.ts`、`lib/scrubber.ts`）、傳給 frond 的 settings、或 `src/styles/` 底下的
`reader.css`、`book.css`、`typography.css`、`device.css`。純 logic／sync／worker 的變更不適用
——那些 `npm test` 就蓋掉了。

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
沒跑」。

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

前提是 dev server 要先起著（`npm run dev`，5001）。骨架長這樣，**中間那段每次現寫**：

```bash
SHOTS=$(mktemp -d)                       # 圖落在 repo 外面：它們要傳上去，不是 commit 進來

for B in chromium firefox webkit; do
  # open 兩次是必要的，理由在下面那條 delete-data
  playwright-cli -s=$B open --browser $B --persistent http://localhost:5001/
  playwright-cli -s=$B delete-data       # 上一輪的書還躺在 profile 裡，不清會混進這次的圖
  playwright-cli -s=$B open --browser $B --persistent http://localhost:5001/
  playwright-cli -s=$B resize 1000 700   # 跟 playwright.config.ts 的 viewport 對齊

  # ── 這次要走的操作，從這裡開始 ──
  playwright-cli -s=$B click "getByRole('button', { name: '匯入 epub' })"
  playwright-cli -s=$B upload "$PWD/tests/books/kusamakura-vertical-japanese.epub"
  playwright-cli -s=$B click "getByTestId('book-open').first()"   # 不是書名，見下面那條
  # ── 到這裡結束 ──

  playwright-cli -s=$B eval "async () => { await document.querySelector('.viewer-mount iframe').contentDocument.fonts.ready }"
  playwright-cli -s=$B screenshot --filename=$SHOTS/$B-reader.png   # 檔名會變成 alt text
  playwright-cli -s=$B close
done

pr-image upload --markdown "$SHOTS"/*.png   # 印出來的三行直接貼進 PR 說明
```

**那段 bash 連同填好的操作一起貼進 PR 說明。** 它就是「做法」本身——以前那裡放的是一段文字描述，現在
貼上去的東西跟實際跑過的是同一份。

五件會踩到的事，骨架裡每一件都對應一行：

- **開書要點 `getByTestId('book-open')`，不能用書名選。** 這一行原本寫成
  `getByRole('button', { name: '草枕' })`，那會選到兩個東西：

  ```
  strict mode violation: getByRole('button', { name: '草枕' }) resolved to 2 elements:
      1) <button title="開啟 草枕" class="book-cover" data-testid="book-open">
      2) <button aria-label="草枕 的詳情" class="ghost book-more" data-testid="book-more">
  ```

  `getByRole` 的 `name` 預設是**子字串**比對，所以卡片角落那顆 ⋯ 的 `aria-label`（`草枕 的詳情`）也
  被書名選中，strict mode 於是兩個都不點。**書名選不動任何一本書，換一本書也一樣**，這不是 `草枕`
  這三個字的問題。

  後果值得知道：這一行失敗了，**後面那幾行還是會跑完**，於是截出來的是一張書架的圖——如果又把輸出
  導掉（`>/dev/null 2>&1`），連錯誤訊息都看不到，圖看起來就只是「書沒開」。用
  `tests/browser/support/library.ts` 的 `openBook()` 同一個選擇器，順帶讓文件與測試開書的路徑是同
  一條。
- **`--persistent` 不能省。** Tidemarks 把 epub body 存成 Blob，而暫時性 profile 存不進去——WebKit 上匯入
  會直接失敗（`Error preparing Blob/File data to be stored in object store`）。
- **`delete-data` 也不能省，而且要夾在兩次 `open` 中間。** `--persistent` 的另一面是資料會留到下一輪，
  上次匯入的書會出現在這次的書架裡。這一行有兩件事要順著它排：**session 沒開著的時候它什麼也不做**
  （不會報錯，只是沒清到），**清完它會把 browser 關掉**。所以順序是開一次給它東西刪、清、再開一次
  拿來用。這一段原本寫成 `delete-data` 在 `open` 前面，照著跑出來的圖，書架上會多一本上一輪讀到一半
  的書——而那種錯誤看起來完全像是這次改動造成的。
- **截圖前要等 `fonts.ready`，不要用 `sleep` 猜。** 少了這一步會截到排版還在飛的畫面：每個字畫在同一
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
   podman build --tag tidemarks-test .
   podman run --rm --init localhost/tidemarks-test npm run test:browser -w app -- --project=chromium -g "那支測試的名字"
   ```

   改完再跑一次同一行確認，然後三家都跑一遍確認沒有打到別人（`--project=chromium --project=webkit`，
   **逗號分隔不吃**，要重複寫 `--project`）。

   直接呼叫 `podman` 而不是 `./scripts/test-in-container.sh`，是因為那支腳本會先跑 frond 那套，而
   `-g` 在 frond 那邊match 不到任何測試，Playwright 會當成錯誤直接中止。整套要跑的時候才用腳本。

   測試檔在映像裡是 `COPY . .` 進去的，所以**改完要重 build**（layer 有 cache，通常十幾秒）。

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
