/**
 * The shape of a compiled catalog, for the type checker.
 *
 * The `.mjs` files these describe are build output — `lingui compile` writes them from the
 * `.po` files in this directory and `.gitignore` keeps them out of the repo. Without this,
 * type checking a fresh checkout would fail on three modules that are perfectly real but have
 * not been generated yet, which is a confusing way to be told to run a build step.
 *
 * The patterns carry the extension because the imports do: esbuild will not find these files
 * without it, and the reason is in `worker/i18n.ts`.
 *
 * `Messages` rather than a hand-written record: it is Lingui's own type for a compiled
 * catalog, so a change to that shape is a type error here rather than a surprise at runtime.
 */
declare module "*/locales/en.mjs" {
  import type { Messages } from "@lingui/core";
  export const messages: Messages;
}

declare module "*/locales/ja.mjs" {
  import type { Messages } from "@lingui/core";
  export const messages: Messages;
}

declare module "*/locales/zh-TW.mjs" {
  import type { Messages } from "@lingui/core";
  export const messages: Messages;
}
