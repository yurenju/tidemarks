// The Chinese writing rules, and the matching. Pure functions only — finding the files and
// printing the report are `zh-lint.ts`'s job, which is what makes this half testable.
//
// What it is for: the writing rules already exist, in `CLAUDE.md` and in the output style, and
// agents still break them. Prose that reads like translated English passes every other check
// this repository has — a type checker cannot see it, a test cannot see it, and the agent that
// just wrote it reads back what it meant rather than what it typed.
//
// The rules below are not a banned-word list. Almost every string here has a correct use; what
// the rule carries is the pair of examples that tells the two apart. That is why `CheckRule`
// demands a `good` example at the type level: a rule nobody can apply is a rule that gets
// obeyed by deleting the wrong sentence.

/** What kind of repair a finding needs. Three kinds, because three keep coming up. */
export type FixKind =
  /** Say it a different way in Chinese. */
  | "rewrite"
  /** Chinese has no word for this. Use the English term. */
  | "english"
  /** The word hides an action. Write the action out. */
  | "action";

interface RuleBase {
  /** Stable id, used in the report and in the tests. */
  id: string;
  /** Literal substrings. A line containing any of them is a hit. */
  patterns: string[];
  /** What to write instead. */
  fix: string;
  fixKind: FixKind;
  /** A sentence this rule should catch. */
  bad: string;
}

/** No correct use in this repository's documents. Change it, no judgement needed. */
export interface MustRule extends RuleBase {
  level: "must";
}

/**
 * Correct sometimes, wrong sometimes, and no pattern can tell which. The reader decides, so
 * the report has to hand them both examples.
 */
export interface CheckRule extends RuleBase {
  level: "check";
  /** A sentence this rule catches but should not be changed. */
  good: string;
}

export type Rule = MustRule | CheckRule;

// Simplified-only characters. Copied rather than imported from
// `packages/app/src/lib/chinese.ts`, which holds the same set for a different purpose: that one
// needs Simplified and Traditional index-aligned so it can guess a book's variant, this one only
// needs to know a character is Simplified. Reaching across a package boundary to share a string
// would cost more than the duplicate does.
const SIMPLIFIED_CHARACTERS =
  "书体们对时说这为过还进无发现应学习让认识谁读语难观觉产贵购费货质资页项风飞饭饮马验门问间闻电头买卖乐经红级练统继绝纪岁归当断点会";

// Every Mainland wording this checks for, Simplified spellings included. The character rule is
// only a second net and a leaky one: it holds 63 common characters, so 软, 缓, 码, 优, 赖, 内,
// 调 and 默 are not in it. Anything added here has to stand on its own.
//
// `程序` and `返回` are deliberately absent: both are ordinary Traditional Chinese in the right
// sentence (程序正義, Android 的返回鍵), so they sit at the second level instead.
const MAINLAND_WORDINGS: Array<[string, string]> = [
  ["信息", "資訊"],
  ["质量", "品質"],
  ["代码", "程式碼"],
  ["软件", "軟體"],
  ["硬件", "硬體"],
  ["默认", "預設"],
  ["缓存", "快取"],
  ["内存", "記憶體"],
  ["调用", "呼叫"],
  ["优化", "最佳化"],
  ["依赖", "相依套件"],
];

/**
 * Level one: change it.
 *
 * The bar for this level is not "this word is bad", it is "no sentence in this repository's
 * documents would use it correctly". `咬` and `拍` both have ordinary Chinese uses — a dog
 * bites, a camera takes a photo — and neither sentence will ever appear here. That is what
 * makes matching a bare character safe, and it is the whole reason this level can be trusted
 * enough to apply without reading.
 */
