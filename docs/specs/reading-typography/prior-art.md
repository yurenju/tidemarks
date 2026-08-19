# 別家的排版設定放在哪一層

查於 2026-08-17，支撐 [ADR-0026](../../adr/0026-the-reader-adjusts-their-own-reading-not-this-book.md)。

要回答的是四題：排版設定是全域一份還是每本書一份；如果兩層，預設方向寫哪一層；直排與橫排是不是
各存一組字級行距；主題跟排版在不在同一個選單。

**「找不到第一手證據」在下表是一個答案，不是空白。**推測不寫進來，因為這份文件的用處之一就是讓
下一次重查的人知道前一次卡在哪。

## 結論表

| 閱讀軟體 | 設定範圍 | 預設寫到哪／有無「套用到所有書」 | 直排與橫排是否各一組 | 主題與排版同一選單 |
| --- | --- | --- | --- | --- |
| Apple Books | 全域一份 | 全域；沒有那顆按鈕，只有 Reset Theme | 找不到第一手證據 | 是 |
| Amazon Kindle | **全域一份（綁裝置），官方明文** | 全域；不需要那顆按鈕，改用可存的 themes | 找不到第一手證據 | 是 |
| Kobo | 英文與日文說法相反，無法確認 | 找不到第一手證據 | 找不到第一手證據 | 傾向否，未確認 |
| KOReader | **兩層**：每本書一份 sidecar 加全域預設 | **寫這本書**；長按該選項才提升成預設 | 不支援直排，問題不成立 | 否 |
| Google Play Books | 找不到第一手證據 | 找不到第一手證據 | 找不到第一手證據 | 同一個 Display options，分兩個分頁 |
| Moon+ Reader | 找不到第一手證據 | 找不到第一手證據 | 找不到第一手證據 | 未確認 |
| Thorium Reader | **兩層**：每本書一份加可存的偏好 | **寫這本書**；跨書要按 Save | 找不到第一手證據 | 未確認 |
| Readest | **兩層，而且有看得見的勾選框** | **寫全域**；取消 `Global Settings` 才變單本 | 找不到第一手證據 | 另一個面板，同受該勾選框管轄 |
| Calibre viewer | 全域一份 | 全域；多組偏好靠 Profiles | 找不到第一手證據 | 是，一起進 profile |
| Readmoo 讀墨 | 找不到第一手證據 | 找不到第一手證據 | 找不到第一手證據 | 配色與字型行距同在「Aa」面板 |
| HyRead | 找不到第一手證據 | 找不到第一手證據 | 找不到第一手證據 | 找不到第一手證據 |
| 微信讀書 | 找不到第一手證據 | 找不到第一手證據 | **不支援直排**，會強制轉橫排 | 分開：夜間在閱讀面板，其餘在設定頁 |
| 多看閱讀 | 找不到第一手證據 | 找不到第一手證據 | 找不到第一手證據 | 同在「Aa」面板 |

## 證據等級不一樣，要分開看

只有 `github.com` 與 `raw.githubusercontent.com` 連得出去，其餘各家都只能靠搜尋引擎抓到的頁面
片段。所以**四家開源軟體（KOReader、Thorium、Readest、Calibre）的結論是讀原始碼與官方 wiki 得到
的，可信度最高**，其餘各家只到「搜尋摘要」這一級。

- **Amazon Kindle** 是唯一把範圍寫進官方客服頁的：「Your preferences apply to all the books that
  you read on your Kindle, and display settings may vary across Kindle device models.」唯一的
  per-book 項目是 Publisher Font，而且只在該書有內嵌字型時出現。
  <https://www.amazon.com/gp/help/customer/display.html?nodeId=T5Y94BzSCGwm0vd75W>
- **KOReader** 讀得到原始碼：排版存在 per-document 的 `configurable` 表，長按某個選項才寫進
  `G_reader_settings`（key 是 `copt_*`），另有整包的 Save/Reset document settings as default。
  直排沒實作，issue 還開著。
  <https://github.com/koreader/koreader/wiki/Change-defaults> ／
  <https://github.com/koreader/koreader/issues/4353>
- **Thorium Reader** 是最值得看的一家，因為它**曾經是全域，後來刻意改掉**，而且留下了理由。
  這條反向證據在 ADR-0026 裡正面回答過。
  <https://github.com/edrlab/thorium-reader/discussions/3127>
- **Readest** 的方向跟 Thorium 相反：預設全域，per-book 是逃生門，逃生門是每一節 ⋯ 選單裡的
  `Global Settings` 勾選框。官方 wiki：「by default the custom CSS settings are saved to global
  settings which apply to all books. You can uncheck the `Global Settings` option」。
  <https://github.com/readest/readest/wiki/Custom-CSS-for-Styling-Books-and-the-Reader-UI>
- **Calibre viewer** 的偏好存在單一全域 `JSONConfig('viewer-webengine')`，per-book 只存閱讀速率
  之類。多組偏好靠 `viewer/profiles.json`，本質是「多組全域」而不是單本覆寫。
  <https://github.com/kovidgoyal/calibre/blob/master/src/calibre/gui2/viewer/config.py>
- **Apple Books** 的官方 user guide 只描述操作，一句都沒講範圍。第三方描述是「Books 會記住你選的
  theme，所有的書都用它顯示」。真正的 per-book 差異來自書本身：固定版面的書會讓選單只剩字級與底色。
- **Readmoo 讀墨** 能確認的只有可調項目（橫直排切換、字體、字級、行距、強制黑字、還原預設排版；
  配色三檔），範圍那一題完全沒有官方文件可讀。
- **微信讀書** 唯一能明確回答的是直排那題：**不支援**，書城的古籍與自行上傳的直排書都會被轉成橫排。
  官方的同步說明列的是進度、書架、筆記，**排版設定不在同步清單裡**。

## 三個結論

1. **商業主流是全域一份。** Apple Books、Kindle、Calibre viewer 都是，Kindle 還寫進了官方客服頁。
2. **這三家都沒有「套用到所有書」那顆按鈕**，因為預設就是全域，那顆按鈕沒有存在的理由。要多組偏好
   就給 theme 或 profile 切換。反過來說，**那顆按鈕的存在本身就是寫入方向反了的證據**。
3. **兩層只在開源陣營出現**，而且三家方向不同：KOReader 與 Thorium 預設寫單本，Readest 預設寫全域。

## 直排那一題是空白地帶

十三家沒有一家找得到第一手證據顯示直排與橫排各存一組字級行距。這不等於沒有人這樣做，只表示這件事
沒有可以抄的先例，Folis 得自己拿證據。回頭的條件寫在 ADR-0026。

## 什麼時候值得重查

被 proxy 擋掉而投了放行請求的網域裡，**`help.kobo.com`、`help.readmoo.com`、`ebook.hyread.com.tw`
這三組最值得補**：Kobo、讀墨、HyRead 是空白最多的三列，而且讀墨與 HyRead 是少數真的在賣直排中文書
的地方，第三題只有它們可能有答案。

`reddit.com` 與 `web.archive.org` 是工具層擋的，不是白名單問題，所以 reddit 那條線這次整條走不通。

其餘被擋的網域：`support.apple.com`、`discussions.apple.com`、`support.google.com`、
`www.amazon.com`、`wiki.mobileread.com`、`koreader.rocks`、`manual.calibre-ebook.com`、
`thorium.edrlab.org`、`readest.com`、`weread.qq.com`、`play.google.com`、`sspai.com`、
`www.zhihu.com`、`www.duokan.com`。
