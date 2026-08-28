# Tidemarks — Logo 資產與規範

定案版本：**11c**。

## 這個目錄放的是可以直接用的版本

| 檔案 | 用途 |
| --- | --- |
| `tidemarks-mark.svg` / `-dark.svg` | 單字記號，亮底與暗底 |
| `tidemarks-wordmark.svg` / `-dark.svg` | 字標 tidemarks，亮底與暗底（兩份 README 用的就是這個） |
| `source/` | 母檔。要**改設計**從這裡改，不要改上面那四份 |

**上面四份的字母是 `<path>` 外框，`source/` 裡的是 `<text font-family="Spectral">`。** 隨手抓一份
來用要抓外框那份，理由見下一節。

app 自己用的三份不在這裡，它們住在 app 的 `public/`：

| 檔案 | 誰讀它 |
| --- | --- |
| `packages/app/public/favicon.svg` | 分頁圖示與 PWA 的 `purpose: "any"`（`vite.config.ts`） |
| `packages/app/public/apple-touch-icon.png` | iOS 加到主畫面（`index.html` 的 `<link>`） |
| `packages/app/public/maskable-icon.png` | Android 的 maskable 圖示（`vite.config.ts`） |

畫面上的字標是第四份，它是元件不是檔案：`packages/app/src/components/Wordmark.tsx`。

## ⚠ 為什麼字一定要轉外框

favicon、manifest 的圖示、README 裡的圖，這三種用法瀏覽器都把 SVG 當**獨立圖片**載，
**載不到頁面的 `@font-face`**。留著 `<text>` 的話，字會退到看圖的人自己機器上的襯線體，
Mac 上是 Georgia，Linux 上可能什麼都不是。

所以 app 不再自帶 Spectral，它移到了 `source/fonts/`，只給切外框的工具讀。改完設計要重跑：

```
npm i --no-save fontkit && node docs/brand/source/outline.mjs
```

那支 script 會覆寫這個目錄的四份 SVG 與 `packages/app/public/favicon.svg`，並印出字標的 `d`，
**那串還要手動貼進 `Wordmark.tsx`**，它是唯一一份 script 不會去寫的。

`source/` 底下另外兩份 `apple-touch-icon.svg` 與 `maskable-icon.svg` 只是 PNG 的母檔；
需要 192／256／1024 等其他尺寸時，開 `source/icon-export.html` 改尺寸後截圖。

## 幾何規則（以字級 F 為單位）

- 色塊左右留白：`0.1875F`；色塊高度：`0.95F`；上緣圓角 `6px`（固定值，下緣永不圓角）
- 浪帶高度：`0.126F`；浪高（峰到谷）：`0.056F`；潮線線寬：`0.022F`
- **單一個 t 永遠九個浪**，不論尺寸 → 整個記號等比縮放
- **字標的浪寬、浪高與同字級的單 t 完全相同**，只有浪的數量隨字長延伸（tidemarks 為 59 個）
- 字標的字比單 t 再往下 `0.091F`（44px 時 4px），讓 i 的點與 t、k 的字尖不貼上緣

## 顏色

三個角色都是既有的 token，沒有新增顏色。左邊是 logo 規範原本的名字，右邊是這個 repo 裡的：

| 角色 | 亮底 | 暗底 | repo 裡的 token |
| --- | --- | --- | --- |
| 色塊 | `#EDE5D6` | `#2C3F55` | `--wordmark-block`（亮＝`--surface-sunken`，暗＝`--fill-selected`） |
| 潮線 | `#1B2E4D` | `#A9C4DE` | `--mark-indigo` |
| 字 | `#14171C` | `#F2F1E9` | `--text-primary` |
| 襯底 | `#F4EEE2` | `#16202B` | `--surface-page` |

色塊是唯一需要自己一個名字的：兩個主題是用不同的語意抵達它的，暗底那邊拿 `--surface-sunken`
會是近黑，色塊等於消失。

## 使用規則

- 最小尺寸 **32px**（記號高度）。更小時浪的波長會小於線寬，改用無浪的純 t。
- 淨空 ≥ 單 t 色塊寬度的 1/4，四邊皆同。
- 記號是直式（寬高比約 0.66:1），不會填滿方形 app icon；請置中留邊，不要拉寬。
- 兩張 PNG 圖示都是滿版紙色 `#F4EEE2` 背景、不留透明，也不要自己加圓角（iOS 自己切圓角，
  Android 自己遮罩）。maskable 的記號高度為畫布的 58.6%，四角落在直徑 80% 的安全圓內。
- 禁止：非等比拉伸、改變浪的高度或密度、下緣加圓角、改用其他顏色、把波浪當成一般裝飾線重複使用。
