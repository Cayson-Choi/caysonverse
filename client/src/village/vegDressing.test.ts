import { describe, expect, it } from "vitest";
import { createVegDressing, FAIL_SAFE_MS, HARD_CAP_MS } from "./vegDressing";

function fakeTimers() {
  let now = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  return {
    set: (fn: () => void, ms: number) => {
      pending.set(++id, { at: now + ms, fn });
      return id;
    },
    clear: (h: unknown) => void pending.delete(h as number),
    now: () => now,
    advance(ms: number) {
      now += ms;
      for (const [k, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(k);
          t.fn();
        }
      }
    },
  };
}

describe("vegDressing", () => {
  it("starts covered and uncovers when the newest build is done", () => {
    const d = createVegDressing(fakeTimers());
    expect(d.dressed()).toBe(false);
    const first = d.begin();
    const second = d.begin(); // StrictMode's replay, a tier change
    d.done(first);
    expect(d.dressed()).toBe(false);
    d.done(second);
    expect(d.dressed()).toBe(true);
  });

  it("covers again when a new build begins", () => {
    const d = createVegDressing(fakeTimers());
    d.done(d.begin());
    let calls = 0;
    d.subscribe(() => calls++);
    d.begin();
    expect(d.dressed()).toBe(false);
    expect(calls).toBe(1);
  });

  it("uncovers by itself when a build never ends", () => {
    const t = fakeTimers();
    const d = createVegDressing(t);
    d.begin();
    t.advance(FAIL_SAFE_MS - 1);
    expect(d.dressed()).toBe(false);
    t.advance(1);
    expect(d.dressed()).toBe(true);
  });

  it("never lifts by itself while the model is still loading (no build yet): no open-empty-shut flicker", () => {
    const t = fakeTimers();
    const d = createVegDressing(t);
    t.advance(FAIL_SAFE_MS * 3); // a slow line: the model takes 36 s
    expect(d.dressed()).toBe(false);
    let calls = 0;
    d.subscribe(() => calls++);
    const b = d.begin(); // the model is in: the build starts, still covered (no change)
    expect(calls).toBe(0);
    d.done(b);
    expect(d.dressed()).toBe(true);
    expect(calls).toBe(1);
  });

  it("cover: gone indoors before dressed, covered and the fail-safe off", () => {
    const t = fakeTimers();
    const d = createVegDressing(t);
    d.begin();
    d.cover();
    t.advance(FAIL_SAFE_MS * 2);
    expect(d.dressed()).toBe(false);
  });

  it("a finished build disarms the fail-safe, and reset covers", () => {
    const t = fakeTimers();
    const d = createVegDressing(t);
    d.done(d.begin());
    d.reset();
    t.advance(FAIL_SAFE_MS * 2);
    expect(d.dressed()).toBe(false);
  });

  it("uncover: dressed at once (the kept vegetation, a failed model); an older build's end changes nothing", () => {
    const t = fakeTimers();
    const d = createVegDressing(t);
    const building = d.begin();
    d.uncover();
    expect(d.dressed()).toBe(true);
    d.done(building);
    expect(d.dressed()).toBe(true);
    t.advance(FAIL_SAFE_MS * 2);
    expect(d.dressed()).toBe(true);
    // a new build covers again
    d.begin();
    expect(d.dressed()).toBe(false);
  });

  it("a build that keeps growing stays covered past the fail-safe, up to the hard cap", () => {
    const t = fakeTimers();
    const d = createVegDressing(t);
    const b = d.begin();
    for (let i = 0; i < 4; i++) {
      t.advance(FAIL_SAFE_MS - 1000);
      d.progress(b);
    }
    expect(d.dressed()).toBe(false); // 44 s of steady growth: still covered
    d.progress(b);
    t.advance(HARD_CAP_MS); // never past the cap
    expect(d.dressed()).toBe(true);
  });

  it("a stalled build still uncovers after the fail-safe; an old build's progress does nothing", () => {
    const t = fakeTimers();
    const d = createVegDressing(t);
    const old = d.begin();
    const b = d.begin();
    t.advance(FAIL_SAFE_MS - 1000);
    d.progress(old);
    t.advance(1000);
    expect(d.dressed()).toBe(true);
    void b;
  });
});
