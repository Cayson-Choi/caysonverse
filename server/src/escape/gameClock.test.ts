import { afterEach, describe, expect, it, vi } from "vitest";
import { GameClock } from "./gameClock";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GameClock", () => {
  it("counts real time from the start while running", () => {
    const c = new GameClock(1000);
    expect(c.paused).toBe(false);
    expect(c.now(1000)).toBe(0);
    expect(c.now(4500)).toBe(3500);
  });

  it("pause freezes, resume continues, double pause is idempotent", () => {
    const c = new GameClock(1000);
    c.pause(3000);
    expect(c.paused).toBe(true);
    expect(c.now(9000)).toBe(2000);
    // a second pause while paused changes nothing: the clock still stopped at 3000
    c.pause(5000);
    expect(c.now(9000)).toBe(2000);
    expect(c.now(20_000)).toBe(2000);
    c.resume(9000);
    expect(c.paused).toBe(false);
    expect(c.now(10_000)).toBe(3000);
    // a second resume while running changes nothing either
    c.resume(12_000);
    expect(c.now(13_000)).toBe(6000);
    // pausing again adds up
    c.pause(13_000);
    c.resume(14_000);
    expect(c.now(15_000)).toBe(7000);
  });

  it("skip moves game time forward (tests only), also while paused", () => {
    const c = new GameClock(0);
    c.skip(30_000);
    expect(c.now(1000)).toBe(31_000);
    c.pause(2000);
    c.skip(5000);
    expect(c.now(9000)).toBe(37_000);
    expect(() => c.skip(-1)).toThrow();
    expect(() => c.skip(Number.NaN)).toThrow();
  });

  it("skip throws outside the test runner", () => {
    vi.stubEnv("VITEST", "");
    const c = new GameClock(0);
    expect(() => c.skip(1000)).toThrow();
    expect(c.now(1000)).toBe(1000);
  });
});
