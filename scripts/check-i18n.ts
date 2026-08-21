// The check that keeps three catalogs honest. Run by `npm run i18n:check`, and by CI.
//
// Four things go wrong quietly, and each of them is caught here:
//
//   1. a message added and never translated — the interface falls back to English mid-sentence
//   2. a message added with no comment — an agent translates it from the bare words, which is
//      how "Order" the noun became "Order" the verb in the first place
//   3. an entry nothing uses any more — reads as work someone did, and gets kept up to date
//      (caught by the rewrite below rather than by a rule: `--clean` removes it, and the file
//      changing is the evidence)
//   4. a wording that has quietly started serving two screens
//
// None of them fails a type check or breaks a build, so this runs whether anyone remembers it
// or not. The judgement is in `i18n-audit.ts` and is tested; this half finds the files, runs
// the extractor and prints the verdict.
//
// `--write` records the sharing in (4) rather than complaining about it. That is the one
// problem here whose right answer is often "yes, on purpose" — see `sharedMessages`.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  auditCatalogs,
  formatProblems,
  parsePo,
  sharedMessages,
  type Catalog,
} from "./i18n-audit.ts";

const APP = fileURLToPath(new URL("../packages/app/", import.meta.url));
const LOCALES = ["en", "zh-TW", "ja"] as const;
const SOURCE_LOCALE = "en";
const SHARED_PATH = `${APP}src/locales/shared-messages.json`;

function catalogPath(locale: string): string {
  return `${APP}src/locales/${locale}.po`;
}

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function readCatalogs(): Catalog[] {
  return LOCALES.map((locale) => ({ locale, entries: parsePo(read(catalogPath(locale))) }));
}

function main(): number {
  const write = process.argv.includes("--write");

  // Extraction first, so what is judged is what the code actually says today rather than what
  // the catalogs last remembered. `--clean` drops entries nothing refers to any more.
  //
  // The before/after comparison is how a stale catalog is caught without involving git: a
  // second extraction over an up-to-date catalog changes nothing (there is no timestamp that
  // moves), so any difference means the committed files were behind the code.
  const before = LOCALES.map((locale) => read(catalogPath(locale)));
  try {
    execFileSync("npx", ["lingui", "extract", "--clean"], { cwd: APP, stdio: "pipe" });
  } catch (error) {
    console.error("lingui extract failed:");
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const after = LOCALES.map((locale) => read(catalogPath(locale)));

  const stale = LOCALES.filter((_, index) => before[index] !== after[index]);

  const catalogs = readCatalogs();
  const source = catalogs.find((catalog) => catalog.locale === SOURCE_LOCALE);

  if (write) {
    if (!source) {
      console.error(`no ${SOURCE_LOCALE} catalog to read sharing from`);
      return 1;
    }
    const listing = sharedMessages(source);
    writeFileSync(SHARED_PATH, `${JSON.stringify(listing, null, 2)}\n`, "utf8");
    console.log(
      `Wrote ${Object.keys(listing).length} shared messages to src/locales/shared-messages.json.`,
    );
    console.log("Read the diff: each line is one wording now answering to two screens.");
    return 0;
  }

  const listed = JSON.parse(read(SHARED_PATH) || "{}") as Record<string, string[]>;
  const problems = auditCatalogs(catalogs, SOURCE_LOCALE, listed);

  if (stale.length > 0) {
    console.error(
      `The catalogs were out of date and have been rewritten (${stale.join(", ")}).\n` +
        "Translate whatever is new, then commit them.\n",
    );
  }
  if (problems.length > 0) console.error(`${formatProblems(problems)}\n`);

  if (stale.length === 0 && problems.length === 0) {
    const total = source?.entries.length ?? 0;
    console.log(`i18n: ${total} messages, ${LOCALES.length} locales, nothing missing.`);
    return 0;
  }
  return 1;
}

process.exit(main());
