# 自帶 CJK 字型：量到的數字與怎麼重驗

[ADR-0014](../../adr/0014-spine-carries-the-font-rather-than-borrowing-it.md) 的結論從這些量測
來的。ADR 只寫結論，重現方式留在這裡，因為字型換版、frond 換 API、瀏覽器換行為的時候要重跑。

**環境**：Noto Serif CJK TC 2.003 與 Noto Sans CJK TC 2.004（`notofonts/noto-cjk`）、playwright
1.61.1、chromium 1232 / firefox 1534 / webkit 2327、`wawoff2` 轉 woff2、`subset-font`（harfbuzz wasm）
做 subset。

## 一、體積

| | OTF | woff2 |
| --- | --- | --- |
| NotoSerifCJKtc-Regular | 24.54 MB | **15.94 MB** |
| NotoSerifCJKtc-Bold | 25.52 MB | **16.99 MB** |
| NotoSansCJKtc-Regular | 16.44 MB | **10.90 MB** |
| NotoSansCJKtc-Bold | 17.00 MB | **11.56 MB** |
| NotoSerifCJKtc-VF（variable） | 55.38 MB | **18.83 MB** |
| NotoSansCJKtc-VF（variable） | 30.74 MB | **12.86 MB** |

轉一支要 45 到 89 秒。

### ⚠️ 更正：VF 划算，而且划算很多

這一節原本的結論是「**Variable font 不划算**：一支 VF 52.81 MB 比 Regular 加 Bold 兩支 static
（47.7 MB）還大」。那句話是拿 **OTF** 比出來的，而且 VF 的 woff2 那格當時標著「未量」。補量之後方向
相反：

| woff2 | 兩支 static 相加 | 一支 VF | |
| --- | --- | --- | --- |
| 明體 | 32.93 MB | **18.83 MB** | VF 小 43% |
| 黑體 | 22.46 MB | **12.86 MB** | VF 小 43% |

原因是壓縮率差很多，而 OTF 的比較看不到這件事：

- 兩支 static **各自帶一整套完整輪廓**，只能各壓各的。woff2 對 CFF 的壓縮率大約 68%，兩支量下來一致。
- 一支 VF 帶一套輪廓**加上 master 之間的差分**，而差分壓得掉非常多——明體壓到 34%，黑體 42%。

所以比體積要比壓縮後的，不能比 OTF。決定與代價見
[ADR-0035](../../adr/0035-one-variable-face-replaces-two-static-ones.md)。

（上面 static 的 OTF 數字也順手更新了：原表的 23.40／15.67 是舊版量的，重量之後是 24.54／16.44。
woff2 那一欄一個位元組都沒變，四支都跟 `packages/app/public/fonts/` 裡當時的檔案對得上。）

**subset 之後大約每字 640 bytes**（sfnt 裡的 CFF），跟字數幾乎線性：

| 字數 | sfnt | CFF |
| --- | --- | --- |
| 3000 | 1.62 MB | 1.58 MB |
| 5000 | 3.06 MB | 2.98 MB |
| 9000 | 5.63 MB | 5.50 MB |
| 13000 | 8.55 MB | 8.36 MB |
| 21000 | 0.31 MB | **不見了** |

一本真書（草枕，unique 2462 字，加常用標點與假名共 3017）subset 後 woff2 是 1.50 MB。

### `subset-font` 在大字集上靜默壞掉

21000 字那次吐出的是 40020 glyph、沒有 CFF table、0.31 MB 的檔案，**過程不報錯**。界線在 13000 與
21000 之間。要用它就得守在 13000 字以下，而且每次都要檢查 CFF 還在不在。

ADR-0014 決定不 subset，所以這個坑目前不影響 spine，但誰想省體積的時候會再走到這裡。

## 二、字型內容（直接讀 sfnt table）

