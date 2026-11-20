import { afterEach, describe, expect, it } from "vitest";
import { easedLiveMs, resetRideClock } from "./rideClock";

describe("rideClock (the clock the rides are drawn on)", () => {
  afterEach(() => resetRideClock());
  it("takes the first offset at once, then eases a small change in at 5 % (no skip of the train)", () => {
    expect(easedLiveMs(0, -40, 1_000_000)).toBe(1_000_000 - 40);
    // the server's next time says the offset is -4 (36 ms later): one 16 ms frame later only 0.8 ms of it is applied
    expect(easedLiveMs(16, -4, 1_000_016)).toBeCloseTo(1_000_016 - 40 + 0.8, 6);
    let t = 16;
    let v = 0;
    for (let i = 0; i < 100; i++) {
      t += 16;
      const prev = v;
      v = easedLiveMs(t, -4, 1_000_000 + t);
      if (i > 0) expect(v - prev).toBeLessThanOrEqual(16 * 1.05 + 1e-9); // never runs faster than 5 % over real time
    }
    expect(v).toBe(1_000_000 + t - 4); // caught up within a second
  });
  it("snaps to a change of more than a second (a changed device clock)", () => {
    easedLiveMs(0, 0, 5000);
    expect(easedLiveMs(16, 3_600_000, 5016)).toBe(5016 + 3_600_000);
  });
});
