import { describe, expect, it } from "vitest";
import { createVegDressing, FAIL_SAFE_MS } from "./vegDressing";

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

  it("uncovers by itself when a build never ends, or never begins", () => {
    const t = fakeTimers();
    const d = createVegDressing(t);
    d.begin();
    t.advance(FAIL_SAFE_MS - 1);
    expect(d.dressed()).toBe(false);
    t.advance(1);
    expect(d.dressed()).toBe(true);

    const e = createVegDressing(t);
    e.expect();
    t.advance(FAIL_SAFE_MS);
    expect(e.dressed()).toBe(true);
  });

  it("a finished build disarms the fail-safe, and reset covers", () => {
    const t = fakeTimers();
    const d = createVegDressing(t);
    d.done(d.begin());
    d.reset();
    t.advance(FAIL_SAFE_MS * 2);
    expect(d.dressed()).toBe(false);
  });
});
