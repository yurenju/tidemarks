// Each worker test file gets its own empty D1, so each one has to build the schema first.
//
// It builds it from `migrations/` — the same files a deploy applies — rather than from a
// fixture written for the tests. A fixture would drift from production the first time somebody
// added a column, and drift in exactly the direction that makes the tests keep passing.
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

beforeAll(async () => {
  const { DB, TEST_MIGRATIONS } = env as unknown as {
    DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
  };
  await applyD1Migrations(DB, TEST_MIGRATIONS);
});