export const MUST_RULES: MustRule[] = [
  {
    id: "em-dash",
    level: "must",
    patterns: ["——"],
    fix: "逗號、句號，或括號",
    fixKind: "rewrite",
    bad: "這個值每次都重設——所以手動改沒有用",
  },
  {
    id: "criterion",
    level: "must",
    patterns: ["判準"],
    fix: "怎麼分、依據什麼、標準",
    fixKind: "rewrite",
    bad: "這兩欄的判準是什麼",
  },
  {
    id: "bite",
    level: "must",
    patterns: ["咬"],
    fix: "這裡容易出錯、這個地方會出問題、之後會很難收",
    fixKind: "rewrite",
    bad: "這個 bug 之後會反過來咬你",
  },
  {
    id: "shoot",
    level: "must",
    patterns: ["拍"],
    fix: "改用「截圖」，而且不要縮成「截」；講時間用「同一時間」「同一步」",
    fixKind: "rewrite",
    bad: "截圖預設只拍 chromium",
  },
  {
    id: "stock",
    level: "must",
    patterns: ["存量"],
    fix: "本來就在檔案裡的那些、既有的、原本就有的",
    fixKind: "rewrite",
    bad: "跑一次全 repo，照報告清存量",
  },
  {
    id: "non-trivial",
    level: "must",
    patterns: ["不瑣碎", "非瑣碎"],
    fix: "不簡單、很複雜、要花的工不少",
    fixKind: "rewrite",
    bad: "這是一個不瑣碎的問題",
  },
  {
    id: "graceful",
    level: "must",
    patterns: ["優雅地", "優雅降級", "優雅關閉"],
    // The label already says "write the action out", so this is only the action.
    fix: "關之前先把還沒回完的請求做完",
    fixKind: "action",
    bad: "服務要能優雅地關閉連線",
  },
  {
    id: "instrumented",
    level: "must",
    patterns: ["儀器化"],
    fix: "instrumented",
    fixKind: "english",
    bad: "取樣器、trace helper、儀器化的 log",
  },
  // These two sit here rather than at the second level for the reason the level exists: neither
  // has a correct use. Chinese has no 回呼 — the word for a callback is `callback` — and
  // 呼吸空間 is breathing room carried over whole.
  {
    id: "callback",
    level: "must",
    patterns: ["回呼"],
    fix: "callback",
    fixKind: "english",
    bad: "傳一個回呼進去",
  },
  {
    id: "breathing-room",
    level: "must",
    patterns: ["呼吸空間"],
    fix: "留白",
    fixKind: "rewrite",
    bad: "固定內距剛好是缺的那段視覺呼吸空間",
  },
  ...MAINLAND_WORDINGS.map(([wording, taiwanese]): MustRule => ({
    id: `mainland-${wording}`,
    level: "must",
    patterns: [wording],
    fix: taiwanese,
    fixKind: "rewrite",
    bad: `這裡的「${wording}」要改掉`,
  })),
];

/**
 * Level two: read it, then decide.
 *
 * Every rule here fires on sentences that are perfectly good Chinese, which is the point. A
 * report that says only "you wrote 買" gets the correct sentences rewritten too, and rewriting
 * correct Chinese into stilted Chinese is worse than leaving the wrong word alone. So the
 * examples travel with the finding.
 */
