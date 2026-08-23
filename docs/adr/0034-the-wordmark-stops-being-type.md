# 字標不再是排出來的字

日期：2026-08-23。

## 決定

字標「tidemarks」與單字記號的字母，從 `<text font-family="Spectral">` 改成**外框 `<path>`**。
外框由 `docs/brand/source/outline.mjs` 從 Spectral 切出來，切一次，寫進四個地方
（`docs/brand/` 的四份 SVG、`packages/app/public/favicon.svg`、`components/Wordmark.tsx`）。

因此 **app 不再自帶任何 display 字型**：`--font-display` 這個 token 沒有了，Spectral 的
`@font-face` 也拿掉了，`spectral-latin-400-normal.woff2` 移到 `docs/brand/source/fonts/`，
只給那支 script 讀。

這**取代 [ADR-0022](0022-the-interface-is-a-print-shop.md)〈四個家族，兩種待遇〉裡
「Spectral 給字標與西文數字」那一句**。ADR-0022 的其他部分照舊，它的內文與檔名也不改——
它是一份有日期的紀錄。現在的家族數是三個：`--font-ui`、`--font-control`、`--font-mono`。

（那句話的後半「西文數字」從來沒有實作過：`--font-display` 從加進來到拿掉，唯一的使用者
一直都是書架標題那一個選擇器。所以被這份 ADR 取代掉的，實際上只有字標那半。）

## 為什麼

字標現在要出現在三個 app 畫面以外的地方，而**那三個地方都拿不到 `@font-face`**：

| 位置 | 瀏覽器怎麼載它 |
| --- | --- |
| 分頁圖示 `favicon.svg` | 當獨立圖片 |
| PWA manifest 的 icon | 當獨立圖片（甚至不在瀏覽器裡，是作業系統） |
| 兩份 README 的 logo | 當 `<img>`，而且經過 GitHub 的 camo proxy |

獨立圖片有自己的文件環境，看不到引用它的那一頁的樣式。留著 `<text>` 的話，字會退到看圖的人
自己機器上有的襯線體：Mac 上是 Georgia，Linux 上可能什麼都不是。**同一個字標在同一個畫面上
會有兩種長相**——書架標題是真的 Spectral，分頁圖示是別的字——而那正是識別最不能出的事。

外框沒有這個問題：它在哪裡都長一樣，因為它不是字了，是形狀。

## 代價

**改設計要重跑一支 script。** 以前改字標是改一行 CSS，現在是改 `source/` 的母檔、跑
`npm i --no-save fontkit && node docs/brand/source/outline.mjs`。這是這份決定唯一真的代價。

**同一份幾何有四份拷貝。** script 四份全寫，包含 `Wordmark.tsx` 裡的三個 `d`
（它用旁邊的 class 找到它們）。刻意讓 script 去改一個手寫的元件，是因為另一條路——
留一行「記得手動貼過去」——會讓某次改版落在其他三個地方而漏掉最常被看到的那一個。

**字標不再跟著讀者的字型設定變形**，但它本來也不該。它跟著 `--type-display` 縮放，
所以讀者放大瀏覽器字級的時候它一樣會長（[ADR-0006](0006-font-size-is-a-percentage-of-the-readers-root.md)）。

## 為什麼不是別的做法

**只用 webfont，圖示另外畫一份。** 那就等於承認記號有兩個版本，而它們會分岔——正是這份決定
要避免的事。

**兩個檔案（亮／暗）用 `<img srcset media>` 切。** 這在 README 上是對的做法（GitHub 沒有別的
選擇），但在 app 裡是錯的：Tidemarks 的主題是 `:root[data-theme]` 屬性，讀者可以選一個跟系統
相反的。`<img>` 只看得到 `prefers-color-scheme`，手動切主題的那一刻就會錯。所以畫面上那一份
是內嵌 SVG，顏色走 token；favicon 沒有頁面可問，就只能跟系統走，那是它的上限。

**把 Spectral 留著以備後用。** 沒有「後用」——`--font-display` 的唯一使用者就是被取代掉的那
一個選擇器。留下來只會是一段說著假話的註解。

## 順帶少掉的 21 KB 不是理由

Spectral 的 subset 是 21 KB，而且 `font-display: swap` 表示沒有元素用它就不會下載，所以刪掉它
省下的其實只有 `dist/` 裡一個沒有人要的檔案。寫在這裡是為了說明**這份決定不是為了效能**，
免得未來有人以為可以用「反正只有 21 KB」把字型加回來。
