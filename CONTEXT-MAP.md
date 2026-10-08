# Context map

這個 repo 有兩份詞彙表，各管一層。Matt Pocock 的 skills
（[mattpocock/skills](https://github.com/mattpocock/skills)）靠這個檔案知道不只一份。

| context | 詞彙表 | ADR | 管什麼 |
| --- | --- | --- | --- |
| Tidemarks | [`CONTEXT.md`](CONTEXT.md) | [`docs/adr/`](docs/adr/) | app 與 Worker：閱讀位置、重點與筆記、書架、同步、帳號、介面怎麼呈現 |
| frond | [`packages/frond/CONTEXT.md`](packages/frond/CONTEXT.md) | [`packages/frond/docs/adr/`](packages/frond/docs/adr/) | 渲染層：Section、頁、CFI、writing mode，以及它吐給 app 的事實 |

兩套 ADR **各自從 0001 編號**，引用另一套的時候要帶著 `frond` 這個字，見
[docs/agents/domain.md](docs/agents/domain.md)。

分界是 frond ADR-0002：frond 吐事實，app 做政策。一個詞要放哪一份，看它講的是事實還是政策。
