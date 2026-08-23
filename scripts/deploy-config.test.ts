// The half of the deploy script that only decides: which build variables have to be set, and
// what wrangler config they turn the repo's self-hosting one into. This code runs in
// Cloudflare's build environment, where a wrong answer is not a red light but a deployment
// pointed at the wrong database. The half that touches files and runs wrangler is not tested.
import { describe, expect, it } from "vitest";
import {
  REQUIRED_BUILD_VARIABLES,
  buildOfficialConfig,
  missingBuildVariables,
  stripJsonComments,
} from "./deploy-config.ts";

// A stand-in for the repo's self-hosting wrangler.jsonc: no ids, no routes, no vars. Small
// enough to read here, and shaped like the real one where it matters.
const SELF_HOST_CONFIG = {
  name: "tidemarks",
  main: "worker/index.ts",
  assets: { directory: "./dist", run_worker_first: ["/api/*"] },
  d1_databases: [{ binding: "DB", database_name: "tidemarks", migrations_dir: "./migrations" }],
  r2_buckets: [{ binding: "BUCKET", bucket_name: "tidemarks" }],
  kv_namespaces: [{ binding: "OAUTH_KV" }],
};

const FILLED_ENV = {
  CF_WORKER_NAME: "tidemarks",
  CF_D1_NAME: "tidemarks",
  CF_D1_ID: "d1-id",
  CF_R2_BUCKET: "tidemarks",
  CF_KV_ID: "kv-id",
  CF_ROUTE: "app.tidemarks.io",
  CF_RP_ID: "app.tidemarks.io",
  CF_ORIGIN: "https://app.tidemarks.io",
  CF_MAIL_FROM: "Tidemarks <login@tidemarks.io>",
};

describe("missingBuildVariables", () => {
  it("finds nothing when every variable is set", () => {
    expect(missingBuildVariables(FILLED_ENV)).toEqual([]);
  });

  it("reports every missing variable, not just the first", () => {
    const { CF_D1_ID: _id, CF_KV_ID: _kv, ...rest } = FILLED_ENV;
    expect(missingBuildVariables(rest)).toEqual(["CF_D1_ID", "CF_KV_ID"]);
  });

  // A build variable left blank in the dashboard arrives as "", and an empty database id
  // fails in exactly the confusing way a missing one does.
  it("treats an empty string as missing", () => {
    expect(missingBuildVariables({ ...FILLED_ENV, CF_D1_ID: "   " })).toEqual(["CF_D1_ID"]);
  });

  it("reports every required one when the environment is empty", () => {
    expect(missingBuildVariables({})).toEqual([...REQUIRED_BUILD_VARIABLES]);
  });

  // A deployment with no custom domain and no mail vendor is a supported one, not a broken
  // one — it answers on <name>.workers.dev and writes login codes to the log. Requiring these
  // two would make the smallest working deployment impossible.
  it("does not ask for the route or the sender", () => {
    const { CF_ROUTE: _r, CF_MAIL_FROM: _m, ...rest } = FILLED_ENV;
    expect(missingBuildVariables(rest)).toEqual([]);
  });
});