export const CHECK_RULES: CheckRule[] = [
  // Japanese kanji and Simplified characters overlap heavily (体, 学, 会, 読, 電), and this
  // repository quotes Japanese on purpose: fixture prose, a cited paper, the 简繁 table that
  // `chinese.ts` is tested against. So a character being Simplified is a question, not a verdict.
  {
    id: "simplified",
    level: "check",
    patterns: [...SIMPLIFIED_CHARACTERS],
    fix: "對應的正體字",
    fixKind: "rewrite",
    good: "`书→書` 對照表換掉就沒有東西可測了",
    bad: "这个设定会被覆盖",
  },
  {
    id: "procedure",
    level: "check",
    patterns: ["程序"],
    fix: "程式",
    fixKind: "rewrite",
    good: "這在程序上來說是要這麼做",
    bad: "這支程序跑起來要三分鐘",
  },
  // The Simplified 质量 is on the first level; this is the Traditional spelling, which is a real
  // word for a real thing (mass) and only wrong when it has been borrowed for quality.
  {
    id: "mass",
    level: "check",
    patterns: ["質量"],
    fix: "品質",
    fixKind: "rewrite",
    good: "這個物體的質量是五公斤",
    bad: "這份程式碼的質量很差",
  },
  {
    id: "return",
    level: "check",
    patterns: ["返回"],
    fix: "回傳",
    fixKind: "rewrite",
    good: "Android 的返回鍵關的是抽屜而不是整個 app",
    bad: "這個函式返回一個字串",
  },
  {
    id: "prose",
    level: "check",
    // `行文` is the other word that gets reached for here, and it is worse: it belongs to
    // official documents, not to writing about writing.
    patterns: ["散文", "行文"],
    fix: "段落、敘述",
    fixKind: "rewrite",
    good: "fixture 的日文散文",
    bad: "用散文寫，不要條列",
  },
  {
    id: "buy",
    level: "check",
    patterns: ["買"],
    fix: "換到的是什麼、擋得住哪一類問題",
    fixKind: "rewrite",
    good: "使用者付錢之前要把自己買的書上傳",
    bad: "合成 fixture 在這裡買到的正是「錯了會有東西紅」",
  },
  {
    id: "tension",
    level: "check",
    patterns: ["張力"],
    fix: "打架、對不起來、不一致",
    fixKind: "rewrite",
    good: "繩子的張力不夠",
    bad: "這兩條規則之間存在張力",
  },
  {
    id: "argument",
    level: "check",
    patterns: ["論據"],
    fix: "理由",
    fixKind: "rewrite",
    good: "辯論比賽評的是論據，不是誰講話大聲",
    bad: "這一段的論據不夠",
  },
  {
    id: "hook",
    level: "check",
    patterns: ["鉤子"],
    fix: "hook",
    fixKind: "english",
    good: "牆上那個掛東西的鉤子",
    bad: "這個鉤子會在 commit 前跑",
  },
  {
    id: "robust",
    level: "check",
    patterns: ["強健"],
    fix: "不容易壞",
    fixKind: "rewrite",
    good: "身體很強健",
    bad: "這個實作很強健",
  },
  {
    id: "teeth",
    level: "check",
    patterns: ["牙齒"],
    fix: "這條測試真的會紅",
    fixKind: "rewrite",
    good: "咬合不正要看牙齒",
    bad: "已驗證有牙齒：把 firefox 從清單移除，那兩條立刻紅",
  },
  {
    id: "instrument",
    level: "check",
    patterns: ["儀器"],
    fix: "量測工具",
    fixKind: "rewrite",
    good: "實驗室裡的儀器",
    bad: "唯一的儀器是真的瀏覽器",
  },
  {
    id: "cheap",
    level: "check",
    patterns: ["便宜"],
    fix: "很簡單、很快、代價很小",
    fixKind: "rewrite",
    good: "這套字型的授權很便宜",
    bad: "自己一個人的時候改很便宜",
  },
  {
    id: "goalkeeper",
    level: "check",
    patterns: ["守門員"],
    fix: "沒有自動化的檢查",
    fixKind: "rewrite",
    good: "那支球隊的守門員",
    bad: "那個缺陷類別在回歸上沒有自動化的守門員",
  },
  {
    id: "slippery-slope",
    level: "check",
    patterns: ["滑坡"],
    fix: "一路退讓下去",
    fixKind: "rewrite",
    good: "大雨過後那條路發生滑坡",
    bad: "就是為了擋「再加一個聽起來很合理的理由」這條滑坡",
  },
  {
    id: "pain",
    level: "check",
    patterns: ["痛"],
    fix: "很麻煩、代價很大、幾乎沒差",
    fixKind: "rewrite",
    good: "使用者反應盯久了眼睛會痛",
    bad: "這件 UI 的事在 app 做很痛",
  },
  {
    id: "attribution",
    level: "check",
    patterns: ["歸屬"],
    fix: "這一段在講誰",
    fixKind: "rewrite",
    good: "責任歸屬要先講清楚",
    bad: "整段的歸屬掛在那行小字上",
  },
  {
    id: "expensive",
    level: "check",
    patterns: ["昂貴"],
    fix: "很花時間、很吃記憶體",
    fixKind: "rewrite",
    good: "這套字型的授權很昂貴",
    bad: "這個操作很昂貴",
  },
  {
    id: "surface",
    level: "check",
    patterns: ["浮現"],
    fix: "顯示、點出來、講出來",
    fixKind: "rewrite",
    good: "面板從畫面底下浮現",
    bad: "把這個錯誤浮現給使用者",
  },
  {
    id: "trivial",
    level: "check",
    patterns: ["瑣碎"],
    fix: "很簡單",
    fixKind: "rewrite",
    good: "一堆瑣碎的雜事",
    bad: "這個改動很瑣碎",
  },
  {
    id: "elegant",
    level: "check",
    patterns: ["優雅"],
    fix: "收乾淨、不會炸掉",
    fixKind: "rewrite",
    good: "這個解法很優雅",
    bad: "服務要能優雅收尾",
  },
  {
    id: "document-vs-file",
    level: "check",
    patterns: ["文件"],
    fix: "指 file 的時候寫「檔案」",
    fixKind: "rewrite",
    good: "這份 ADR 是一份說明文件",
    bad: "把那個文件刪掉再跑一次",
  },
];