```js
// Reads the sfnt table directory, then walks GSUB/GPOS ScriptList and FeatureList.
// Enough to answer "is vert still there" without pulling in a font toolchain.
const numTables = buf.readUInt16BE(4)
// table record: tag(4) checksum(4) offset(4) length(4), starting at byte 12
// GSUB header: version(4) scriptListOffset(2) featureListOffset(2) lookupListOffset(2)
// FeatureList: featureCount(2) then records of tag(4) offset(2)
// Script: defaultLangSysOffset(2) langSysCount(2) then records of tag(4) offset(2)
// LangSys: lookupOrder(2) requiredFeatureIndex(2) featureIndexCount(2) then indices(2 each)
```

`NotoSerifCJKtc-Regular.otf` 與 `NotoSansCJKtc-Regular.otf` 兩支的結果一樣：

- **GSUB**：`aalt calt ccmp dlig fwid hist hwid liga ljmo locl pwid ruby tjmo vert vjmo vrt2`，
  `hani` / `kana` / `latn` 三個 script 底下 **ZHT、ZHS、ZHH、JAN、KOR 五個 langsys 全在**，每個都有
  `locl`。
- **GPOS**：`halt kern mark palt vert vhal vkrn vpal`。
- **直排的表**：`vhea`、`vmtx`、`VORG` 都在。
- **cmap**（format 12）：龍 U+9F8D、龙 U+9F99、门 U+95E8、麼 U+9EBC、么 U+4E48、働 U+50CD、
  峠 U+5CE0、한 U+D55C、𰻞 U+30EDE 全部有 glyph。

subset 之後（草枕的字集）`vert` 沒有掉：GSUB 仍有 `vert` `vrt2` `locl` 且五個 langsys 都在；GPOS 的
`vert` `vhal` `vpal` `halt` `palt` 移到 defaultLangSys 底下，仍然生效。只有 `mark` 掉了，那是因為這本
書沒有需要 mark 定位的 glyph。

**讀 GPOS 的時候要讀 `defaultLangSysOffset`**，只數 `langSysCount` 會誤判成「langsys 全空了」。第一次
就踩到這個。

## 三、service worker 攔不攔得到 blob: iframe

一個受 SW 控制的頁面，建一個 `blob:` 的 iframe，iframe 裡的 `@font-face` 指向同源
`https://…/probe.woff2`：

| | iframe 有 controller | SW 看到請求 | 字型載入 |
| --- | --- | --- | --- |
| chromium | **false** | **false** | true（直接走網路） |
| firefox | true | true | false |
| webkit | true | true | true |

Chromium 那一列是 ADR-0014 不走 Cache API 的原因。firefox 的 `false` 沒有再追下去，因為 chromium 已經
把那條路否決了。

換成 `blob:` URL 的字型（parent 建 Blob 與 objectURL，把那個 URL 寫進 iframe 的 `@font-face`），三家的
`document.fonts.load()` 都回報 `loaded`。

**量寬度要用 inline 元素**：`<div>` 的 `getBoundingClientRect().width` 給的是容器寬（300px 的 iframe 減
body margin 就是 284），跟字型無關。第一次就是這樣量出「兩邊一樣寬」的假結果。而且 Probe 與 monospace
的 CJK 都是 1em 寬，本來就分不出來，真正的證據是 `document.fonts.load()` 的回傳。

## 四、`lang` 與 `locl`

同一支字型（TC 版），同一段字「骨直今令酒海話査風包次刃」，只改元素上的 `lang`，截圖比 hash：

| 元素上的 `lang` | chromium | firefox | webkit |
| --- | --- | --- | --- |
| `zh-TW` | TC 字形 | TC 字形 | TC 字形 |
| `zh-CN` / `zh-Hans` | SC 字形 | SC 字形 | SC 字形 |
| **`zh`** | **SC 字形** | **SC 字形** | **SC 字形** |
| 完全沒有 | TC 字形 | TC 字形 | TC 字形 |

`font-language-override: 'ZHS'`：

| | 元素上沒有 `lang` | 元素上有 `lang="zh"` |
| --- | --- | --- |
| chromium | 生效 | 生效 |
| firefox | 生效 | 生效 |
| webkit | **忽略** | 生效 |

「骨」的框朝向與「令」的下半是肉眼看得出來的差異，不是 anti-aliasing 的雜訊。

