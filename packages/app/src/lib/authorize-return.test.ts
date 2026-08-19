import { describe, expect, it } from "vitest";
import { authorizeReturnTarget } from "./authorize-return";

describe("authorizeReturnTarget", () => {
  it("follows a return to the authorization endpoint, query and all", () => {
    const search = `?next=${encodeURIComponent("/authorize?client_id=abc&state=xyz")}`;
    expect(authorizeReturnTarget(search)).toBe("/authorize?client_id=abc&state=xyz");
  });

  it("has nothing to follow when no login was in progress", () => {
    expect(authorizeReturnTarget("")).toBeNull();
    expect(authorizeReturnTarget("?other=1")).toBeNull();
  });

  it("refuses an absolute URL, which is the open redirect", () => {
    expect(
      authorizeReturnTarget(`?next=${encodeURIComponent("https://evil.example/")}`),
    ).toBeNull();
  });

  it("refuses a protocol-relative URL, which also begins with a slash", () => {
    // The trap: `//evil.example/x` passes any check that only asks for a leading slash, and
    // the browser reads it as a different host entirely.
    expect(authorizeReturnTarget(`?next=${encodeURIComponent("//evil.example/x")}`)).toBeNull();
  });

  it("refuses a same-origin path that is not the authorization endpoint", () => {
    expect(authorizeReturnTarget("?next=%2Fsettings")).toBeNull();
    expect(authorizeReturnTarget("?next=%2Fauthorize-elsewhere")).toBeNull();
  });
});
