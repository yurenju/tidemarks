# 翻到一半的那一頁是 frond 的狀態

日期：2026-08-13。

## 背景

消費端要做「按著滑動就看得到鄰頁」。今天的 `Renderer` 只有 `next()` 與 `previous()`，兩個離散的
動作，中間沒有任何可以停下來的位置。

三件事讓這個功能在消費端做不出來：

1. **拖曳過程的座標拿不到。** frond 只送 `pointerdown` 與 `pointerup`，而 iframe 擋掉冒泡
   （ADR-0006 就是要它擋掉），所以中間的移動消費端看不到。
2. **移動一段距離這個動作沒有入口。** 翻頁是把 iframe 內 `documentElement` 的捲動位置移動一個
   `stride`，那個數字與那個 scroller 都在 frond 裡面。
3. **鄰頁不在螢幕上的任何地方。** 直排書的分頁軸是 y（`geometry.ts`），下一頁在**下方**；消費端要
   的是它從**側邊**滑進來。一個 iframe 裡上下疊著的兩頁，沒有任何 CSS 能把其中一頁搬到旁邊，所以
   這件事非有第二個渲染面不可。

## 決定

`Renderer` 多一組「進行中的翻頁」API（大致是 `beginTurn` / 位移 / `commit` / `cancel`），並且**同時
維持三個 section view**：當前頁，以及前後兩個鄰頁。翻頁進行中的位移、鄰頁的定位、結束時回到格線，
全部由 frond 做。

**視覺上往哪一軸移動由消費端在 `beginTurn` 時指定**，frond 不從書的 `page-progression-direction`
自己推。「往左滑等於下一頁」是政策（ADR-0002），frond 一個字都不猜。

**拖曳期間 frond 把 iframe 裡的文件設成不可選取，結束還原。** 那是 frond 自己那一層 CSS，不是
ADR-0003 說的介入：書從來沒有宣告過這一項，書的意圖也沒有被改變。

## 為什麼在 frond，而不是讓消費端開第二個 `Renderer`

`Renderer.attach(book, container)` 是公開的，消費端確實可以自己開第二個指到旁邊的容器。代價是：

- `attach()` 一定會跑 `buildIndex()`，而它**讀過全書每一節**。
- 每個 `Renderer` 有自己的 `ResourceUrls`，同一批圖再發一輪 blob URL 並重新解碼。
- 沒有「跳到第 N 頁」的入口，只能用 CFI 加 `next()` 拼，而那些呼叫都排在同一條 queue 上，非同步。

三件都不是「繁瑣」，是**拿不到只有 frond 知道的事實**：`stride`、分頁軸、已經解析好的文件、
iframe 的定位與 inset。ADR-0002 的判準落在這一邊。

## 代價

**記憶體與排版成本乘以三。** 一節被排三次（自己一次，作為別人的鄰頁兩次）。最壞情況是**單頁的
section**（分輯扉頁、章名頁，樣本裡不罕見）：那時三個渲染面裝的是三個不同的 section，等於同時掛著
三份文件。低階手機上的實測寫在
[docs/specs/swipe-to-turn/measurements.md](../../../../docs/specs/swipe-to-turn/measurements.md)。

**API 變大。** 到今天為止 `Renderer` 對外只有「做完的動作」，沒有「做到一半的狀態」，而狀態是要
被清掉、被中斷、被 resize 打斷的東西。

**「拖曳一開始關掉選取能不能中止進行中的長按選字」沒有文件可以照抄，要三家實測。**
`docs/browser-quirks.md` #4 那一輪的教訓（Chrome 文件說文字不可選取就不會觸發搜尋 bar，實機上只從
72% 降到 21%）在這裡照樣適用。

## 順帶解掉的

`yurenju/folis#124`：長按選字時原生 auto-scroll 把頁面推離格線，而消費端沒有 re-snap 的入口。
「進行中的翻頁結束時回到格線」這條路徑就是那個入口，而且它一直都該是 frond 自己的不變量。
