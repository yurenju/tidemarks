import { describe, expect, it } from "vitest";
import {
  downloadWebFont,
  webFontAppliedNote,
  webFontFraction,
  webFontNote,
  WEB_FONT_UNAVAILABLE_NOTE,
} from "./web-font-store";
import { WEB_FONTS } from "./web-font";

const SERIF = WEB_FONTS.find((f) => f.kind === "serif")!;

/** A response whose body arrives in pieces, so the progress reported is progress. */
function chunked(chunks: string[], headers: Record<string, string> = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { headers });
}

describe("downloadWebFont", () => {
  it("reports what has arrived as it arrives, against the declared total", async () => {
    const seen: { received: number; total: number | null }[] = [];
    const blob = await downloadWebFont(
      SERIF,
      (p) => seen.push(p),
      async () => chunked(["abcd", "efgh", "ij"], { "content-length": "10" }),
    );

    expect(await blob.text()).toBe("abcdefghij");
    expect(seen).toEqual([
      { received: 4, total: 10 },
      { received: 8, total: 10 },
      { received: 10, total: 10 },
    ]);
  });

  // Without `Content-Length` there is no percentage to show, and inventing one would mean a
  // bar that jumps. The caller is told the total is unknown and shows the bytes instead.
  it("says the total is unknown rather than guessing one", async () => {
    const seen: { received: number; total: number | null }[] = [];
    await downloadWebFont(
      SERIF,
      (p) => seen.push(p),
      async () => chunked(["abcd"]),
    );

    expect(seen).toEqual([{ received: 4, total: null }]);
  });

  it("throws on a response that is not the font, so the caller can fall back quietly", async () => {
    await expect(
      downloadWebFont(
        SERIF,
        () => {},
        async () => new Response("nope", { status: 404 }),
      ),
    ).rejects.toThrow();
  });

  it("fetches from the path the face declares", async () => {
    let requested = "";
    await downloadWebFont(
      SERIF,
      () => {},
      async (url) => {
        requested = url;
        return chunked(["x"]);
      },
    );
    expect(requested).toBe(SERIF.path);
  });
});

describe("webFontNote", () => {
  it("says nothing at all until there is something to say", () => {
    expect(webFontNote(null)).toBeNull();
  });

  it("counts down a percentage against the declared total", () => {
    expect(webFontNote({ state: "downloading", progress: { received: 8, total: 16 } })).toContain(
      "50%",
    );
  });

  // A percentage invented from an unknown total is a bar that jumps backwards, so the bytes
  // are shown as they are.
  it("shows megabytes when the server declared no total", () => {
    const note = webFontNote({
      state: "downloading",
      progress: { received: 3 * 1024 * 1024, total: null },
    });
    expect(note).toContain("3.0 MB");
    expect(note).not.toContain("%");
  });

  it("never shows more than 100%, however the totals disagree", () => {
    expect(webFontNote({ state: "downloading", progress: { received: 20, total: 16 } })).toContain(
      "100%",
    );
  });

  it("tells the reader the device has it, and that being offline is not a failure", () => {
    expect(webFontNote({ state: "stored" })).toBe("字型已在這台裝置上");
    expect(webFontNote({ state: "unavailable" })).toBe("連上網路後會下載字型");
  });
});

describe("webFontFraction", () => {
  // How much of the bar to fill. `null` means "there is no fraction to draw" — either nothing
  // is downloading, or the server declared no total and any fill would be invented.
  it("is null when nothing is downloading", () => {
    expect(webFontFraction(null)).toBeNull();
    expect(webFontFraction({ state: "stored" })).toBeNull();
    expect(webFontFraction({ state: "unavailable" })).toBeNull();
  });

  it("is the share of the declared total that has arrived", () => {
    expect(webFontFraction({ state: "downloading", progress: { received: 8, total: 16 } })).toBe(
      0.5,
    );
  });

  // An unknown total is what the indeterminate bar is for: the caller cannot draw a width, so
  // it draws movement instead.
  it("is null when the server declared no usable total", () => {
    expect(
      webFontFraction({ state: "downloading", progress: { received: 5, total: null } }),
    ).toBeNull();
    expect(
      webFontFraction({ state: "downloading", progress: { received: 5, total: 0 } }),
    ).toBeNull();
  });

  // A bar that overruns its track draws outside the panel; totals that disagree are the server's
  // business, not the layout's.
  it("never exceeds a full bar, however the totals disagree", () => {
    expect(webFontFraction({ state: "downloading", progress: { received: 20, total: 16 } })).toBe(
      1,
    );
  });
});

describe("webFontAppliedNote", () => {
  // The one-off toast that fires when every face the reader picked has arrived. It names the
  // face so the reflow that just happened has an explanation, and takes the label from its one
  // source (FONT_FAMILIES) rather than spelling 明體/黑體 a second time here.
  it("names the face that was just applied", () => {
    expect(webFontAppliedNote("明體")).toBe("已套用明體");
    expect(webFontAppliedNote("黑體")).toBe("已套用黑體");
  });
});

describe("WEB_FONT_UNAVAILABLE_NOTE", () => {
  // The one-off toast on a failed fetch: purely informational, asks nothing of the reader, and
  // says what they are looking at instead. The platform stack stands (ADR-0014).
  it("explains that nothing changed and why, without demanding a retry", () => {
    expect(WEB_FONT_UNAVAILABLE_NOTE).toBe("目前無法下載字型，先用系統字型");
  });
});
