import { describe, expect, it } from "vitest";
import { rpIdCoversHost, rpIdMismatchMessage } from "./rp-id";
import { i18nOf } from "./i18n";

// Assertions read the source language, so a failure is a difference in behaviour rather than
// one in translation.
const i18n = i18nOf("en");

describe("whether an RP ID covers the host a request arrived on", () => {
  it("covers the host it is equal to", () => {
    expect(rpIdCoversHost("app.tidemarks.io", "app.tidemarks.io")).toBe(true);
  });

  it("covers a host below it, because WebAuthn allows a registrable domain above", () => {
    expect(rpIdCoversHost("tidemarks.io", "app.tidemarks.io")).toBe(true);
  });

  it("does not cover a host above it — that direction is not allowed", () => {
    expect(rpIdCoversHost("app.tidemarks.io", "tidemarks.io")).toBe(false);
  });

  it("does not cover a host that merely ends with the same letters", () => {
    // The dot is the whole reason this is not `endsWith(rpID)`: somebody else's
    // `nottidemarks.io` shares the tail and shares nothing else.
    expect(rpIdCoversHost("tidemarks.io", "nottidemarks.io")).toBe(false);
  });

  it("covers localhost, which is how a developer registers a real passkey", () => {
    // Pinned because local development depends on it: `RP_ID=localhost` in `.dev.vars`, and a
    // hostname carries no port, which is the reason this rule is about hostnames at all.
    expect(rpIdCoversHost("localhost", "localhost")).toBe(true);
  });

  it("ignores the capitals somebody typed into the dashboard field", () => {
    // CF_RP_ID is typed by hand, and `App.Example.com` names the same host as
    // `app.example.com`. `URL` hands us a lower-cased host, so without folding the other side
    // this would refuse a deployment that is configured correctly — and say so by printing two
    // hostnames that read the same.
    expect(rpIdCoversHost("App.Example.com", "app.example.com")).toBe(true);
    expect(rpIdCoversHost("Example.com", "app.example.com")).toBe(true);
  });

  it("ignores the root's trailing dot", () => {
    expect(rpIdCoversHost("example.com.", "app.example.com")).toBe(true);
  });

  it("covers nothing at all when it is unset", () => {
    // `scripts/deploy.ts` stops a build that is missing CF_RP_ID, so this state should not
    // reach a deployment. Should not is not the same as cannot, and an unset binding must not
    // read as "matches everything".
    expect(rpIdCoversHost(undefined, "app.tidemarks.io")).toBe(false);
    expect(rpIdCoversHost("", "app.tidemarks.io")).toBe(false);
  });
});

describe("the sentence a mismatch produces", () => {
  it("is absent when the RP ID covers the host", () => {
    expect(rpIdMismatchMessage(i18n, "tidemarks.io", "app.tidemarks.io")).toBeNull();
  });

  it("names both hostnames, so the reader does not have to go and look one up", () => {
    const message = rpIdMismatchMessage(i18n, "app.tidemarks.io", "tidemarks-abc.workers.dev");
    expect(message).toContain("app.tidemarks.io");
    expect(message).toContain("tidemarks-abc.workers.dev");
  });

  it("points at the way back in, which is the mailed code", () => {
    expect(rpIdMismatchMessage(i18n, "app.tidemarks.io", "elsewhere.example")).toContain(
      "emailed code",
    );
  });

  it("says so rather than leaving a blank when the RP ID is unset", () => {
    const message = rpIdMismatchMessage(i18n, undefined, "app.tidemarks.io");
    expect(message).toContain("(not set)");
  });
});
