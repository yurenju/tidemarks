/**
 * The two orders the shelf offers, as the control shows them.
 *
 * **Apart from `shelf-order.ts` on purpose.** That module sorts, and the Worker imports it
 * (`worker/mcp/tools.ts` wants `lastTouchedAt`) — where wrangler bundles with esbuild and there
 * is no Babel, so a Lingui macro in anything the Worker can reach fails the build rather than
 * this file. Labels are the half only a screen needs, so they sit on this side of that line.
 */

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { ShelfOrder } from "./shelf-order";

export const SHELF_ORDERS: { label: MessageDescriptor; value: ShelfOrder }[] = [
  {
    label: msg({
      message: "Recently touched",
      comment:
        "One of two ways to order the shelf, in a control beside 'Title'. Touched rather than read: half of what this order does is float freshly imported books, which nobody has read yet. The glossary calls it [[Last touched]], deliberately not 「最近閱讀」.",
    }),
    value: "recent",
  },
  {
    label: msg({
      message: "Title",
      comment:
        "The other way to order the shelf: by the book's own title, collated for the interface language.",
    }),
    value: "title",
  },
];
