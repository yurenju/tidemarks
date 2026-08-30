/**
 * Which build the reader is actually running.
 *
 * The question this answers is "is the fix I deployed the code in front of me" — and with an
 * autoUpdate service worker in front of the app (`vite.config.ts`), the bundle on screen can
 * be older than the one on the server. So the stamp has to travel inside the bundle rather
 * than be fetched, which is why it is injected at build time rather than served by the worker.
 *
 * It used to carry frond's version alongside the commit, because the renderer was a separate
 * package on its own release cycle and the commit said nothing about which one was installed.
 * frond lives in this repository now (ADR-0017), so the commit already names it.
 */

import { msg } from "@lingui/core/macro";
import { i18n } from "./i18n";

export interface BuildInfo {
  /** Short commit hash. Empty when the build did not happen inside a checkout. */
  commit: string;
  /**
   * The working tree had uncommitted changes when this was built.
   *
   * Worth a field of its own because `npm run deploy` builds from a working tree rather than
   * from CI: the hash alone would name code that is not what got deployed.
   */
  dirty: boolean;
  /** ISO 8601. For a hand-run deploy this is also when it was released. */
  builtAt: string;
}

// Replaced textually by vite's `define`. Absent under vitest, which imports this module only
// for the two pure functions below.
declare const __BUILD__: BuildInfo | undefined;

const UNSTAMPED: BuildInfo = { commit: "", dirty: false, builtAt: "" };

export const BUILD: BuildInfo = typeof __BUILD__ === "undefined" ? UNSTAMPED : __BUILD__;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * `YYYY-MM-DD HH:MM` in the reader's own timezone.
 *
 * Local rather than UTC because the reader compares this against their own memory of when they
 * deployed, and that memory is in their own clock.
 */
export function localStamp(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function formatBuild(build: BuildInfo): string {
  const parts = [
    build.commit
      ? `${build.commit}${build.dirty ? "+" : ""}`
      : i18n._(
          msg({
            message: "dev build",
            comment:
              "Stands in for the commit hash in [[Settings]]'s footer when the app was built somewhere with no git checkout — a tarball, or the test image. Lower case: it sits in a line of machine detail, not a heading.",
          }),
        ),
  ];
  const stamp = localStamp(build.builtAt);
  if (stamp) parts.push(stamp);
  return parts.join(" · ");
}
