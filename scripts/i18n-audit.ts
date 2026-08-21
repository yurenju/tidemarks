// Reading catalogs and judging them. Pure functions only — finding the files, running
// `lingui extract` and printing the verdict are `check-i18n.ts`'s job, which is what makes this
// half testable.
//
// What it is for: most of translation goes wrong quietly. A message added without a comment is
// a message an agent will translate from a bare string; an entry nobody uses any more still
// reads as work someone did; a string that two screens happen to share is fine until the day
// one of them needs a different word. None of those break a build or fail a type check, so the
// only thing that catches them is a check that runs whether anyone remembers it or not.

/** One entry of a PO catalog, as much of it as the checks below care about. */
export interface CatalogEntry {
  /** The message id. Its English text, or an explicit name for the messages the Worker owns. */
  id: string;
  /** The translation. Empty means untranslated. */
  translation: string;
  /** The `#.` comments: what the code said to whoever translates this. */
  comments: string[];
  /** The `#:` references, one per file the message is used in. */
  files: string[];
  /** `#, fuzzy` and friends. An obsolete entry is one nothing refers to any more. */
  obsolete: boolean;
}

/**
 * A PO file as entries.
 *
 * Hand-rolled rather than pulled from a library, because what is being read is a file this
 * repository's own tooling wrote: `@lingui/format-po` with `lineNumbers: false`. The full
 * grammar has previous-msgid comments, plural forms and message contexts spread over more
 * lines than this reads; adding a parser dependency to check three properties would be the
 * larger cost.
 */
export function parsePo(text: string): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  let comments: string[] = [];
  let files: string[] = [];
  let obsolete = false;
  let context: string | null = null;
  let id: string | null = null;
  let translation: string | null = null;
  /** Which multi-line string the continuation lines belong to. */
  let filling: "id" | "translation" | "context" | null = null;

  const flush = () => {
    if (id !== null && id !== "") {
      entries.push({
        // Context is part of the identity, so two entries that differ only by it must not
        // collapse into one here — that would hide the very case context exists for.
        id: context === null ? id : `${id}${context}`,
        translation: translation ?? "",
        comments,
        files,
        obsolete,
      });
    }
    comments = [];
    files = [];
    obsolete = false;
    context = null;
    id = null;
    translation = null;
    filling = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();

    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("#.")) {
      comments.push(line.slice(2).trim());
      continue;
    }
    if (line.startsWith("#:")) {
      files.push(line.slice(2).trim());
      continue;
    }
    if (line.startsWith("#,")) {
      obsolete ||= line.includes("obsolete");
      continue;
    }
    if (line.startsWith("#")) continue;

    if (line.startsWith("msgctxt ")) {
      filling = "context";
      context = unquote(line.slice("msgctxt ".length));
      continue;
    }
    if (line.startsWith("msgid ")) {
      filling = "id";
      id = unquote(line.slice("msgid ".length));
      continue;
    }
    if (line.startsWith("msgstr ")) {
      filling = "translation";
      translation = unquote(line.slice("msgstr ".length));
      continue;
    }
    // A bare quoted line continues whichever string came last.
    if (line.startsWith('"')) {
      const piece = unquote(line);
      if (filling === "id") id = (id ?? "") + piece;
      else if (filling === "translation") translation = (translation ?? "") + piece;
      else if (filling === "context") context = (context ?? "") + piece;
    }
  }
  flush();

  return entries;
}

function unquote(value: string): string {
  const inner = value.trim().replace(/^"/, "").replace(/"$/, "");
  return inner
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

export interface Problem {
  kind: "untranslated" | "no-comment" | "obsolete" | "unlisted-sharing";
  locale: string;
  id: string;
  detail: string;
}

/** A catalog, named by its locale. */
export interface Catalog {
  locale: string;
  entries: CatalogEntry[];
}

/**
 * Which messages are used from more than one file, and by which files.
 *
 * Sharing is the default and usually right — "Close" is one word however many drawers wear it.
 * What is worth seeing is the moment a message **starts** being shared, because that is the
 * moment a second screen's meaning gets attached to a first screen's wording, and the day the
 * two need different words nobody will remember that they were ever one entry.
 *
 * So this is not a rule against sharing. It is a list, kept in the repository, whose diff makes
 * each new case something a person said yes to once.
 */
export function sharedMessages(source: Catalog): Record<string, string[]> {
  const shared: Record<string, string[]> = {};
  for (const entry of source.entries) {
    if (entry.obsolete) continue;
    const files = [...new Set(entry.files)].sort();
    if (files.length > 1) shared[entry.id] = files;
  }
  return shared;
}

/**
 * Everything wrong with a set of catalogs.
 *
 * `sourceLocale` is held to a different standard from the rest: its "translation" is the
 * message itself, so it can never be missing one, and it is the only catalog carrying the
 * comments the code wrote.
 */
export function auditCatalogs(
  catalogs: readonly Catalog[],
  sourceLocale: string,
  listedSharing: Record<string, string[]>,
): Problem[] {
  const problems: Problem[] = [];
  const source = catalogs.find((catalog) => catalog.locale === sourceLocale);

  for (const catalog of catalogs) {
    for (const entry of catalog.entries) {
      if (entry.obsolete) {
        problems.push({
          kind: "obsolete",
          locale: catalog.locale,
          id: entry.id,
          detail: "nothing uses this message any more — run `npm run i18n:extract -w app`",
        });
        continue;
      }
      if (catalog.locale !== sourceLocale && entry.translation === "") {
        problems.push({
          kind: "untranslated",
          locale: catalog.locale,
          id: entry.id,
          detail: "no translation",
        });
      }
    }
  }

  if (source) {
    for (const entry of source.entries) {
      if (entry.obsolete) continue;
      if (entry.comments.length === 0) {
        problems.push({
          kind: "no-comment",
          locale: sourceLocale,
          id: entry.id,
          detail:
            "no comment — say where this appears and what it means, or it gets translated from the words alone",
        });
      }
    }

    for (const [id, files] of Object.entries(sharedMessages(source))) {
      const listed = listedSharing[id];
      if (listed === undefined) {
        problems.push({
          kind: "unlisted-sharing",
          locale: sourceLocale,
          id,
          detail: `now used from ${files.length} files (${files.join(", ")}) — one wording is about to serve all of them. If they should stay one message, run \`npm run i18n:check -- --write\`; if not, give one of them a \`context\``,
        });
        continue;
      }
      const added = files.filter((file) => !listed.includes(file));
      if (added.length > 0) {
        problems.push({
          kind: "unlisted-sharing",
          locale: sourceLocale,
          id,
          detail: `also used from ${added.join(", ")} now — confirm with \`npm run i18n:check -- --write\``,
        });
      }
    }
  }

  return problems;
}

/** What a person reads when the check fails. One line per problem, grouped by kind. */
export function formatProblems(problems: readonly Problem[]): string {
  const headings: Record<Problem["kind"], string> = {
    untranslated: "Missing translations",
    "no-comment": "Messages with no comment for whoever translates them",
    obsolete: "Entries nothing uses any more",
    "unlisted-sharing": "Messages that started being shared between files",
  };

  const lines: string[] = [];
  for (const kind of Object.keys(headings) as Problem["kind"][]) {
    const group = problems.filter((problem) => problem.kind === kind);
    if (group.length === 0) continue;
    lines.push(`${headings[kind]} (${group.length}):`);
    for (const problem of group) {
      lines.push(`  [${problem.locale}] ${problem.id}`);
      lines.push(`      ${problem.detail}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
