/**
 * The phrase pool the novel-length books are assembled from. All of it was written for this
 * repository, so the books can be published like the rest of `tests/books/`.
 *
 * The text does not have to make sense, it has to lay out like a novel: the cost of a page
 * is a function of how many characters there are, where the punctuation falls, how long
 * paragraphs and sentences run, and how often dialogue quotes open and close. Those are the
 * knobs here; the meaning is incidental.
 *
 * Slots in a clause are written `{name}`, `{place}` and `{time}`. A word in `《…》` gets
 * ruby: per-character zhuyin when it is listed in `ZHUYIN`, one gloss over the whole word
 * when it is listed in `GLOSS`. Clauses carrying ruby are drawn on their own schedule
 * rather than at random, so their density stays where a real book's would be.
 */

export const NAMES = [
  "林若青",
  "沈遠",
  "阿梅",
  "周老師",
  "陳伯",
  "小滿",
  "許知秋",
  "韓叔",
  "老闆娘",
  "那個少年",
];

export const PLACES = [
  "港口",
  "舊書店",
  "渡船頭",
  "市場的盡頭",
  "山腰的寺",
  "燈塔下",
  "車站",
  "河堤上",
  "閣樓",
  "茶館",
  "巷口的麵攤",
  "學校後門",
  "防波堤",
  "郵局門口",
];

export const TIMES = [
  "清晨",
  "午後",
  "黃昏的時候",
  "入夜之後",
  "隔天一早",
  "雨停的時候",
  "那年冬天",
  "第三天",
  "過了很久",
  "不知道什麼時候",
];

export const CLAUSES = [
  "{time}，{name}獨自走到{place}",
  "風從{place}的方向吹過來",
  "{name}把手插進外套的口袋裡",
  "天色一點一點暗了下去",
  "遠處傳來幾聲狗叫",
  "她沒有回頭",
  "他停下腳步，看了一眼{place}",
  "桌上的茶早就涼了",
  "誰也沒有先開口",
  "{name}想起很久以前的一件事",
  "那件事後來再也沒有人提起",
  "燈一盞一盞亮了起來",
  "雨落在鐵皮屋頂上，聲音又密又急",
  "{name}低頭看著自己的鞋尖",
  "空氣裡有一股潮濕的鹹味",
  "船笛響了兩聲，又安靜下來",
  "門口掛著的風鈴輕輕晃了一下",
  "{name}把信摺好，收進抽屜最裡面",
  "街上的人愈來愈少",
  "{time}，{place}一個人也沒有",
  "她數著台階往上走",
  "他記得那天的天空是灰白色的",
  "窗玻璃上起了一層薄薄的霧",
  "{name}說不出自己為什麼要來",
  "腳步聲在走廊裡響了很久",
  "書架最上層落滿了灰",
  "她把那本書翻到折角的那一頁",
  "海面上浮著一層碎碎的光",
  "{name}點了點頭，又搖了搖頭",
  "時鐘的指針停在三點十分",
  "那條路比記憶中短了許多",
  "{name}在{place}站了很久",
  "他伸手去接，卻什麼也沒有接住",
  "牆角的盆栽已經枯了大半",
  "她忽然覺得很累",
  "收音機裡播著一首很舊的歌",
  "{name}把傘收起來，靠在門邊",
  "樓下有人在吵架，聽不清楚吵什麼",
  "那封信上的郵戳已經模糊了",
  "一隻貓從牆頭跳下來，鑽進了{place}",
  "{time}，{name}又回到了{place}",
  "她把頭髮撥到耳後",
  "他沒有回答，只是笑了笑",
  "整條街都是烤地瓜的味道",
  "潮水退了，露出一大片灰黑色的泥灘",
  "{name}的聲音比平常低了一些",
  "黑板上還留著上一堂課的字",
  "腳下的木板吱吱作響",
  "她把找回來的零錢一枚一枚排在桌上",
  "{name}不知道該從哪裡說起",
  "{place}、{place}和{place}都還是老樣子",
  "鹽、米、醬油和一小袋糖都擺在櫃檯上",
  "信紙、郵票、一枝沒水的鋼筆，就是抽屜裡的全部",
  "老人《蹣跚》地走過石橋",
  "山谷裡《氤氳》著一層白霧",
  "兩個人之間有些《齟齬》，誰也不肯先讓",
  "她《踽踽》獨行，影子拖得很長",
  "雨後的石板路《熠熠》發亮",
  "他把那段話《囫圇》吞了下去",
  "樹林裡傳來《窸窣》的聲響",
  "山坡上的樹《蓊鬱》得看不見天",
  "她的手背《皸裂》了好幾道口子",
  "那一整晚他都《惴惴》不安",
  "遠處的鐘聲《鏗鏘》地響了三下",
  "她說那是她的《宿敵》",
  "他第一次把她叫作《搭檔》",
  "那個地方對她來說就是《故鄉》",
  "他們管那間店叫《祕密基地》",
];