subset 的時候 `locl` 的 alternate glyph 會被 harfbuzz 的 layout closure 拉進來：12 個字進去，32 個
glyph 出來。

## 五、解析 15.94 MB 字型要多久

在一個 `blob:` iframe 裡宣告 `@font-face` 指向 15.94 MB 的 woff2，量到
`document.fonts.load()` resolve 為止。銷毀 iframe 再建一個，重複三次。

| | 第 1 次 | 第 2 次 | 第 3 次 |
| --- | --- | --- | --- |
| **同一個 objectURL** chromium | 571 ms | 2 ms | 0 ms |
| firefox | 576 ms | 1 ms | 0 ms |
| webkit | 244 ms | 176 ms | 1 ms |
| **每次重建 objectURL** chromium | 601 ms | 602 ms | 537 ms |
| firefox | 0 ms | 557 ms | 532 ms |
| webkit | 229 ms | 215 ms | 218 ms |

解析後的字型是快取的，但**快取認的是 URL 不是 Blob**：同一個 Blob 呼叫兩次 `createObjectURL` 會拿到
兩個 URL，字型就被解析兩次。所以 objectURL 建一次留著用。

（firefox 的 `new-url 1` 那個 0 ms 是前一輪的快取還熱，後兩次的 550 ms 才是它的常態。webkit 要到第
三次才降到 0，前兩次都還在付。）

從 `blob:` 讀 15.94 MB 的 `fetch` 本身是 51 到 385 ms，跟解析比起來不是重點。

## 六、`@font-face` 對上本機同名字型

這台機器裝了 `Noto Serif CJK TC`（明體）。拿 Noto **Sans** 的位元組宣告
`@font-face { font-family: 'Noto Serif CJK TC' }`，三家畫出來都是黑體，所以 `@font-face` 勝出。

判定不能只比「跟另一個系統字型的截圖一不一樣」，那個差異也可能只是 TC 與 JP 的字形差。要看圖確認
畫出來的是不是黑體。

## 七、授權（讀 name table）

| | |
| --- | --- |
| Serif copyright | `© 2017-2024 Adobe (http://www.adobe.com/)` |
| Serif version | `Version 2.003;hotconv 1.1.1;makeotfexe 2.6.0` |
| Sans copyright | `© 2014-2021 Adobe (http://www.adobe.com/)` |
| Sans version | `Version 2.004;hotconv 1.0.118;makeotfexe 2.5.65603` |
| 授權 | SIL Open Font License 1.1，`http://scripts.sil.org/OFL` |

**沒有 Reserved Font Name**：copyright 行裡沒有 `with Reserved Font Name`，所以轉檔、subset、改名都在
授權內，family 名可以保留 `Noto Serif CJK TC`。

### ⚠️ 更正：可變字型那兩支不一樣

上面那句「沒有 Reserved Font Name」是拿**靜態檔**量的。換成可變字型之後重量了一次，兩支的答案不同：

| | copyright | RFN |
| --- | --- | --- |
| NotoSansCJKtc-Regular / Bold | `© 2014-2021 Adobe (http://www.adobe.com/).` | 無 |
| **NotoSansCJKtc-VF** | `© 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.` | **有** |
| NotoSerifCJKtc-Regular / Bold | `© 2017-2024 Adobe (http://www.adobe.com/).` | 無 |
| NotoSerifCJKtc-VF | `© 2017-2024 Adobe (http://www.adobe.com/).` | 無 |

保留的名字是 **`Source`**。OFL 1.1 第 3 條限制的是「改過的版本不得使用保留的名字」，而且明講
「This restriction only applies to the primary font name as presented to the users」——我們註冊的名字是
`Noto Sans CJK TC`，不含 `Source`，所以轉 woff2 與散布都在授權內。

**但上面那句話的後半對這支不成立**：「改名都在授權內」要改成「改名不得改成含 `Source` 的名字」。
name table 在 woff2 轉檔中原樣保留，`public/fonts/OFL.txt` 也跟著一起散布，OFL 的另外兩項要求
（保留版權聲明與授權）都滿足。

重跑：讀 sfnt 的 name table，取 nameID 0（copyright）、1（family）、13（license）。