describe("buildOfficialConfig", () => {
  it("fills in the ids, the route and the vars", () => {
    const config = buildOfficialConfig(SELF_HOST_CONFIG, FILLED_ENV);

    expect(config.name).toBe("tidemarks");
    expect(config.d1_databases[0]).toMatchObject({
      binding: "DB",
      database_name: "tidemarks",
      database_id: "d1-id",
    });
    expect(config.r2_buckets[0]).toMatchObject({ binding: "BUCKET", bucket_name: "tidemarks" });
    expect(config.kv_namespaces[0]).toMatchObject({ binding: "OAUTH_KV", id: "kv-id" });
    expect(config.routes).toEqual([{ pattern: "app.tidemarks.io", custom_domain: true }]);
    expect(config.vars).toEqual({
      RP_ID: "app.tidemarks.io",
      ORIGIN: "https://app.tidemarks.io",
      MAIL_FROM: "Tidemarks <login@tidemarks.io>",
    });
  });

  // The whole reason the generator reads the repo's config instead of writing one from
  // scratch: a path added to `run_worker_first` has to reach production without anyone
  // remembering to edit this script too.
  it("carries through every field it does not own", () => {
    const config = buildOfficialConfig(SELF_HOST_CONFIG, FILLED_ENV);

    expect(config.main).toBe("worker/index.ts");
    expect(config.assets).toEqual({ directory: "./dist", run_worker_first: ["/api/*"] });
    expect(config.d1_databases[0]?.migrations_dir).toBe("./migrations");
  });

  it("leaves routes out entirely when there is no custom domain", () => {
    const { CF_ROUTE: _r, ...rest } = FILLED_ENV;
    const config = buildOfficialConfig(SELF_HOST_CONFIG, rest);

    // Not `[]` — an empty array is a different request from saying nothing, and the Worker
    // has to fall through to its workers.dev hostname.
    expect(config.routes).toBeUndefined();
    expect("routes" in config).toBe(false);
  });

  it("leaves MAIL_FROM out when no sender is configured", () => {
    const { CF_MAIL_FROM: _m, ...rest } = FILLED_ENV;
    const config = buildOfficialConfig(SELF_HOST_CONFIG, rest);

    // worker/email.ts reads "unset" as "write the code to the log", and an empty string is
    // not unset — it would be a sender address of "".
    expect(config.vars).toEqual({
      RP_ID: "app.tidemarks.io",
      ORIGIN: "https://app.tidemarks.io",
    });
  });

  it("treats a blank optional variable as absent", () => {
    const config = buildOfficialConfig(SELF_HOST_CONFIG, { ...FILLED_ENV, CF_ROUTE: "  " });
    expect("routes" in config).toBe(false);
  });

  it("does not mutate the config it was given", () => {
    const base = structuredClone(SELF_HOST_CONFIG);
    buildOfficialConfig(base, FILLED_ENV);
    expect(base).toEqual(SELF_HOST_CONFIG);
  });

  // Wrangler warns about any top-level field it does not know, and a warning printed on every
  // build is a warning nobody reads. So no "do not edit" marker, and nothing else invented
  // here either: the output holds exactly the keys the source had, plus the two it owns.
  it("adds no top-level field wrangler would not recognise", () => {
    const config = buildOfficialConfig(SELF_HOST_CONFIG, FILLED_ENV);
    expect(Object.keys(config).sort()).toEqual(
      [...new Set([...Object.keys(SELF_HOST_CONFIG), "routes", "vars"])].sort(),
    );
  });

  // Each of these would otherwise deploy against the wrong resource while looking fine, so
  // the generator refuses rather than guessing which binding was meant.
  it.each([
    ["d1_databases", { ...SELF_HOST_CONFIG, d1_databases: [] }],
    ["r2_buckets", { ...SELF_HOST_CONFIG, r2_buckets: [] }],
    ["kv_namespaces", { ...SELF_HOST_CONFIG, kv_namespaces: [] }],
  ])("throws when %s is empty", (_name, base) => {
    expect(() => buildOfficialConfig(base, FILLED_ENV)).toThrow(/exactly one/);
  });
});

describe("stripJsonComments", () => {
  it("removes a whole-line comment", () => {
    expect(JSON.parse(stripJsonComments('{\n  // why\n  "a": 1\n}'))).toEqual({ a: 1 });
  });

  it("removes a trailing comment", () => {
    expect(JSON.parse(stripJsonComments('{ "a": 1 // why\n}'))).toEqual({ a: 1 });
  });

  it("removes a block comment", () => {
    expect(JSON.parse(stripJsonComments('{ /* why\n   still why */ "a": 1 }'))).toEqual({ a: 1 });
  });

  // The case a regular expression gets wrong. `ORIGIN` is a URL and `//` is in the middle of
  // it, so a naive stripper truncates the value and the config still parses — wrong silently.
  it("leaves // alone inside a string", () => {
    const source = '{ "origin": "https://app.tidemarks.io" }';
    expect(JSON.parse(stripJsonComments(source))).toEqual({ origin: "https://app.tidemarks.io" });
  });

  it("leaves an escaped quote from ending the string", () => {
    const source = '{ "a": "say \\" // not a comment" }';
    expect(JSON.parse(stripJsonComments(source))).toEqual({ a: 'say " // not a comment' });
  });

  it("keeps line numbers stable so a parse error points at the right line", () => {
    const source = '{\n  // one\n  /* two\n     three */\n  "a": 1\n}';
    expect(stripJsonComments(source).split("\n")).toHaveLength(6);
  });
});
