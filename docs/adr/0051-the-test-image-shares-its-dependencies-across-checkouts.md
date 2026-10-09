# 測試映像的依賴層由所有 checkout 共用，沒人用的映像由下一次 build 清掉

日期：2026-10-09

容器測試每次都先建一個測試映像，把當下的程式碼烤進去再跑（#185：映像裡的程式碼不是磁碟上那一份
的時候，測試會拒絕執行）。映像名字一個 checkout 一個，因為整台機器共用一個 tag 的時候，別的
checkout 一重建，你這一趟就跑了別人的程式碼而且是綠的（docs/development.md〈測試映像〉）。

這個專案大多在 worktree 裡開發，worktree 的目錄名帶著隨機的後綴，所以**每個 worktree 都會留下一個
以後再也沒人用的映像**。2026-10-09 量到的形狀是這樣：

| | 大小 |
| --- | --- |
| 每個映像都共用的 playwright 基底 | 3.45GB |
| 每個映像自己獨有 | 約 1.5GB |
| 　其中字型、`npm ci` | 約 1.45GB |
| 　其中程式碼與 frond 的 build | 約 50MB |

獨有的 1.5GB 裡，真正每個 checkout 都不一樣的只有最後那 50MB。分層本來就是為了讓 `npm ci` 那層
共用而排的，但實際上沒有共用到：共用靠的是 build cache，而磁碟一滿，清理的人（那天是 agent）就會跑
`docker builder prune`；`apt-get` 與 `npm ci` 每次寫出來的檔案都不完全一樣，所以 cache 一沒了，
內容相同也只能整份重存。孤兒映像沒人收 → 磁碟滿 → 連 cache 一起清 → 每個新映像又多 1.5GB，
這個循環就是 #265 要切斷的。

## 決定

### 一、依賴層變成一個有名字的映像，名字是它內容的 hash

基底、中日文字型、fontconfig、`npm ci` 拆到 `docker/deps.Dockerfile`，建出來的映像叫
`tidemarks-deps:<hash>`。每個 checkout 的映像建在它上面，只做 `COPY . .` 與 frond 的 build。
**共用的是有 tag 的映像，不是 cache**，所以 cache 被清掉，下一個 checkout 照樣用得到。

hash 算的是一個由腳本組出來的 build context，裡面只放依賴層需要的檔案：lockfile、`docker/` 目錄、
**拿掉 `scripts` 的三份 `package.json`**。兩個性質都是這個做法換來的：

- **只差在 `scripts` 的分支共用同一個依賴映像。** 實際發生過：一個分支只在根目錄多了一行
  `"perf"`，就自己多了一份 918MB 的 `npm ci`。
- **漏掉檔案會直接失敗，不會悄悄過期。** 依賴層的 Dockerfile 要 COPY 一個沒放進 context 的檔案，
  build 就失敗；放進 context 的東西一律算進 hash。如果改成「從 Dockerfile 的 COPY 行讀出要算哪些
  檔案」，那份清單就是另一個會跟現實漂開的地方。

拿掉 `scripts` 也就拿掉了 lifecycle script。三份裡只有根目錄的 `prepare`（把 git 的 hooks 指到
`.githooks/`），而映像裡沒有 `.git`，它在那裡本來就沒有作用。

### 二、每次 build 之前，清掉沒人用得到的映像

刪掉 worktree 的不是這個 repo 的程式（是 Desktop app 或手動的 `git worktree remove`），git 也沒有
「worktree 被刪掉」的 hook。所以第一個有機會發現的，是下一次 build，不管從哪個 checkout 發起。
清理放在 build **之前**，因為磁碟緊的時候正是這次 build 需要空間的時候。

每個 checkout 的映像打上 label：它屬於哪個目錄（絕對路徑）、它建在哪個依賴映像上。能刪的只有三種：

1. **label 指向的目錄已經不存在**的 checkout 映像。用目錄判斷而不是比對 `git worktree list`，因為
   後者會把另一份 clone 的映像當成孤兒，名字也可能撞在一起。
2. **沒有 tag、而且超過 24 小時**的 checkout 映像：還活著的 checkout 重建之後留下的舊版。不馬上刪，
   是因為 build 完之後腳本會釘住 image id 再分幾次 `docker run`，同一個 checkout 同時跑兩趟的時候，
   後一趟的重建會讓前一趟的映像失去 tag，這時刪掉它，前一趟就在半路壞掉。
3. **沒有任何 checkout 映像建在它上面、也超過 24 小時**的依賴映像。24 小時是留給「剛建好依賴、自己的
   映像還沒建完」的那個 checkout 的。

### 三、清理不碰的東西

**不加 `-f`**，有容器在用的映像刪不掉就留著。**不碰 build cache**。**不碰沒有這些 label 的映像**，
所以這個決定之前建的映像要手動清一次（docs/development.md〈測試映像〉）。

清理是盡力而為：列不出映像就印一行、整個略過，build 照常進行。

**agent 不再手動 prune。** `CLAUDE.md` 寫著不要跑 `builder prune`、`system prune`、不帶條件的
`image prune -a`，空間不夠就跑一次測試腳本。上一次清掉 cache 的就是 agent，而那在當時是合理的應急，
因為沒有別的路可走。現在有了。

## 考慮過、沒有採用的做法

**不把程式碼烤進映像，跑的時候掛進去。** 每個 lockfile 只需要一個映像，worktree 完全不佔空間，
#185 那種「映像裡是舊程式碼」的問題也不會存在。沒有採用，因為：

- 每個 workspace 的 `node_modules` 都要用映像裡那份蓋掉，host 上那份可能是別的平台裝的。
- 測試會寫檔案，掛進去的目錄就要處理容器與 host 之間的檔案權限，而現在的做法刻意不掛任何可寫的
  目錄（`scripts/test-in-container.sh` 的檔頭）。
- 換到的空間只有每個 worktree 約 85MB（實測 84MB）。

如果哪天這 85MB 也嫌多，或者 #185 再出現，這是該回頭看的方向。

**只靠「不要再清 cache」。** 磁碟一緊，cache 就會被清，這次就是這樣發生的。

**在 Dockerfile 裡加一個 stage 拿掉 `scripts`，其餘照舊靠 cache。** #265 原本的提案。它解決了
`scripts` 的問題，但共用仍然靠 cache，第一個問題原封不動。

## 代價

- **根目錄的 `Dockerfile` 不能單獨 build 了**，它的 `FROM` 是腳本算出來的 hash。要手動拿一個映像，
  用 `scripts/build-test-image.sh`，它印出 image id。
- **`docker/` 底下任何一個字改了，都算依賴改了**，包括 `deps.Dockerfile` 的註解。build cache 還在的
  時候，那只是多一個共用同一批 layer 的 tag；cache 不在的時候，就是整份重建一次。
- 依賴映像的 hash 要在 host 上算，所以 host 要有 `node`（開發本來就要，CI 的 runner 也有）。
- 清理的規則寫在 shell 裡，沒有自動化測試蓋到。三條規則在 2026-10-09 用假映像逐條驗過（#265 的 PR），
  改這段的時候要照同樣的方式再驗一次。