## 八、合成粗體有多難看

只帶 Regular 的話，標題與強調是瀏覽器**合成**的粗體，三家演算法不同。量它到底差多少：**墨水覆蓋率**
——同十個筆畫密的字（鬱籲纖躊躇矚齷齪鑿懿）排在 48px，取那一行的矩形，逐像素算 `1 − 亮度` 的平均。
合成粗體多出來的墨水就是填進字腔裡、也就是糊掉的量。樣張用公有領域的〈前赤壁賦〉。

### 明體（Noto Serif CJK TC）

| | Regular 400 | 合成 700 | 真 Bold | 合成比真 Bold |
| --- | --- | --- | --- | --- |
| chromium | 7.71% | 13.01% | 10.28% | **+27%** |
| firefox | 7.44% | 11.03% | 10.08% | +9% |
| webkit | 7.44% | 12.82% | 10.08% | **+25%** |

### 黑體（Noto Sans CJK TC）

| | Regular 400 | 合成 700 | 真 Bold | 合成比真 Bold |
| --- | --- | --- | --- | --- |
| chromium | 9.13% | 14.08% | 12.76% | +10% |
| firefox | 8.98% | 12.34% | 12.61% | −2% |
| webkit | 8.98% | 13.92% | 12.61% | +10% |

三家一致性差一個數量級：真 Bold 三家之間差 2%，合成粗體差 18%。明體受的傷是黑體的 2.5 倍（+27% 對
+10%），因為明體筆畫有粗細對比、字腔小。**advance 完全沒動**：同段十六字在三家、三種畫法下都是
288.00px，所以補 Bold 不改變分頁、不動存好的閱讀位置。

結論：**兩種字型都補真的 Bold**（明體 16.99 MB、黑體 11.56 MB）。明體受的傷是黑體的 2.5 倍，所以先帶
明體；但黑體的標題一樣是合成的、一樣三家不一致，而 ADR-0014 的目標是「每台機器同一個字」，不是「難看
到門檻才管」。

## 九、`font-language-override` 的三家支援

`CSS.supports('font-language-override', '"ZHT"')` 與計算值：

| | 支援 | 備援 |
| --- | --- | --- |
| chromium | true | |
| firefox | true | |
| webkit | **false** | `-webkit-locale` 是 true |

**更正**了 frond#92 原本寫「三家都認，webkit 有窄缺口」的表格：webkit 根本沒實作這個屬性。對 spine
的影響是簡繁字形切換在 Safari 上不生效，字型本身照樣載得到。

## 十、書怎麼用 400 到 700 之間的字重

只帶 400 與 700 兩支 face，書寫 `font-weight: 500` 會畫成什麼，是 CSS 的字重匹配規則決定的：**500
往下找 400**（600 以上才往上找）。所以書用 500 做的強調，跟它旁邊的內文落在同一支 Regular 上，一模
一樣。

這在中文書不是罕見的寫法。中文沒有義大利體可用，強調就是換一支比較重的字、換一個字族，或兩者一起。
`FIRE．致富實踐` 的「另一本」是 `.sans { font-family: sans-serif; font-weight: 500 }`，兩件事都做了；
讀者一旦選了黑體或明體，字族那一半被讀者的選擇蓋掉（frond 的 `readerStylesheet`），只剩下 500，然後
500 又掉回 Regular，強調就整個消失。

**當時的修法是把 face 宣告成範圍**：Regular 收 `100 400`，Bold 收 `500 900`（`web-font.ts` 的
`weightRange`）。代價是書如果拿 500 當內文，整本會變粗，所以先量了它到底掛在哪裡。

⚠️ **那個修法在一支可變字型底下不成立了**，而下面這份 34 本書的量測正是它現在的依據：宣告範圍會夾住
可變字型的 wght 軸（第十一節），所以範圍不能再拿來當匹配標靶用——`weightRange` 已經沒有了，換成
frond 重述書自己的宣告（第十二、十三節，ADR-0035）。判斷「500 以上算粗」的界線沒有變，這份樣本仍然
是它的依據。

