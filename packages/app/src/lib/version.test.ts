import { describe, expect, it } from "vitest";
import { formatBuild, localStamp, type BuildInfo } from "./version";

const BUILT: BuildInfo = {
  commit: "93134bd",
  dirty: false,
  builtAt: "2026-07-31T12:00:00.000Z",
};

describe("localStamp", () => {
  it("reads the instant back in the reader own timezone", () => {
    // Built from a local Date and read back locally, so this holds wherever it runs — the
    // stamp is an instant, and which day that instant falls on depends on where you are.
    const local = new Date(2026, 6, 31, 12, 34);
    expect(localStamp(local.toISOString())).toBe("2026-07-31 12:34");
  });

  it("pads a single-digit month, day, hour and minute", () => {
    expect(localStamp(new Date(2026, 0, 5, 9, 8).toISOString())).toBe("2026-01-05 09:08");
  });

  it("is empty for a build that never stamped one", () => {
    expect(localStamp("")).toBe("");
  });
});

describe("formatBuild", () => {
  it("names the commit and when it was built", () => {
    expect(formatBuild(BUILT)).toBe(`93134bd · ${localStamp(BUILT.builtAt)}`);
  });

  it("marks a build made from a working tree with uncommitted changes", () => {
    // `npm run deploy` builds from whatever is checked out, so this is a real state to be in
    // and the hash on its own would describe code that was never what got deployed.
    expect(formatBuild({ ...BUILT, dirty: true })).toContain("93134bd+");
  });

  it("says so rather than inventing a version when there was no checkout to read", () => {
    expect(formatBuild({ ...BUILT, commit: "", builtAt: "" })).toBe("dev build");
  });
});
