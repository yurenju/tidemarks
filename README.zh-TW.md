<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/tidemarks-wordmark-dark.svg">
    <img src="docs/brand/tidemarks-wordmark.svg" alt="Tidemarks" width="340">
  </picture>
</p>

tidemarks 是一款 epub 閱讀網頁應用程式，用於閱讀、劃重點與寫筆記，預設為可離線運行的 PWA (Progressive Web App)。

官方託管的網站網址是 https://app.tidemarks.io/

註冊帳號後可以在多裝置之間同步書籍、閱讀進度、重點與筆記，同時支援 MCP (Model Context Protocol) 協定，讓 AI 一同陪伴你閱讀與解惑。

官方託管的雲端同步為付費服務，同時本軟體為開放源碼軟體，亦即任何人都可以自行架設、維護同步服務。自行佈署請見[docs/deployment.md](docs/deployment.md)。

English: [README.md](README.md)

## 功能

- 多本書庫：拖放或選檔匯入 epub，書架顯示封面、進度、累計閱讀時長與場次
- 閱讀器：左右翻頁（含方向鍵）、目錄跳轉、自動續讀上次位置
- 劃重點：選取文字後選顏色標記，可附加筆記；重點側欄依書中順序列出、點擊跳轉
- 閱讀統計：每次開書自動記錄 session，累計時長與場次
- 匯出：單本書筆記匯出 markdown；完整資料（含 epub 檔本體）匯出 JSON，換瀏覽器可匯入接續
- 同步（選配）：電腦匯入的書自動出現在手機書櫃，進度、重點筆記、閱讀統計跨裝置互通；epub 本體點開才下載

## 開發

要自己跑起來、跑測試或改東西，見 [docs/development.md](docs/development.md)。

## 關於貢獻

本專案雖為開放源碼專案，但維護開發社群與能量實需耗費精力，目前暫時沒有制定關於貢獻的指南。

## 授權

MIT，全文在 [LICENSE](LICENSE)。這個 repo 收錄或引用的第三方素材列在
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
