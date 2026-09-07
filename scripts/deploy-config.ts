// Turning the repo's self-hosting `wrangler.jsonc` into the configuration the official
// deployment uses. Pure functions only — reading files, writing them and running wrangler are
// `deploy.ts`'s job, which is what makes this half testable.
//
// **Why the official values are not in the repo at all**: `packages/app/wrangler.jsonc` is the
// file a self-hoster edits, and this repository is public. Ids for the official account would
// make that file useless to them and would put upstream and their fork on the same lines, so
// every `git pull` would conflict. The official values live in Workers Builds' build variables
// instead and are merged in here at build time.

export const REQUIRED_BUILD_VARIABLES = [
  "CF_WORKER_NAME",
  "CF_D1_NAME",
  "CF_D1_ID",
  "CF_R2_BUCKET",
  "CF_KV_ID",
  "CF_RP_ID",
  "CF_ORIGIN",
] as const;

// **Two things a working deployment can do without**, so requiring them would make the smallest
// one impossible rather than safer:
//
//   CF_ROUTE      no custom domain. Without it the Worker answers on <name>.workers.dev, which
//                 is what lets somebody deploy before owning a hostname.
//   CF_MAIL_FROM  no mail vendor. Without it (and without RESEND_API_KEY) login codes go to the
//                 Worker's log, which is a supported way to run this — see worker/email.ts.
//   CF_PADDLE_*   no payments. Without them (and without the two Paddle secrets) `/billing/*`
//                 answers 404 and every new account is made with no book limit at all — a
//                 deployment with nothing to sell has nothing to meter. See worker/billing.ts.
export const OPTIONAL_BUILD_VARIABLES = [
  "CF_ROUTE",
  "CF_MAIL_FROM",
  "CF_PADDLE_PRICE_ID",
  "CF_PADDLE_API_URL",
  "CF_PADDLE_CLIENT_TOKEN",
] as const;

/** The Paddle settings this half of the world can see: the build variables, not the secrets. */
export const PADDLE_BUILD_VARIABLES = [
  "CF_PADDLE_PRICE_ID",
  "CF_PADDLE_API_URL",
  "CF_PADDLE_CLIENT_TOKEN",
] as const;

/**
 * Why this deployment must stop, when Paddle's build variables are half filled in — or null when
 * they are not.
 *
 * **All or none.** Those are the only two coherent answers, and they need opposite reactions:
 * selling nothing is a supported deployment and must stay quiet, while two out of three is a
 * mistake and must be loud. Without this the mistake is the quiet one as well — `wrangler deploy`
 * goes green and nothing is wrong until a reader presses upgrade.
 *
 * ⚠️ **This sees three of the five settings.** `PADDLE_API_KEY` and `PADDLE_WEBHOOK_SECRET` go in
 * with `wrangler secret put`, which attaches them to the Worker; a build environment cannot read
 * them back, so no check here can tell a missing secret from a deployment that sells nothing. The
 * running Worker can, and does — a deployment with some settings but not all refuses `/billing/*`
 * with a 500 and a line in the log rather than a quiet 404 (worker/billing.ts).
 */
export function paddleSettingsError(env: Record<string, string | undefined>): string | null {
  const set = PADDLE_BUILD_VARIABLES.filter((name) => (env[name] ?? "").trim() !== "");
  if (set.length === 0 || set.length === PADDLE_BUILD_VARIABLES.length) return null;
  const missing = PADDLE_BUILD_VARIABLES.filter((name) => !set.includes(name));
  return (
    `Paddle is half configured: ${set.length} of ${PADDLE_BUILD_VARIABLES.length} build variables are set.\n\n` +
    `  Missing: ${missing.join(", ")}\n\n` +
    `  Set all of them or none. None means this deployment sells nothing: /billing/* answers\n` +
    `  404 and new accounts get no book limit at all.\n\n` +
    `  Two secrets go with them, and they are set elsewhere — PADDLE_API_KEY and\n` +
    `  PADDLE_WEBHOOK_SECRET, with npx wrangler secret put. This check cannot see those.\n` +
    `  See "Payments" in docs/deployment.md.`
  );
}

// **CF_SITE_ORIGIN is a build variable and is deliberately not in either list**, which is worth
// saying because looking for it here is the obvious thing to do. Nothing in this file or in
// `deploy.ts` reads it: it names the deployment's public site, and its only reader is the React
// app, so vite bakes it into the bundle at build time (`packages/app/vite.config.ts`). The lists
// above are the values that end up in the generated wrangler configuration, and that is a
// different question from "which build variables exist". See docs/deployment.md, step 7.

export const BUILD_VARIABLES = [...REQUIRED_BUILD_VARIABLES, ...OPTIONAL_BUILD_VARIABLES];

export type RequiredBuildVariable = (typeof REQUIRED_BUILD_VARIABLES)[number];
export type OptionalBuildVariable = (typeof OPTIONAL_BUILD_VARIABLES)[number];

export type BuildEnv = Record<RequiredBuildVariable, string> &
  Partial<Record<OptionalBuildVariable, string>>;

/** Every *required* build variable that is absent or blank, in the order declared above. */
export function missingBuildVariables(
  env: Record<string, string | undefined>,
): RequiredBuildVariable[] {
  return REQUIRED_BUILD_VARIABLES.filter((name) => (env[name] ?? "").trim() === "");
}

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
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
  routes?: { pattern: string; custom_domain: true }[];
  vars: {
    RP_ID: string;
    ORIGIN: string;
    MAIL_FROM?: string;
    PADDLE_PRICE_ID?: string;
    PADDLE_API_URL?: string;
    PADDLE_CLIENT_TOKEN?: string;
  };
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
export function buildOfficialConfig(base: WranglerConfig, env: BuildEnv): OfficialConfig {
  const d1 = only(base.d1_databases, "d1_databases");
  const r2 = only(base.r2_buckets, "r2_buckets");
  const kv = only(base.kv_namespaces, "kv_namespaces");

  const route = present(env.CF_ROUTE);
  const mailFrom = present(env.CF_MAIL_FROM);
  const paddlePriceId = present(env.CF_PADDLE_PRICE_ID);

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
    // Omitted rather than emitted empty when there is no custom domain: `"routes": []` is not
    // the same request as no routes at all.
    ...(route ? { routes: [{ pattern: route, custom_domain: true }] } : {}),
    vars: {
      RP_ID: env.CF_RP_ID,
      ORIGIN: env.CF_ORIGIN,
      // The domain here is whichever one is verified with Resend, which has nothing to do
      // with the hostname above. Resend refuses every message from an unverified domain, and
      // then nobody can log in — a failure that never shows up at deploy time.
      ...(mailFrom ? { MAIL_FROM: mailFrom } : {}),
      // The `CF_` prefix comes off: it marks a build variable, and these three are read by the
      // running Worker under the names Paddle's own settings have. Present together or not at
      // all, which `paddleSettingsError` has already established above.
      ...(paddlePriceId
        ? {
            PADDLE_PRICE_ID: paddlePriceId,
            PADDLE_API_URL: present(env.CF_PADDLE_API_URL)!,
            PADDLE_CLIENT_TOKEN: present(env.CF_PADDLE_CLIENT_TOKEN)!,
          }
        : {}),
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
