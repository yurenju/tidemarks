// When a position that arrived from another device is worth interrupting the reader for, and
// how long ago it was written. The merge that let it arrive at all is merge.test.ts's; what is
// asked here is the question after that one — the reader is looking at this book right now, so
// is the new position somewhere else?
import { describe, expect, it } from "vitest";
import { elapsedSince, positionFromElsewhere } from "./elsewhere";
import type { Progress } from "./types";

// A page of a made-up book: the reader sits at `/4/2/1:10`, on a page running from `/4/2` to
// `/4/8`. Every case below moves the arriving position around that page.
const HERE: Progress = {
  bookId: "b1",
  cfi: "epubcfi(/6/4!/4/2/1:10)",
  pageRange: "epubcfi(/6/4!/4,/2/1:0,/8/1:40)",
  percentage: 0.28,
  chapterLabel: "第三章",
  lastReadAt: 1000,
};

function arrived(over: Partial<Progress>): Progress {
  return { ...HERE, pageRange: null, chapterLabel: "第七章　雨", lastReadAt: 2000, ...over };
}

describe("positionFromElsewhere", () => {
  it("offers a newer position from off the page", () => {
    const remote = arrived({ cfi: "epubcfi(/6/4!/12/2/1:0)", percentage: 0.68 });
    expect(positionFromElsewhere(HERE, remote)).toBe(remote);
  });

  it("says nothing when the arriving position is the older one", () => {
    // The reader carried on here after that device stopped. LWW already settles it, and there
    // is nothing to offer that is not behind where they are sitting.
    expect(positionFromElsewhere(HERE, arrived({ lastReadAt: 999 }))).toBeNull();
  });

  it("says nothing on a tie", () => {
    // The same row coming back round — a push echoed by the next pull. Offering it would put a
    // banner on screen for a position the reader is already at.
    expect(positionFromElsewhere(HERE, arrived({ lastReadAt: 1000 }))).toBeNull();
  });

  it("says nothing when the arriving position is on the page already on screen", () => {
    // Two pages further on that device is worth saying; two paragraphs down this same page is
    // noise, and the page is what the reader can see.
    const remote = arrived({ cfi: "epubcfi(/6/4!/4/6/1:2)", percentage: 0.281 });
    expect(positionFromElsewhere(HERE, remote)).toBeNull();
  });

  it("counts the page's own edges as on the page", () => {
    expect(positionFromElsewhere(HERE, arrived({ cfi: "epubcfi(/6/4!/4/2/1:0)" }))).toBeNull();
    expect(positionFromElsewhere(HERE, arrived({ cfi: "epubcfi(/6/4!/4/8/1:40)" }))).toBeNull();
  });

  it("offers a position that falls just off the page's far edge", () => {
    const remote = arrived({ cfi: "epubcfi(/6/4!/4/8/1:41)" });
    expect(positionFromElsewhere(HERE, remote)).toBe(remote);
  });

  it("offers a position behind the page as readily as one ahead of it", () => {
    // Turning back to reread is a real thing to have done on the other device, and the reader
    // is the one who decides whether to follow. Furthest-wins is exactly what this is not.
    const remote = arrived({ cfi: "epubcfi(/6/2!/2/2/1:0)", percentage: 0.04 });
    expect(positionFromElsewhere(HERE, remote)).toBe(remote);
  });

  describe("without a page to compare against", () => {
    // `pageRange` is null on a full-page image and on rows written before the field existed.
    // Then the only shared ground left is the percentage — and the fallback compares the whole
    // number the banner would print, because a banner repeating the number already on the bar
    // has nothing to say.
    const noPage: Progress = { ...HERE, pageRange: null };

    it("says nothing when the two would print the same percentage", () => {
      expect(positionFromElsewhere(noPage, arrived({ percentage: 0.2849 }))).toBeNull();
    });

    it("offers one that would print a different percentage", () => {
      const remote = arrived({ percentage: 0.29 });
      expect(positionFromElsewhere(noPage, remote)).toBe(remote);
    });
  });

  it("says nothing when the page cannot be parsed", () => {
    // A stored range from an older format, or a half-written value. Failing loudly here would
    // put an exception in the middle of a sync; the reader loses a banner instead.
    expect(positionFromElsewhere({ ...HERE, pageRange: "not a cfi" }, arrived({}))).toBeNull();
  });
});

describe("elapsedSince", () => {
  const MINUTE = 60_000;

  it("reads under a minute as just now", () => {
    expect(elapsedSince(0, 59_999)).toEqual({ unit: "now" });
  });

  it("counts whole minutes, then whole hours, then whole days", () => {
    expect(elapsedSince(0, 5 * MINUTE)).toEqual({ unit: "minutes", count: 5 });
    expect(elapsedSince(0, 59 * MINUTE)).toEqual({ unit: "minutes", count: 59 });
    expect(elapsedSince(0, 90 * MINUTE)).toEqual({ unit: "hours", count: 1 });
    expect(elapsedSince(0, 26 * 60 * MINUTE)).toEqual({ unit: "days", count: 1 });
  });

  it("reads a position written in the future as just now", () => {
    // `lastReadAt` carries the clock of whichever device wrote it (see `merge.ts`), and two
    // devices are not in step. A few minutes of drift must not print "in 3 minutes".
    expect(elapsedSince(3 * MINUTE, 0)).toEqual({ unit: "now" });
  });
});
