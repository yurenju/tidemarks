/**
 * The Lingui macro transform, for whichever bundler is asking.
 *
 * Two configs need it and need it identically — `vite.config.ts` builds the app with it, and
 * `vitest.node.config.ts` runs the tests with it. A module that writes `msg({...})` fails to
 * import at all without it, with an error naming `babel-plugin-macros` and saying nothing about
 * which of the two configs is short a plugin.
 *
 * **The config path is spelled out rather than discovered.** Discovery starts at the working
 * directory, and `npm test` starts at the repository root — where there is no Lingui config and
 * the error says only "No Lingui config found". Loading it here and handing the result to the
 * macro plugin means nothing downstream goes looking either.
 */

import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import { linguiTransformerBabelPreset } from "@lingui/vite-plugin";
import { getConfig } from "@lingui/conf";

const configPath = fileURLToPath(new URL("./lingui.config.ts", import.meta.url));
const linguiConfig = getConfig({ configPath });

export function linguiMacros() {
  return babel({ presets: [linguiTransformerBabelPreset({ linguiConfig }, { configPath })] });
}
