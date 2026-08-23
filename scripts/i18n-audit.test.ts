// The catalog rules CI enforces, as pure functions: how a .po file is read, and the four ways a
// catalog fails — no translation, no comment, an entry nothing uses any more, and a wording
// that has quietly started serving a second file. Nothing above this layer re-checks them.
import { describe, expect, it } from "vitest";
import { auditCatalogs, formatProblems, parsePo, sharedMessages } from "./i18n-audit";

const HEADER = `msgid ""
msgstr ""
"Language: en\\n"
`;

function po(body: string): string {
  return `${HEADER}\n${body}`;
}

describe("parsePo", () => {
  it("reads an entry with its comment, its files and its translation", () => {
    const entries = parsePo(
      po(`#. Button on the shelf that opens the file picker.
#: src/components/Library.tsx
msgid "Import epub"
msgstr "匯入 epub"
`),
    );

    expect(entries).toEqual([
      {
        id: "Import epub",
        translation: "匯入 epub",
        comments: ["Button on the shelf that opens the file picker."],
        files: ["src/components/Library.tsx"],
        obsolete: false,
      },
    ]);
  });

  it("skips the header, which is a message id of nothing", () => {
    expect(parsePo(HEADER)).toEqual([]);
  });

  it("joins a message written over several lines", () => {
    const [entry] = parsePo(
      po(`#. A long one.
msgid ""
"Once connected, it can read:\\n"
"\\n"
"  · every book on your shelf"
msgstr ""
"連上之後，它讀得到：\\n"
"\\n"
"  · 你書架上所有的書"
`),
    );

    expect(entry?.id).toBe("Once connected, it can read:\n\n  · every book on your shelf");
    expect(entry?.translation).toBe("連上之後，它讀得到：\n\n  · 你書架上所有的書");
  });

  it("keeps two messages that differ only by context apart", () => {
    // The whole reason this project needed a framework: one English word, two meanings, two
    // translations. Collapsing them here would hide exactly the case being guarded.
    const entries = parsePo(
      po(`#. The verb.
msgctxt "action"
msgid "Order"
msgstr "排序"

#. The noun.
msgctxt "sequence"
msgid "Order"
msgstr "順序"
`),
    );

    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
  });

  it("notices an entry marked obsolete", () => {
    const [entry] = parsePo(
      po(`#. Gone.
#, obsolete
msgid "Old wording"
msgstr "舊的說法"
`),
    );

    expect(entry?.obsolete).toBe(true);
  });
});

describe("sharedMessages", () => {
  const source = {
    locale: "en",
    entries: [
      { id: "Close", translation: "", comments: ["x"], files: ["a.tsx", "b.tsx"], obsolete: false },
      { id: "Only here", translation: "", comments: ["x"], files: ["a.tsx"], obsolete: false },
    ],
  };

  it("names the messages more than one file uses, and the files", () => {
    expect(sharedMessages(source)).toEqual({ Close: ["a.tsx", "b.tsx"] });
  });

  it("does not count the same file twice", () => {
    const twice = {
      locale: "en",
      entries: [
        {
          id: "Close",
          translation: "",
          comments: ["x"],
          files: ["a.tsx", "a.tsx"],
          obsolete: false,
        },
      ],
    };
    expect(sharedMessages(twice)).toEqual({});
  });
});

describe("auditCatalogs", () => {
  const comment = ["Where this appears."];
  const en = {
    locale: "en",
    entries: [
      { id: "Close", translation: "Close", comments: comment, files: ["a.tsx"], obsolete: false },
    ],
  };

  it("passes catalogs that are complete, commented and unshared", () => {
    const zh = {
      locale: "zh-TW",
      entries: [{ id: "Close", translation: "關閉", comments: [], files: [], obsolete: false }],
    };
    expect(auditCatalogs([en, zh], "en", {})).toEqual([]);
  });

  it("fails a translation that is not there", () => {
    const ja = {
      locale: "ja",
      entries: [{ id: "Close", translation: "", comments: [], files: [], obsolete: false }],
    };
    const problems = auditCatalogs([en, ja], "en", {});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: "untranslated", locale: "ja", id: "Close" });
  });

  it("does not ask the source locale for a translation of itself", () => {
    // Its messages are already in it — the id *is* the English.
    const bare = {
      locale: "en",
      entries: [
        { id: "Close", translation: "", comments: comment, files: ["a.tsx"], obsolete: false },
      ],
    };
    expect(auditCatalogs([bare], "en", {})).toEqual([]);
  });

  it("fails a message that carries no comment", () => {
    const uncommented = {
      locale: "en",
      entries: [
        { id: "Close", translation: "Close", comments: [], files: ["a.tsx"], obsolete: false },
      ],
    };
    const problems = auditCatalogs([uncommented], "en", {});
    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe("no-comment");
  });

  it("fails an entry nothing uses any more", () => {
    const stale = {
      locale: "zh-TW",
      entries: [{ id: "Old", translation: "舊", comments: [], files: [], obsolete: true }],
    };
    const problems = auditCatalogs([en, stale], "zh-TW", {});
    expect(problems.map((problem) => problem.kind)).toContain("obsolete");
  });

  it("does not also demand a translation for an entry it is about to say is dead", () => {
    const stale = {
      locale: "ja",
      entries: [{ id: "Old", translation: "", comments: [], files: [], obsolete: true }],
    };
    const problems = auditCatalogs([en, stale], "en", {});
    expect(problems.filter((problem) => problem.id === "Old")).toHaveLength(1);
  });

  describe("sharing between files", () => {
    const shared = {
      locale: "en",
      entries: [
        {
          id: "Close",
          translation: "Close",
          comments: comment,
          files: ["Drawer.tsx", "Panel.tsx"],
          obsolete: false,
        },
      ],
    };

    it("flags a message that has started being used from a second file", () => {
      const problems = auditCatalogs([shared], "en", {});
      expect(problems).toHaveLength(1);
      expect(problems[0]?.kind).toBe("unlisted-sharing");
    });

    it("says nothing once the sharing has been written down", () => {
      expect(auditCatalogs([shared], "en", { Close: ["Drawer.tsx", "Panel.tsx"] })).toEqual([]);
    });

    it("flags a third file joining a sharing that was already agreed", () => {
      // The one that would otherwise slip through: the entry is on the list, so a check that
      // only asked "is it listed" would pass a wording quietly taking on a third meaning.
      const problems = auditCatalogs([shared], "en", { Close: ["Drawer.tsx"] });
      expect(problems).toHaveLength(1);
      expect(problems[0]?.detail).toContain("Panel.tsx");
    });
  });
});

describe("formatProblems", () => {
  it("says nothing when there is nothing to say", () => {
    expect(formatProblems([])).toBe("");
  });

  it("groups problems under a heading that counts them", () => {
    const report = formatProblems([
      { kind: "untranslated", locale: "ja", id: "Close", detail: "no translation" },
      { kind: "untranslated", locale: "zh-TW", id: "Close", detail: "no translation" },
    ]);
    expect(report).toContain("Missing translations (2):");
    expect(report).toContain("[ja] Close");
  });
});