export const RULES: Rule[] = [...MUST_RULES, ...CHECK_RULES];

export interface Finding {
  rule: Rule;
  /** 1-indexed. */
  line: number;
  /** The whole line, trimmed. */
  text: string;
  /** Which of the rule's patterns matched. */
  match: string;
}

/**
 * A file that opts out. Documents that teach these rules have to quote the wrong sentences, so
 * without this the rule list would fail its own check.
 */
export const IGNORE_MARKER = "zh-lint: ignore-file";

/** Whether a document has opted out. */
export function isIgnored(text: string): boolean {
  return text.includes(IGNORE_MARKER);
}

/**
 * Every rule that fires on every line, in file order.
 *
 * `lines` is the whole document, or just the lines a change added — the caller decides, which
 * is what lets the same matching serve both the pre-push check and the one-off sweep.
 */
export interface LineOfText {
  /** 1-indexed. */
  line: number;
  text: string;
}

export function lint(lines: LineOfText[], rules: Rule[] = RULES): Finding[] {
  const findings: Finding[] = [];
  for (const { line, text } of lines) {
    for (const rule of rules) {
      // The earliest hit in the sentence, not the first pattern in the list. It matters for the
      // Simplified rule, whose patterns are 63 unrelated characters: picking by list order names
      // a character from the middle of the line and reads like the report chose at random.
      let match: string | undefined;
      let at = Infinity;
      for (const pattern of rule.patterns) {
        const index = text.indexOf(pattern);
        if (index !== -1 && index < at) {
          at = index;
          match = pattern;
        }
      }
      if (match !== undefined) findings.push({ rule, line, text: text.trim(), match });
    }
  }
  return findings;
}

/**
 * The lines a `git diff --unified=0` adds, by file.
 *
 * Pure, and separate from the git call, because everything that goes wrong here goes wrong
 * quietly: a header this misreads produces an empty report rather than an error, and an empty
 * report is indistinguishable from clean writing.
 *
 * Expects `core.quotePath=false` so a path with non-ASCII characters arrives as itself rather
 * than as an escaped, quoted string — every document in this repository is Chinese, so a
 * Chinese filename is a matter of time.
 */
export function parseAddedLines(diff: string): Array<{ path: string; lines: LineOfText[] }> {
  const documents = new Map<string, LineOfText[]>();
  let path: string | null = null;
  let next = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      // `+++ b/some file.md<TAB>` — git pads the header with a tab when the path has a space.
      const named = line.slice(4).replace(/\t.*$/, "");
      path = named === "/dev/null" ? null : named.replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
    if (hunk) {
      next = Number(hunk[1]);
      continue;
    }
    if (path === null || !line.startsWith("+")) continue;
    const lines = documents.get(path) ?? [];
    lines.push({ line: next, text: line.slice(1) });
    documents.set(path, lines);
    next += 1;
  }

  return [...documents].map(([path, lines]) => ({ path, lines }));
}

export const FIX_LABEL: Record<FixKind, string> = {
  rewrite: "改成",
  english: "用英文原文",
  action: "把動作寫出來",
};

/** One finding, as the lines that go in the report. */
export function formatFinding(path: string, finding: Finding): string {
  const { rule, line, text, match } = finding;
  const label = rule.level === "must" ? "一定要改" : "要檢查";
  const out = [`${path}:${line}  [${label}]  ${match}`, `  原句：${text}`];
  if (rule.level === "check") out.push(`  正例：${rule.good}`, `  反例：${rule.bad}`);
  out.push(`  ${FIX_LABEL[rule.fixKind]}：${rule.fix}`);
  return out.join("\n");
}

/** How many findings each rule produced, most first. Long sweeps need this more than the list. */
export function summarise(findings: Finding[]): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const { rule } of findings) counts.set(rule.id, (counts.get(rule.id) ?? 0) + 1);
  return [...counts]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}
