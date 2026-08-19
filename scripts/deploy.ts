// Deployment. Cloudflare's build form points at `npm run deploy` (production) and
// `npm run versions:upload` (every other branch), and both land here.
//
//     node scripts/deploy.ts production   generate config → apply migrations → deploy
//     node scripts/deploy.ts preview      generate config → upload a version
//
// **This is the only way anything is deployed, official or self-hosted.** There is no deploy
// from a laptop: the account-specific values live in Workers Builds' build variables, so the
// build environment is the only place that has them. Somebody self-hosting sets the same
// variables in their own dashboard and runs the same command — see docs/deployment.md.
//
// **Why a script and not a chain of npm scripts.** Two rules here are invisible in a shell
// one-liner and expensive to get wrong, so they need somewhere to be written down:
//
//  1. `d1 migrations apply` has to be given `--config` explicitly. It is not among the
//     commands that pick up `.wrangler/deploy/config.json`, so without the flag it reads the
//     repo's self-hosting configuration and applies migrations to whatever database that
//     names — without failing.
//  2. Preview builds must not migrate. A branch's migration applied to the production
//     database before the branch lands cannot be undone. Preview versions therefore run one
//     migration behind until they merge, which is the right way round. See docs/deployment.md.
//
// Both would be a matter of "the other script happens not to do that" if this were two files.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  OPTIONAL_BUILD_VARIABLES,
  REQUIRED_BUILD_VARIABLES,
  buildOfficialConfig,
  missingBuildVariables,
  stripJsonComments,
  type BuildEnv,
  type OfficialConfig,
  type WranglerConfig,
} from "./deploy-config.ts";

// Every path is resolved against this file. The deploy command runs from the repository root,
// and `packages/app` is where both wrangler configurations live.
const APP_DIR = resolve(import.meta.dirname, "../packages/app");
const SOURCE_CONFIG = resolve(APP_DIR, "wrangler.jsonc");

// **The generated file has to sit beside the source one.** Wrangler resolves `main`,
// `assets.directory` and `migrations_dir` relative to the configuration file itself, so a
// generated config anywhere else sends wrangler looking for `worker/index.ts` in the wrong
// directory. Git-ignored: it is build output, and it holds the official account's ids.
const GENERATED_CONFIG = "wrangler.generated.json";

type Mode = "production" | "preview";

function fail(message: string): never {
  console.error(`\n✘ ${message}\n`);
  process.exit(1);
}

function readMode(argument: string | undefined): Mode {
  if (argument === "production" || argument === "preview") return argument;
  fail(`Usage: node scripts/deploy.ts <production|preview> (got ${argument ?? "nothing"})`);
}

function readBuildVariables(): BuildEnv {
  const missing = missingBuildVariables(process.env);
  if (missing.length > 0) {
    fail(
      `Missing build variables: ${missing.join(", ")}\n\n` +
        `  These are set in the Cloudflare dashboard, under the Worker's\n` +
        `  Settings → Builds → Variables and Secrets.\n\n` +
        `  Required: ${REQUIRED_BUILD_VARIABLES.join(", ")}\n` +
        `  Optional: ${OPTIONAL_BUILD_VARIABLES.join(", ")}\n` +
        `    (no CF_ROUTE serves the Worker from <name>.workers.dev; no CF_MAIL_FROM writes\n` +
        `     login codes to the log instead of mailing them)\n\n` +
        `  Stopping rather than falling back to packages/app/wrangler.jsonc, which carries no\n` +
        `  ids: see "How a deployment is configured" in docs/deployment.md.`,
    );
  }
  // Every name is present and non-blank, which is what the check above establishes.
  return Object.fromEntries(
    [...REQUIRED_BUILD_VARIABLES, ...OPTIONAL_BUILD_VARIABLES]
      .map((name) => [name, process.env[name]])
      .filter(([, value]) => value !== undefined),
  ) as BuildEnv;
}

function generateConfig(): OfficialConfig {
  const source = readFileSync(SOURCE_CONFIG, "utf8");

  let base: WranglerConfig;
  try {
    base = JSON.parse(stripJsonComments(source)) as WranglerConfig;
  } catch (error) {
    fail(`Could not parse ${SOURCE_CONFIG}: ${(error as Error).message}`);
  }

  const config = buildOfficialConfig(base, readBuildVariables());
  writeFileSync(resolve(APP_DIR, GENERATED_CONFIG), `${JSON.stringify(config, null, 2)}\n`);

  const where = config.routes ? config.routes[0]!.pattern : `${config.name}.workers.dev`;
  console.log(`Generated ${GENERATED_CONFIG} for worker "${config.name}" on ${where}`);
  return config;
}

// npm hoists workspace binaries to the root, which is where wrangler lands even though it is
// declared by `packages/app`. Resolved here rather than through `require.resolve` because
// wrangler's `exports` map does not publish its bin script, and falling back to PATH covers
// running this file directly, outside `npm run`.
//
// **Looked up when it is first needed, not at import time.** A missing binary must not be the
// error a reader sees when what actually went wrong was a missing build variable.
function wranglerBin(): string {
  const hoisted = resolve(import.meta.dirname, "../node_modules/.bin/wrangler");
  return existsSync(hoisted) ? hoisted : "wrangler";
}

function wrangler(...args: string[]): void {
  const printable = ["wrangler", ...args].join(" ");
  console.log(`\n$ ${printable}`);

  const result = spawnSync(wranglerBin(), args, { cwd: APP_DIR, stdio: "inherit" });

  if (result.error) fail(`Could not run wrangler: ${result.error.message}`);

  if (result.status !== 0) fail(`\`${printable}\` exited with ${result.status ?? result.signal}`);
}

const mode = readMode(process.argv[2]);
const config = generateConfig();

if (mode === "production") {
  // Migrations first: a Worker that reads a column the database has not got yet fails on its
  // first request, not at deploy time.
  //
  // The binding is read back out of the configuration rather than written here as "DB".
  // `d1 migrations apply` takes a name or a binding, and taking the binding means this script
  // cannot disagree with the file it just generated.
  const binding = config.d1_databases[0]!.binding;
  wrangler("d1", "migrations", "apply", binding, "--remote", "--config", GENERATED_CONFIG);
  wrangler("deploy", "--config", GENERATED_CONFIG);
} else {
  // No migrations here — see the header. The generated config still carries the production
  // route when there is one, which is harmless: `versions upload` does not apply routes.
  wrangler("versions", "upload", "--config", GENERATED_CONFIG);
}