**樣本**：34 本市售中文電子書。做法是解開 epub，收集所有 CSS 與內嵌 `<style>` 裡數值型的
`font-weight`，取 400 與 700 之間的規則，再回頭數那些 selector 裡的 class 包住多少字。

| 書 | 佔全書字數 | 那些規則掛在哪 |
| --- | --- | --- |
| FIRE．致富實踐 | ≤ 17.31% | `p.mu`、`div.example0 h4`、`div.example0 li`、`p.s0`、`h4.sa` |
| 間歇高效率的番茄工作法 | 1.31% | `p.img_text` |
| 順勢溝通 | 0.68% | `.tips`、`.foreword_job` |
| 打造第二大腦實踐手冊 | 0.36% | `p.box_num`、`p.alt_noin` |
| 搞定 | 0.28% | 標題類 |
| 激進市場 | 0.11% | `.sans1`、`h2`、`h3`、`h4` |
| 入境大廳、沒有最好的季節、熱情面具下的義大利人、萬事揭曉 | 0% | `.bold`、`span.emph`、`.fw_500`、`.fw_600`（宣告了但那些 class 沒被用到） |

其餘 24 本連一條 400 到 700 之間的規則都沒有。

結論有兩個，第二個才是關鍵：

1. 量到的比例都很小，九本在 1.4% 以下。
2. **沒有任何一本把這種字重放在正文層級**：全部掛在具名的 class 上，沒有一條寫在 `body`、光禿禿的
   `p` 或 `*` 上。class 的名字自己就說了用途，`.bold`、`span.emph`、`.tips`、`p.img_text`、
   `div.example0 li` 是強調、圖說、提示框與範例框。

FIRE 那筆的 17.31% 標成上限，因為算法會重複計算：`div.example0 h4` 這種 selector 我取的是 class
`example0`，數到的是整個框的字，不是框裡 `h4` 的字。實際數字比這個小。

600 不受這次改動影響，它本來就往上找，早就拿到 Bold 了。

重跑：`node scan-weights.mjs <書目錄>`，script 沒有進版控（一次性分析，而且它讀的是版權書）。

## 十一、窄範圍宣告會不會夾住可變字型的 wght 軸

ADR-0035 整個押在這件事上，而規格那句是 **should** 不是 must：

> variation values applied to fonts defined with `@font-face` will be **clamped to both the
> values specified in these descriptors**, or implied by the application of variation parameters
> (such as manipulation of the wght axis to satisfy the requested `font-weight`), as well as the
> values supported by the font file itself.
> ——CSS Fonts 4 §4.6

**在容器裡**（chromium 1232 / firefox 1534 / webkit 2327）拿 `packages/app/public/fonts/` 實際出貨的
那兩支 woff2 量，方法照第八節的墨水量測。明體宣告 `300 300` + `800 800`、黑體 `300 300` + `600 600`：

| 書請求 | 明體畫出來 | 黑體畫出來 | 三家一致 |
| --- | --- | --- | --- |
| 100 / 200 / 300 / 350 / 400 | 300 | 300 | 是 |
| **500** | **300** | **300** | 是 |
| 600 / 700 / 800 / 900 | 800 | 600 | 是 |

**夾擠成立。** 500 那一格是匹配規則本身的結構，不是夾擠失效——見下一節。

**粗體那一條必須是單一值。** 先寫成 `800 900` 量過一次，書請求 900 就落在範圍內、畫出 900 沒有被夾。
範圍只要涵蓋請求的字重就會原樣放行。

## 十二、只有「剛好 500」會落錯，而且補不起來

CSS Fonts 4 的字重匹配規則，逐字：

> If the desired weight is inclusively between 400 and 500, weights greater than or equal to the
> target weight are checked in ascending order **until 500 is hit and checked**, followed by
> weights less than the target weight in descending order, followed by weights greater than 500,
> until a match is found.

所以請求 400 與請求 500 走同一條路：往上找到 500 為止，沒有就往下找，落到內文那條。450 與 499 同樣
落到內文，那是**對的**（400 以下算內文）；501 以上往上找，落到粗體。**錯的只有剛好 500 這一格。**

