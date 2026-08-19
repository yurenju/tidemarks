# 拖曳翻頁：按著滑，看得到鄰頁

狀態：已實作。對齊與實作日期 2026-08-13。基準：`main`（`packages/app/src/lib/touch.ts`、
`navigator.ts`、`components/Reader.tsx`、`packages/frond/src/renderer/`）。

這份文件是**決定**，不是提案。背後的取捨在
[ADR-0024](../../adr/0024-turning-a-page-is-a-swipe-and-nothing-else.md)（手指翻頁只剩滑動）與
frond 的 [ADR-0013](../../../packages/frond/docs/adr/0013-a-half-turned-page-is-frond-s-state.md)
（翻到一半的那一頁是 frond 的狀態）。要量的數字在
[measurements.md](measurements.md)。

工作項目：[#139](https://github.com/yurenju/folis/issues/139)（frond 的進行中翻頁 API 與三個渲染面）、
[#140](https://github.com/yurenju/folis/issues/140)（app 接上拖曳翻頁）、
[#141](https://github.com/yurenju/folis/issues/141)（拿掉 tap 翻頁）。三張照這個順序，後面兩張各自
擋在前一張後面。

## 根因

今天的 swipe 是放手才判斷的離散手勢：位移超過 50px 才翻，過程中畫面完全不動
（`touch.ts` 的 `MIN_SWIPE_PX`）。讀者滑到一半沒有任何回饋，不知道自己滑夠了沒有，也**不知道翻過去
會是什麼**。位移落在 10 到 50px 之間時更糟，兩個門檻中間沒有人接，什麼都不會發生
（[#61](https://github.com/yurenju/folis/issues/61)）。

## 讀者看到什麼

手指按在書上開始滑，**書頁跟著手指走**，鄰頁從側邊露出來，中間隔著一條頁縫。滑到一半停住，畫面就
停在那裡；往回滑，鄰頁退回去。放手時，走得夠遠或甩得夠快就翻過去，否則彈回原位。

直排書與橫排書**看到的是同一件事**：內容左右移動。這是刻意的，理由與代價見 frond ADR-0013。

## 手勢規則

### 什麼時候跟手

| 按下那一刻 | 手指移動超過 10px | 結果 |
| --- | --- | --- |
| 沒有選取 | 是 | 跟手，頁面開始動 |
| 沒有選取 | 否，直接放開 | tap，叫出 chrome |
| **已經有選取** | 不管 | 不跟手也不翻頁（讀者在調整選取範圍） |

**時間不參與判斷。** 按了多久都不影響，按下去猶豫三秒再滑一樣跟手。這是刻意的：手機上滑動是唯一的
翻頁手段，用一條讀者感覺不到的時間線把人擋在外面，症狀會是「這 app 有時候翻不了頁」，而那種 bug
沒有人回報得出來。

**10px 是 `TAP_SLOP_PX`**，今天由 Navigator 與 highlight 命中判斷共用。它的角色從「這一下算不算
tap」變成「什麼時候開始跟手」，共用照舊。

**位移從突破 10px 的那一點起算**，所以頁面固定比手指慢 10px，起步不會跳一下。

### 選字怎麼分開

- **拖曳一開始，frond 把 iframe 裡的文件設成不可選取，結束還原。** 跟手期間選不到字。
- 保險：這一次按壓期間才冒出來的選取算平台的，清掉；**按下之前就存在的選取是讀者的**，見上表。按下
  那一刻記一個 flag 就分得開。
- 上面那條「關掉選取能不能中止進行中的長按選字」**沒有文件可以照抄**，見 measurements.md。

### 放手怎麼判

翻過去，如果**任一條**成立：

- 位移超過**一整頁的距離**的一定比例（先取 **1/3**）。那個距離是容器的寬度，不是 frond 的〈頁距〉
  ——後者是同一份文件裡相鄰兩頁的捲動距離，含一個看不見的欄距；拖曳移動的是兩份文件，跨的是容器
- 放手瞬間的速度超過門檻（輕彈）

否則回彈。**一次手勢最多翻一頁**：超過一整頁的部分不再累積。

### 書首與書尾

沒有鄰頁的方向拖得動，但位移打折、有上限（約一整頁的 1/4），露出來的是紙色的底，放手一定回彈。
「到底了」與「當掉了」在畫面上要分得出來。frond 的 `location.atEnd` 是問得到的事實。

### 誰不跟手

- **滑鼠不跟手。** 桌機翻頁走左右箭頭與頁鈕，滑鼠點擊叫 chrome（ADR-0020 已經定案的那一半）。
- **觸控筆當手指看待**，跟 `preventsTapDefault` 底下那個判斷（`claimsPress`）一致。
- 起點在連結上的按壓：照 `preventTapDefault()` 今天的條件走，連結還是要點得開。

### chrome 升起時

**照樣拖得動，翻頁順手把 chrome 收起來。** 拖曳不會跟「點一下把介面收起來」混淆，所以不必禁。
`PointerEnd.tapsTurnPages` 刪掉。

## 手指是誰的

拖曳翻頁要成立，**這一下的手指必須從頭到尾都是我們的**，而預設不是：瀏覽器的手勢辨識比任何 script
都早，它一看到手指橫向移動就可能判給自己的捲動。真機上量到的序列是

```
pointerdown → pointermove（一次）→ pointercancel → touchmove ×5 → touchend
```

也就是頁面只跟著動一幀就停住，讀者看到的是「完全不會動」。**這件事在自己派事件的測試裡看不到**，
那些事件不經過那一層判斷。守它的是 `packages/app/tests/browser/reader/real-touch.spec.ts`，用 CDP 的
`Input.dispatchTouchEvent` 送真的觸控，只有 chromium 有。

所以 `touch-action: none` 要設在**兩個面**上，它們是同一塊螢幕的兩半：

| 面 | 在哪裡設 | 誰收得到事件 |
| --- | --- | --- |
| 書的文件（iframe 內） | frond 的 `layout.ts` | frond 的 `pointerdown`／`pointermove` |
| 書框外的留白帶 | `index.css` 的 `.viewer-mount` | Reader 自己掛在容器上的 listener |

**留白帶不是可以忽略的一條邊**：手機上量到 mount 397px、iframe 333px，左右各 32px 是 app 的地，而
那正是拇指構得到的位置。iframe 的邊界不讓事件出來，容器也收不到裡面的，所以兩條路都要接，會合在
Reader 的同一組 `onPress`／`onMove`／`onRelease`。

`none` 而不是 `pan-y`：直排書的分頁軸是垂直的，留一軸給瀏覽器等於讓它把直排書捲離 frond 的頁格線
（那就是 [#124](https://github.com/yurenju/folis/issues/124) 講的病）。兩個方向本來就都不給手動捲，
所以沒有東西被拿走。

## 動畫

放手之後把剩下的距離滑完（翻過去）或滑回原位（回彈）。tap 不翻頁，目錄與定位軸的跳頁維持瞬間切換。

> **2026-08-14 修訂**：這一節原本寫「只有拖曳有動畫……頁鈕、方向鍵一律維持瞬間切換」。頁鈕與方向鍵
> 現在也有動畫了，理由與規則在
> [docs/specs/desktop-page-turn/spec.md](../desktop-page-turn/spec.md)。**跳頁那半沒有變。**

`prefers-reduced-motion: reduce` 時，放手的收尾改成瞬間落位。跟手那一段不受影響，它是直接操作，不是
動畫。`index.css` 已經有 5 處同樣的處理。

## 分工

界線照 frond 的 [ADR-0002](../../../packages/frond/docs/adr/0002-frond-owns-facts-spine-owns-policy.md)。

| | 誰 |
| --- | --- |
| 拖曳過程的座標（`pointermove`） | frond |
| 三個渲染面（當前頁與前後鄰頁）、鄰頁的定位、一整頁有多遠 | frond |
| 進行中的翻頁：開始、位移、commit、cancel、回到格線 | frond |
| 拖曳期間關掉文件的選取 | frond |
| 往哪一邊算下一頁、視覺上往哪一軸移動 | app |
| 10px 起手、1/3 與輕彈的門檻、阻尼曲線、收尾動畫的時間 | app |
| 什麼時候不跟手（有選取、滑鼠、連結） | app |

## 拿掉的東西

- `touch.ts` 的 `tapAction()` 與 `TURN_BAND`：整組刪除。
- `navigator.ts` 的 `PointerEnd.tapsTurnPages`：刪除。
- `swipeAction()` 與 `MIN_SWIPE_PX`：刪除。放手要看的條件換成上面那兩條，離散路徑不留。
- `CONTEXT.md`〈Navigator〉的點擊分區那幾段：改寫成拖曳翻頁的規則。**這一項跟著實作那次改**，因為
  那份表描述的是現況。
- [ADR-0020](../../adr/0020-the-interface-steps-behind-the-book.md)：加一行指向 ADR-0024，說明分區
  那一半被取代。

## 不在這一輪

- **翻頁的視覺效果只有平移。** 不做翻書、捲曲、淡入。
- **雙欄橫排的兩頁一起翻**：頁距本來就是一頁一個 stride，雙欄不改變這件事，但視覺上是否該一次翻兩欄
  沒有討論過，留著。
- 桌機的滑鼠拖曳。（仍然不在。頁鈕與方向鍵的動畫是另一件事，見上面那則修訂。）
