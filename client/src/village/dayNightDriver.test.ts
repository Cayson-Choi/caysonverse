import { describe, expect, it } from "vitest";
import { TARGET_SECONDS, dayNightAt, indoorState } from "./dayNightBlend";
import { createDayNightDriver, resetOnVisible, type VisibilitySource } from "./dayNightDriver";
import { createVillageClock } from "./villageClock";

/** The time of day, stepped (Task 7A): the clock read every 10 s, the look eased every frame, the hall apart. */

const HOUR = 3_600_000;
const kst = (s: string) => Date.parse(`${s}+09:00`);
const NOON = kst("2026-06-21T12:30:00");
const MIDNIGHT = kst("2026-06-21T23:59:00");

/** A driver on a clock we move by hand. */
function setup(start = NOON) {
  let now = start;
  let jumps = 0;
  const clock = { nowMs: () => now, jumps: () => jumps };
  const driver = createDayNightDriver(clock);
  return {
    driver,
    set: (t: number) => void (now = t),
    jump: (t: number) => {
      now = t;
      jumps++;
    },
  };
}

describe("the driver", () => {
  it("the first step snaps to the clock: a visitor at night never sees a day-lit frame ease to night", () => {
    const { driver } = setup(MIDNIGHT);
    driver.step(0.016, false);
    expect(driver.applied.night).toBe(1);
    expect(driver.applied.lights).toBe(1);
    expect(driver.outdoor.exposure).toBe(dayNightAt(MIDNIGHT).exposure);
  });

  it("reads the clock every 10 s, not every frame, and eases toward what it read (no step)", () => {
    const s = setup(NOON);
    s.driver.step(0.016, false); // snap to noon
    s.set(MIDNIGHT); // the clock moves ahead, but nobody has looked yet
    for (let t = 0; t < TARGET_SECONDS - 0.5; t += 0.5) s.driver.step(0.5, false);
    expect(s.driver.target.night).toBe(0); // still the noon target
    expect(s.driver.applied.night).toBe(0);
    s.driver.step(1, false); // past 10 s: the target is read
    expect(s.driver.target.night).toBe(1);
    expect(s.driver.applied.night).toBeGreaterThan(0); // moving ...
    expect(s.driver.applied.night).toBeLessThan(0.6); // ... but not there: a glide
    for (let i = 0; i < 400; i++) s.driver.step(0.1, false);
    expect(s.driver.applied.night).toBeCloseTo(1, 3);
  });

  it("dusk through the evening: the night weight never falls and never moves more than a hair per frame", () => {
    const start = kst("2026-06-21T19:00:00");
    const s = setup(start);
    s.driver.step(0.016, false);
    let prev = s.driver.applied.night;
    let maxStep = 0;
    // 90 minutes of the evening, 1/10 s per frame (the clock advances in real time).
    for (let sec = 0; sec < 5400; sec += 0.1) {
      s.set(start + sec * 1000);
      s.driver.step(0.1, false);
      const n = s.driver.applied.night;
      expect(n).toBeGreaterThanOrEqual(prev - 1e-9);
      maxStep = Math.max(maxStep, n - prev);
      prev = n;
    }
    expect(prev).toBeGreaterThan(0.99);
    expect(maxStep).toBeLessThan(0.005);
  });

  it("in the hall the scene shows the warm indoor light, never the night; the open village keeps easing underneath", () => {
    const s = setup(MIDNIGHT);
    s.driver.step(0.016, false);
    expect(s.driver.applied.night).toBe(1);
    s.driver.step(0.016, true); // a door: the very next frame is indoors
    expect(s.driver.applied).toEqual(indoorState());
    expect(s.driver.applied.lights).toBe(0);
    expect(s.driver.applied.exposure).toBe(indoorState().exposure);
    expect(s.driver.outdoor.night).toBe(1); // what the hall's windows will show of the sky (Task 9)
    s.driver.step(0.016, false); // out again at night: straight to night, no glide through the day
    expect(s.driver.applied.night).toBe(1);
  });

  it("a jump of the clock (the server's time arriving after a device clock that was wrong) snaps instead of easing across it", () => {
    const s = setup(NOON);
    s.driver.step(0.016, false);
    s.jump(MIDNIGHT);
    s.driver.step(0.016, false);
    expect(s.driver.applied.night).toBe(1);
    expect(s.driver.outdoor.night).toBe(1);
  });

  it("reset makes the next step a snap again", () => {
    const s = setup(NOON);
    s.driver.step(0.016, false);
    s.set(MIDNIGHT);
    s.driver.reset();
    s.driver.step(0.016, false);
    expect(s.driver.applied.night).toBe(1);
  });
});

describe("a device clock that is 3 hours wrong still shows the server's time of day", () => {
  it("the driver on a villageClock synced to the server shows the server's noon although the phone says it is the middle of the night", () => {
    let device = MIDNIGHT; // the phone's clock: hours wrong
    const clock = createVillageClock(() => device);
    const driver = createDayNightDriver(clock);
    driver.step(0.016, false);
    expect(driver.applied.night).toBe(1); // before the server has spoken: the device's time (a night)
    clock.sync(NOON); // the server's clock says noon
    driver.step(0.016, false);
    expect(driver.applied.night).toBe(0); // the village is at noon: a jump of the clock snaps
    expect(driver.applied.lights).toBe(0);
    expect(driver.applied.exposure).toBe(dayNightAt(NOON).exposure);
    device += 3 * HOUR; // time goes on
    for (let i = 0; i < 400; i++) driver.step(0.05, false);
    expect(driver.target.night).toBeCloseTo(dayNightAt(NOON + 3 * HOUR).night, 9); // the server's 15:30, not the phone's
  });
});

describe("resetOnVisible (Task 7A review m-e)", () => {
  function fakeDocument() {
    const listeners = new Set<() => void>();
    const doc = {
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener: (_: "visibilitychange", l: () => void) => void listeners.add(l),
      removeEventListener: (_: "visibilitychange", l: () => void) => void listeners.delete(l),
    } satisfies VisibilitySource;
    const fire = (state: DocumentVisibilityState) => {
      doc.visibilityState = state;
      for (const l of [...listeners]) l();
    };
    return { doc, fire, listeners };
  }

  it("a tab that comes back after hours snaps to the clock on its next frame instead of gliding from the stale look", () => {
    const { driver, set } = setup(NOON);
    const { doc, fire } = fakeDocument();
    const unbind = resetOnVisible(doc, driver);
    driver.step(1 / 60, false);
    expect(driver.applied.night).toBe(0);
    fire("hidden");
    set(MIDNIGHT); // hours pass with no frames
    fire("visible");
    driver.step(1, false); // the first frame back (the scene clamps it to 1 s)
    expect(driver.applied.night).toBeCloseTo(dayNightAt(MIDNIGHT).night, 9);
    unbind();
  });

  it("hiding does not reset; without the binding the look would still be easing from noon", () => {
    const { driver, set } = setup(NOON);
    driver.step(1 / 60, false);
    set(MIDNIGHT);
    driver.step(1, false);
    expect(driver.applied.night).toBeLessThan(0.5); // the stale glide the reset avoids
    let resets = 0;
    const { doc, fire, listeners } = fakeDocument();
    const unbind = resetOnVisible(doc, { reset: () => resets++ });
    fire("hidden");
    expect(resets).toBe(0);
    fire("visible");
    expect(resets).toBe(1);
    unbind();
    expect(listeners.size).toBe(0);
  });
});