補一條 `500 500` 的宣告**會把內文一起帶走**——請求 400 的那條「往上找到 500 為止」先抓到它。實測
（三家一致）：

| 宣告 `300 300` + `500 500` + `800 800` | 畫出來 | |
| --- | --- | --- |
| 請求 400 | **500** | 內文整個變重 |
| 請求 500 | 500 | 仍然不是 800 |

所以這一格在 CSS 這一層沒有解，改由 frond 重述書自己的宣告（它的 `quantise-font-weight`）。

## 十三、追加長寫法蓋不蓋得過 `font` 簡寫

frond 的既有缺口是「不碰 `font` 簡寫」，理由是拆開重寫會把宣告寫壞。改寫字重不必拆開——**在後面追加
一條長寫法**就好，同一個宣告區塊裡後面的勝出。容器裡三家量過，十個案例：

| 書裡寫的 | 畫出來 | |
| --- | --- | --- |
| `font-weight: 500` | 300 | 不處理的樣子 |
| `font-weight: 800`（改寫後） | 800 | ✓ |
| `font: 500 48px`| 300 | 不處理的樣子 |
| `font: 500 48px; font-weight: 800` | 800 | ✓ |
| `font: italic 500 48px/1.2 …; font-weight: 800` | 800 | ✓ |
| `font: small-caps 600 48px …; font-weight: 800` | 800 | ✓ |
| `font: 500 48px … !important; font-weight: 800 !important` | 800 | ✓ |
| `font: 48px …`（沒寫字重） | 300 | ✓ 不需追加 |
| `font: bold 48px …` | 800 | ✓ |

**簡寫的其他部分完全沒被動到**（讀 computed style）：`font: italic 500 48px/1.2` 追加之後仍是
`size=48px style=italic line-height=57.6px`。因為那條簡寫從頭到尾只被**讀**，沒有被重寫。

### 量這件事的兩個坑

1. **不能用「墨水佔框的比例」，要用墨水總量。** 帶 `/1.2` 的簡寫框比較矮，同樣的墨水除以比較小的
   面積會虛高——第一次就是這樣量出假的 900。樣本都是同樣十個字、同樣字級，總量可以直接比。
2. **斜體要跟斜體比。** 兩條宣告都沒有斜體，所以斜體是引擎合成傾斜出來的。實測合成傾斜的墨水比直立
   少約 2%，拿去跟直立的對照組比會偏。

## 十四、換上那兩個字重之後對比拉開多少

墨水總量的倍率（粗體 ÷ 內文），三家在 3% 以內。第三欄是對今天 400/700 的增減：

| 內文／粗體 | 明體 | | 黑體 | |
| --- | --- | --- | --- | --- |
| **400 / 700**（今天）| 1.37× | — | 1.42× | — |
| 400 / 600 | 1.20× | **−12%** | 1.29× | **−9%** |
| 400 / 800 | 1.44× | +5% | 1.49× | +5% |
| 400 / 900 | 1.56× | +14% | 1.62× | +14% |
| 300 / 600 | 1.30× | −5% | **1.74×** | **+23%** |
| **300 / 800** | **1.56×** | **+14%** | 2.02× | +42% |

採用的是明體 300/800 與黑體 300/600（粗體那一欄各自加粗的那一列）。

**內文那一半才是增益的主要來源**，黑體尤其明顯：Noto Sans CJK 在 300 到 400 之間有一個大跳
（12.87% → 17.35%），內文降一階削掉的墨水比粗體加上去的還多。把內文留在 400 只加重粗體，兩種字型
都只有 +5%（400/800）；而配上原本挑的 600，兩種都比今天更糟。

不對稱是刻意的：黑體筆畫等粗，300/600 就分得出來；明體筆畫有粗細對比、字腔小，要到 800。

## 十五、還沒量的

- **實機下載時間**。19 MB 在慢網路上是分鐘等級，但沒有量過真的手機。
- **可變字型的解析時間**。第五節量的是 15.94 MB 的靜態檔。VF 是 18.83 MB 而且是 CFF2 variable，
  單次可能更貴，但從兩次解析變一次，總帳應該是賺的——沒有實際跑過。
