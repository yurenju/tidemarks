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
            // RESEND_API_KEY and OPEN_SIGNUP are deliberately absent: unset is the state
            // the repo ships in, so the tests run against the allowlist and against login
            // codes going to the log rather than to a vendor.
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
