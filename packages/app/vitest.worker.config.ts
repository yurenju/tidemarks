import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// The Worker itself, inside workerd, with a real D1, R2 and KV. Few tests on purpose — this is
// the expensive layer — and each one covers something the pure tests structurally cannot see: a
// column name, a bound parameter's position, whether a token is really required. Those are the
// bugs that typecheck cleanly and fail in production.
//
// A project of its own rather than a second entry inside `vitest.node.config.ts`, because
// Vitest's projects do not nest: the root config collects project *configs*, and a project
// config cannot declare projects of its own.
//
// **Every path here is resolved against this file, not against the working directory.** The
// runner is started from the repository root (`npm test`), so a bare `'migrations'` would look
// for it there and find nothing.
export default defineConfig(async () => {
  // Read here, in Node, and handed to the Worker as a binding; the setup file applies them to
  // each test file's own fresh database. Every worker test is therefore also a check that
  // `migrations/` builds a working schema, for free.
  const migrations = await readD1Migrations(resolve(import.meta.dirname, "migrations"));

  // A real public-domain book, base64 because workerd has no filesystem and a binding is JSON.
  // The small one: the point is that a genuine epub opens and its CFIs resolve, not which book
  // it is, and the large one would be a 3.8 MB string in every worker test's environment.
  //
  // The books sit at the repository root because both packages read the same files (they are
  // byte-identical, and two copies would be two things to keep in step).
  const epub = await readFile(
    resolve(import.meta.dirname, "../../tests/books/kusamakura-vertical-japanese.epub"),
  );

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: resolve(import.meta.dirname, "wrangler.jsonc") },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_EPUB: epub.toString("base64"),
            // A secret in production (`wrangler secret put`), so it is not in
            // wrangler.jsonc and has to be supplied here.
            COOKIE_SECRET: "test-cookie-secret",
            // Set to the host the tests fetch, so the default state here is a correctly
            // configured deployment and a test that wants a mismatch says so itself. Like
            // COOKIE_SECRET this cannot come from wrangler.jsonc: RP_ID is a build variable,
            // and that file deliberately ships without one.
            RP_ID: "tidemarks.test",
            // RESEND_API_KEY and OPEN_SIGNUP are deliberately empty: unset is the state the repo
            // ships in, so the tests run against the allowlist and against login codes going to
            // the log rather than to a vendor. Both are read for truthiness, so blank is unset.
            //
            // ⚠️ **Written out rather than left off**, because `.dev.vars` is loaded here too and
            // would otherwise decide these. That file is exactly where somebody following
            // docs/deployment.md puts `OPEN_SIGNUP=true` to try a checkout locally — and the
            // signup-gate tests would then fail on their machine and pass in CI, for a file that
            // is not in the repository.
            OPEN_SIGNUP: "",
            RESEND_API_KEY: "",
            //
            // Paddle is the other way round — all five set, so the default here is a deployment
            // that sells something and the webhook is reachable at all. The API URL points
            // nowhere on purpose: the only path these tests walk is the webhook, which Paddle
            // calls rather than the other way round, so a request leaving for Paddle would be a
            // test reaching the network and should fail.
            PADDLE_API_URL: "https://paddle.invalid",
            PADDLE_API_KEY: "test-api-key",
            PADDLE_WEBHOOK_SECRET: "test-webhook-secret",
            PADDLE_PRICE_ID: "pri_test",
            PADDLE_CLIENT_TOKEN: "test_client_token",
          },
        },
      }),
    ],
    test: {
      name: "worker",
      include: ["worker/**/*.integration.test.ts"],
      setupFiles: ["./worker/integration-setup.ts"],
    },
  };
});
