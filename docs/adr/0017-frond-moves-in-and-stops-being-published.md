# frond 搬進 monorepo，而且停止發到 npm

日期：2026-08-11。

## 決定

frond 的原始碼搬進 spine 的 monorepo（舊 repo 的 #110 之後的
第二步），spine 用 workspace link 相依，不再 pin 版號。

**不再發布到 npm**，`@yurenju/frond` 停在 0.4.15。公開的 `yurenju/frond` repo 封存，README 指向
這裡。

## 為什麼

跨 repo 的代價全部落在**等待**上：frond 開 PR、維護者 merge、**手動**觸發 release、spine 才 pin
得到那個版號。等的期間 spine 的程式碼只能在本機 commit 不能 push，要驗證還得把 `npm pack` 的產物
暫時塞進 Dockerfile 再還原、跑完再還原回去。

換到的是什麼？frond 建立於 2026-07-25，兩週半，發了 20 個版本，**外部使用者實質是零**。獨立
repo 買的「別人讀得到、別人裝得到」現在沒有買家。

先前的顧慮是「搬進 private repo 等於把一個已經公開的東西收回去」。那句話是對的，但它衡量的是一個
沒有人在用的東西，而 [ADR-0009](0009-open-source-buys-an-exit-not-contributions.md) 已經判過同類
的帳：丟掉 commit 歷史的代價比想像中小。同一把尺量 frond 兩週半的歷史，結論一樣。

## 邊界不再靠 repo 撐著，要靠寫下來的規則

「**frond 吐事實，spine 做政策**」這條線不因為搬進同一個 repo 就消失，但**擋著違規的東西換了**。
原本是成本（開 PR、等 merge、等發版），現在只剩寫下來的那條規則加 review。

所以那條規則要更用力地留著，而且它一句話就講得完：**拿不到只有 frond 知道的事實，就讓 frond 補上
那個事實；只是繁瑣，就留在 spine。** 繁瑣不是搬家的理由。

`packages/frond` 保留自己的 `package.json`、測試與 CONTEXT.md，spine 一律從公開入口 import，不從
旁邊伸手進去拿內部檔案。package 邊界是真的邊界，少掉的只是發版那道摩擦。

## 停發是刻意的，而且知道反悔要付什麼

繼續發版的成本只有一支 CI workflow，而它保住的是**這個決定可以反悔**：哪天 frond 對別人有用，或想
把它切回獨立 repo，套件名字與版本序列還是連續的。

還是選停發，因為現在沒有人在裝它，而每一條發布路徑都是一件要維護的東西。代價說清楚：**接回來的時候
版本序列會有一段空白**，monorepo 這段期間的變更沒有版號可以指，得從 0.4.16 起續號。真的要開源、
或真的有人要裝的那天再接。

## 一個會壞掉的東西

`vite.config.ts` 的 build stamp 讀 `pkg.dependencies['@yurenju/frond']`，畫面上那個 frond 版號在
workspace link 之後不再是一個版本。要換成別的東西，或拿掉。
