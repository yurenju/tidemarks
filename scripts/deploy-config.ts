// Turning the repo's self-hosting `wrangler.jsonc` into the configuration the official
// deployment uses. Pure functions only — reading files, writing them and running wrangler are
// `deploy.ts`'s job, which is what makes this half testable.
//
// **Why the official values are not in the repo at all**: `packages/app/wrangler.jsonc` is the
// file a self-hoster edits, and this repository is public. Ids for the official account would
// make that file useless to them and would put upstream and their fork on the same lines, so
// every `git pull` would conflict. The official values live in Workers Builds' build variables
// instead and are merged in here at build time.

export const BUILD_VARIABLES = [
  "CF_WORKER_NAME",
  "CF_D1_NAME",
  "CF_D1_ID",
  "CF_R2_BUCKET",
  "CF_KV_ID",
  "CF_ROUTE",
  "CF_RP_ID",
  "CF_ORIGIN",
  "CF_MAIL_FROM",
] as const;

export type BuildVariable = (typeof BUILD_VARIABLES)[number];

export type BuildEnv = Partial<Record<BuildVariable, string>>;

/** Every build variable that is absent or blank, in the order they are declared above. */
export function missingBuildVariables(env: Record<string, string | undefined>): BuildVariable[] {
  return BUILD_VARIABLES.filter((name) => (env[name] ?? "").trim() === "");
}

interface Binding {
  binding: string;
  [key: string]: unknown;
}

export interface WranglerConfig {
  [key: string]: unknown;
  d1_databases?: Binding[];
  r2_buckets?: Binding[];
  kv_namespaces?: Binding[];
}

export interface OfficialConfig extends WranglerConfig {
  name: string;
  d1_databases: Binding[];
  r2_buckets: Binding[];
  kv_namespaces: Binding[];
  routes: { pattern: string; custom_domain: true }[];
  vars: { RP_ID: string; ORIGIN: string; MAIL_FROM: string };
}

// Exactly one of each, because the merge below writes into `[0]`. A second D1 binding would
// mean the generator silently picked one, and the deployment would talk to whichever database
// happened to be listed first.
function only(bindings: Binding[] | undefined, field: string): Binding {
  if (bindings?.length !== 1) {
    throw new Error(
      `wrangler.jsonc must declare exactly one entry under "${field}"; found ${bindings?.length ?? 0}.`,
    );
  }
  return { ...bindings[0]! };
}

/**
 * The repo's configuration with the official account's values merged in. Everything this
 * function does not name is carried through untouched — that is the point of reading the
 * repo's file rather than writing a configuration from scratch here, because otherwise a
 * change to, say, `assets.run_worker_first` would reach self-hosters and never reach
 * production.
 */
export function buildOfficialConfig(base: WranglerConfig, env: Required<BuildEnv>): OfficialConfig {
  const d1 = only(base.d1_databases, "d1_databases");
  const r2 = only(base.r2_buckets, "r2_buckets");
  const kv = only(base.kv_namespaces, "kv_namespaces");

  // **No "do not edit" marker in here.** JSON has no comments, and the obvious substitute — a
  // top-level "//" key — makes wrangler warn "Unexpected fields found in top-level field" on
  // every single build. A warning nobody can act on, printed forever, is how a build log stops
  // being read. The file name and `deploy.ts`'s own output carry that job instead.
  return {
    ...structuredClone(base),
    name: env.CF_WORKER_NAME,
    d1_databases: [{ ...d1, database_name: env.CF_D1_NAME, database_id: env.CF_D1_ID }],
    r2_buckets: [{ ...r2, bucket_name: env.CF_R2_BUCKET }],
    kv_namespaces: [{ ...kv, id: env.CF_KV_ID }],
    routes: [{ pattern: env.CF_ROUTE, custom_domain: true }],
    vars: {
      RP_ID: env.CF_RP_ID,
      ORIGIN: env.CF_ORIGIN,
      // The domain here is whichever one is verified with Resend, which has nothing to do
      // with the hostname above. Resend refuses every message from an unverified domain, and
      // then nobody can log in — a failure that never shows up at deploy time.
      MAIL_FROM: env.CF_MAIL_FROM,
    },
  };
}

/**
 * JSONC to JSON. Written out rather than pulled from a dependency because it is twenty lines
 * and this script runs before anything is built, on a Node that reads it directly.
 *
 * **A regular expression is not good enough here.** `//` appears inside `ORIGIN`'s URL and
 * inside the comments' own prose, so the scanner has to know when it is inside a string. A
 * stripper that gets this wrong produces a file that still parses, with a truncated value.
 *
 * Comments become spaces rather than disappearing, and newlines inside block comments are
 * kept, so `JSON.parse`'s error positions still point at the right line of the original file.
 */
export function stripJsonComments(source: string): string {
  let out = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index]!;

    if (char === '"') {
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      out += source.slice(start, index);
      continue;
    }

    if (char === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }

    if (char === "/" && source[index + 1] === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") out += "\n";
        index += 1;
      }
      index += 2;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}
