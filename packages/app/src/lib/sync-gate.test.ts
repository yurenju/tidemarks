// Which triggers reach the server and which are swallowed. The wiring that feeds the gate real
// events is `App.tsx`; that a position from another device then reaches the reader is
// packages/app/tests/browser/reader/elsewhere.spec.ts.
import { describe, it, expect } from "vitest";
import { ACTIVITY_THROTTLE_MS, createSyncGate, RESUME_COALESCE_MS } from "./sync-gate";

/** A clock the test moves by hand, so no test waits for a real throttle window. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("createSyncGate", () => {
  it("lets the first trigger of either kind through", () => {
    const clock = fakeClock();
    expect(createSyncGate(clock.now)("activity")).toBe(true);
    expect(createSyncGate(clock.now)("resumed")).toBe(true);
  });

  it("swallows the taps that follow one, so turning pages does not sync per page", () => {
    const clock = fakeClock();
    const allow = createSyncGate(clock.now);

    expect(allow("activity")).toBe(true);
    clock.advance(ACTIVITY_THROTTLE_MS - 1);
    expect(allow("activity")).toBe(false);
    clock.advance(1);
    expect(allow("activity")).toBe(true);
  });

  it("does not make a return to the foreground wait out an activity throttle", () => {
    const clock = fakeClock();
    const allow = createSyncGate(clock.now);

    // A tap, then the reader switches away and comes back well inside the activity window —
    // the moment they most expect another device's position to be waiting for them.
    expect(allow("activity")).toBe(true);
    clock.advance(RESUME_COALESCE_MS);
    expect(allow("resumed")).toBe(true);
  });

  it("counts a restored window once, not twice", () => {
    const clock = fakeClock();
    const allow = createSyncGate(clock.now);

    // Restoring a minimised window fires visibilitychange and focus together.
    expect(allow("resumed")).toBe(true);
    clock.advance(5);
    expect(allow("resumed")).toBe(false);
  });

  it("holds activity off for the full window after a resume synced", () => {
    const clock = fakeClock();
    const allow = createSyncGate(clock.now);

    // Coming back and immediately tapping is one arrival, not two: the resume already asked.
    expect(allow("resumed")).toBe(true);
    clock.advance(RESUME_COALESCE_MS);
    expect(allow("activity")).toBe(false);
    clock.advance(ACTIVITY_THROTTLE_MS - RESUME_COALESCE_MS);
    expect(allow("activity")).toBe(true);
  });
});
