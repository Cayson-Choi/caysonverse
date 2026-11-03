import { describe, expect, it, vi } from "vitest";
import { CLOSE_GRACE_MS, FADE_IN_MS, FADE_OUT_MS, FAIL_SAFE_MS, createDoorFade, type FadeClock } from "./doorFadeModel";

/** A clock the test winds by hand: timers fire in order when the time reaches them. */
function manualClock(): FadeClock & { advance(ms: number): void } {
  let t = 1000;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer(fn, ms) {
      const h = ++next;
      timers.set(h, { at: t + ms, fn });
      return h;
    },
    clearTimer(h) {
      timers.delete(h as number);
    },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = Math.max(t, due[1].at);
        due[1].fn();
      }
      t = end;
    },
  };
}

const sends = () => vi.fn(() => true);

describe("doorFade — the curtain over a door", () => {
  it("is 0.4 s plus the round trip: 0.2 s to close, then the request, then 0.2 s to open", () => {
    expect(FADE_IN_MS + FADE_OUT_MS).toBe(400);
  });

  it("covers at once on a press, but asks the server only once the curtain says it has closed (the cut is never seen)", () => {
    const clock = manualClock();
    const fade = createDoorFade(clock);
    const send = sends();
    expect(fade.covered()).toBe(false);
    fade.begin(send);
    expect(fade.covered()).toBe(true);
    clock.advance(FADE_IN_MS + 30); // a slow frame: the transition is not over yet
    expect(send).not.toHaveBeenCalled();
    fade.closed(); // the transition ended
    expect(send).toHaveBeenCalledTimes(1);
    expect(fade.covered()).toBe(true); // still covered: waiting for the server
    fade.closed(); // a second report asks nothing more
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("if the curtain never reports (no transition event), the request goes out a short grace after it should have closed", () => {
    const clock = manualClock();
    const fade = createDoorFade(clock);
    const send = sends();
    fade.begin(send);
    clock.advance(FADE_IN_MS + CLOSE_GRACE_MS - 1);
    expect(send).not.toHaveBeenCalled();
    clock.advance(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("uncovers on arrival, at once (the cover finished closing before the request went out)", () => {
    const clock = manualClock();
    const fade = createDoorFade(clock);
    fade.begin(sends());
    clock.advance(FADE_IN_MS);
    fade.closed(); // the request went out, the server answers 80 ms later
    clock.advance(80);
    expect(fade.covered()).toBe(true);
    fade.arrived();
    clock.advance(0);
    expect(fade.covered()).toBe(false);
  });

  it("if there is nothing to ask any more (walked out of reach while it closed) it opens at once, and asks nothing", () => {
    const clock = manualClock();
    const fade = createDoorFade(clock);
    const send = vi.fn(() => false);
    fade.begin(send);
    clock.advance(FADE_IN_MS);
    fade.closed();
    expect(send).toHaveBeenCalledTimes(1);
    expect(fade.covered()).toBe(false);
    clock.advance(FAIL_SAFE_MS * 2); // no stray fail-safe timer is left running
    expect(fade.covered()).toBe(false);
  });

  it("opens by itself if the server never answers (a dropped press), and not before the fail-safe", () => {
    const clock = manualClock();
    const fade = createDoorFade(clock);
    fade.begin(sends());
    clock.advance(FADE_IN_MS);
    fade.closed(); // the request went out here
    clock.advance(FAIL_SAFE_MS - 1);
    expect(fade.covered()).toBe(true);
    clock.advance(1);
    expect(fade.covered()).toBe(false);
  });

  it("a second press while covered is ignored: one door use at a time", () => {
    const clock = manualClock();
    const fade = createDoorFade(clock);
    const first = sends();
    const second = sends();
    let changes = 0;
    fade.subscribe(() => changes++);
    fade.begin(first);
    clock.advance(50);
    fade.begin(second);
    clock.advance(FADE_IN_MS);
    fade.closed();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(changes).toBe(1);
  });

  it("an area change nobody asked for (no press) does nothing", () => {
    const clock = manualClock();
    const fade = createDoorFade(clock);
    let changes = 0;
    fade.subscribe(() => changes++);
    fade.arrived();
    clock.advance(5000);
    expect(fade.covered()).toBe(false);
    expect(changes).toBe(0);
  });

  it("reset uncovers and drops the timers (the request is never sent); a later press starts fresh", () => {
    const clock = manualClock();
    const fade = createDoorFade(clock);
    const send = sends();
    fade.begin(send);
    fade.reset();
    expect(fade.covered()).toBe(false);
    clock.advance(FAIL_SAFE_MS * 2);
    expect(send).not.toHaveBeenCalled();
    expect(fade.covered()).toBe(false);
    fade.begin(sends());
    expect(fade.covered()).toBe(true);
  });

  it("notifies once per change and stops after unsubscribe", () => {
    const clock = manualClock();
    const fade = createDoorFade(clock);
    const seen: boolean[] = [];
    const off = fade.subscribe(() => seen.push(fade.covered()));
    fade.begin(sends());
    clock.advance(FADE_IN_MS);
    fade.closed();
    fade.arrived();
    clock.advance(0);
    expect(seen).toEqual([true, false]);
    off();
    fade.begin(sends());
    expect(seen).toEqual([true, false]);
  });
});
