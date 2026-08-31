// What a whole fetch adds up to: which of the faces a choice needs are asked for, what the
// reader is told while they arrive, and which single note the job ends on. Not whether one
// face can be had — that is web-font-store.test.ts — and not what the page looks like once it
// has, which only a real book can show (tests/browser/reader/font-weight.spec.ts).
import { describe, expect, it } from "vitest";
import { carryFont, type FontCarrySink } from "./useCarriedFont";
import type { LoadedWebFont, WebFontStatus } from "./web-font-store";
import type { WebFont } from "./web-font";

/** Everything the job reported, in the order it said it. */
interface Reported {
  statuses: WebFontStatus[];
  busy: boolean[];
  loaded: LoadedWebFont[];
}

function recorder(cancelled: () => boolean = () => false): FontCarrySink & { seen: Reported } {
  const seen: Reported = { statuses: [], busy: [], loaded: [] };
  return {
    seen,
    status: (status) => seen.statuses.push(status),
    busy: (running) => seen.busy.push(running),
    loaded: (font) => seen.loaded.push(font),
    cancelled,
  };
}

const arrives = (font: WebFont): LoadedWebFont => ({
  family: font.family,
  kind: font.kind,
  src: `blob:${font.family}`,
});

describe("carryFont", () => {
  it("applies a face off the device without a trace or a note", async () => {
    const sink = recorder();
    const outcome = await carryFont("serif", sink, async (font, onStatus) => {
      onStatus({ state: "stored" });
      return arrives(font);
    });

    // A cached switch is instant, so there is no reflow to explain and nothing to trace.
    expect(outcome).toBe(null);
    expect(sink.seen.loaded).toHaveLength(1);
    expect(sink.seen.busy).toEqual([false]);
    expect(sink.seen.statuses).toEqual([{ state: "stored" }]);
  });

  it("announces a face that came down the wire", async () => {
    const sink = recorder();
    const outcome = await carryFont("sans", sink, async (font, onStatus) => {
      onStatus({ state: "downloading", progress: { received: 0, total: null } });
      return arrives(font);
    });

    expect(outcome).toBe("applied");
    expect(sink.seen.busy).toEqual([true, false]);
  });

  it("says a face could not be had when none of them could", async () => {
    const sink = recorder();
    const outcome = await carryFont("serif", sink, async (_font, onStatus) => {
      onStatus({ state: "unavailable" });
      return null;
    });

    expect(outcome).toBe("unavailable");
    expect(sink.seen.loaded).toEqual([]);
  });

  it("keeps quiet about a job the reader has moved on from", async () => {
    // The reader switched face while this one was on the wire. Its result must not be applied
    // over the face they are now waiting for, and its note must not be raised over that one's.
    let gone = false;
    const sink = recorder(() => gone);
    const outcome = await carryFont("serif", sink, async (font, onStatus) => {
      onStatus({ state: "downloading", progress: { received: 0, total: null } });
      gone = true;
      return arrives(font);
    });

    expect(outcome).toBe(null);
    expect(sink.seen.loaded).toEqual([]);
    // Not even the trace is cleared: the job that replaced this one owns it now.
    expect(sink.seen.busy).toEqual([true]);
  });

  it("drops a status the reader has already moved on from", async () => {
    let gone = false;
    const sink = recorder(() => gone);
    await carryFont("serif", sink, async (font, onStatus) => {
      gone = true;
      onStatus({ state: "downloading", progress: { received: 0, total: null } });
      return arrives(font);
    });

    expect(sink.seen.statuses).toEqual([]);
    expect(sink.seen.busy).toEqual([]);
  });
});