export const LINES = [
  "你來了",
  "我還以為你不會來了",
  "這裡以前不是這樣的",
  "你還記得嗎",
  "算了，不說了",
  "再等一下就好",
  "你看，那邊",
  "我不是那個意思",
  "明天還會下雨嗎",
  "他說他會回來",
  "我知道",
  "我其實什麼都不知道",
  "你要喝茶嗎？還是咖啡",
  "那就這樣吧",
  "走吧，天快黑了",
  "這本書我找了很久",
  "你怎麼會在這裡",
  "沒事，真的沒事",
  "那時候我們都還小",
  "門沒鎖，你自己進來",
  "她說，『不用等我了』",
  "你聽，是船的聲音",
  "我只是路過",
  "等這場雨停了再說",
  "你一點都沒變",
  "可是，那是最後一班船了",
  "我會再來的",
  "這是誰留下的",
];

export const SPEECH_VERBS = ["說", "低聲說", "問", "笑著說", "想了想才說", "小聲地說"];

export const CHAPTER_TITLES = [
  "霧港",
  "舊書店",
  "渡船頭",
  "燈塔",
  "雨季",
  "郵戳",
  "閣樓",
  "潮間帶",
  "風鈴",
  "末班車",
  "山寺",
  "麵攤",
  "長夜",
  "回信",
  "防波堤",
  "第三天",
  "秋汛",
  "灰白色的天空",
  "石橋",
  "冬至",
  "折角",
  "歸途",
  "空屋",
  "潮汐表",
];

/** Per-character zhuyin for the rare words a Chinese novel would annotate. */
export const ZHUYIN: ReadonlyMap<string, readonly string[]> = new Map([
  ["蹣跚", ["ㄆㄢˊ", "ㄕㄢ"]],
  ["氤氳", ["ㄧㄣ", "ㄩㄣ"]],
  ["齟齬", ["ㄐㄩˇ", "ㄩˇ"]],
  ["踽踽", ["ㄐㄩˇ", "ㄐㄩˇ"]],
  ["熠熠", ["ㄧˋ", "ㄧˋ"]],
  ["囫圇", ["ㄏㄨˊ", "ㄌㄨㄣˊ"]],
  ["窸窣", ["ㄒㄧ", "ㄙㄨˋ"]],
  ["蓊鬱", ["ㄨㄥˇ", "ㄩˋ"]],
  ["皸裂", ["ㄐㄩㄣ", "ㄌㄧㄝˋ"]],
  ["惴惴", ["ㄓㄨㄟˋ", "ㄓㄨㄟˋ"]],
  ["鏗鏘", ["ㄎㄥ", "ㄑㄧㄤ"]],
]);

/** Whole-word glosses, the way translated light novels annotate a word with another reading. */
export const GLOSS: ReadonlyMap<string, string> = new Map([
  ["宿敵", "ライバル"],
  ["搭檔", "パートナー"],
  ["故鄉", "ホーム"],
  ["祕密基地", "アジト"],
]);
