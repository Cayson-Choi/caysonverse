import { describe, expect, it } from "vitest";
import { GATE_OPEN_MS, gateTimeline } from "./gateTimeline";

/** Sample the timeline every `step` ms from `from` to `to` (inclusive of both ends). */
function samples(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let t = from; t < to; t += step) out.push(t);
  out.push(to);
  return out;
}

describe("gateTimeline (Task 15 — the east gate opening)", () => {
  it("gateTimeline: closed at 0, fully open at GATE_OPEN_MS, monotonic bars", () => {
    expect(gateTimeline(0).bars).toBe(1);
    expect(gateTimeline(GATE_OPEN_MS).bars).toBe(0);
    // Monotonic over the WHOLE timeline (before the start, every 5 ms through it, after the
    // end): the bars never come back down once they started going up, and stay in [0, 1].
    let prev = Infinity;
    for (const t of samples(-200, GATE_OPEN_MS + 500, 5)) {
      const { bars } = gateTimeline(t);
      expect(bars).toBeGreaterThanOrEqual(0);
      expect(bars).toBeLessThanOrEqual(1);
      expect(bars).toBeLessThanOrEqual(prev);
      prev = bars;
    }
    // Strictly moving somewhere in the middle (not a jump at the end).
    expect(gateTimeline(GATE_OPEN_MS / 2).bars).toBeGreaterThan(0);
    expect(gateTimeline(GATE_OPEN_MS / 2).bars).toBeLessThan(1);
  });

  it("before the start the gate is shut and dark; after the end it is open and settled", () => {
    expect(gateTimeline(-1000)).toEqual({ bars: 1, sweep: 0, glow: 0 });
    const end = gateTimeline(GATE_OPEN_MS);
    expect(gateTimeline(GATE_OPEN_MS + 60_000)).toEqual(end);
    expect(end.sweep).toBe(1);
  });

  it("the light sweep runs 0 → 1 without going back; the glow stays in [0, 1] and peaks mid-way", () => {
    let prev = -Infinity;
    let peak = 0;
    for (const t of samples(0, GATE_OPEN_MS, 5)) {
      const { sweep, glow } = gateTimeline(t);
      expect(sweep).toBeGreaterThanOrEqual(prev);
      expect(sweep).toBeGreaterThanOrEqual(0);
      expect(sweep).toBeLessThanOrEqual(1);
      expect(glow).toBeGreaterThanOrEqual(0);
      expect(glow).toBeLessThanOrEqual(1);
      prev = sweep;
      peak = Math.max(peak, glow);
    }
    expect(gateTimeline(0).sweep).toBe(0);
    expect(peak).toBe(1);
    expect(gateTimeline(GATE_OPEN_MS).glow).toBeLessThan(peak); // settles after the flash
    expect(gateTimeline(GATE_OPEN_MS).glow).toBeGreaterThan(0); // an open gate keeps a soft glow
  });

  it("writes into `out` when given (the per-frame path allocates nothing)", () => {
    const out = { bars: -1, sweep: -1, glow: -1 };
    const got = gateTimeline(GATE_OPEN_MS / 3, out);
    expect(got).toBe(out);
    expect(out).toEqual(gateTimeline(GATE_OPEN_MS / 3));
  });
});
