import { describe, it, expect } from "vitest";
import { reconnectBackoffMs } from "./backoff";

describe("reconnectBackoffMs", () => {
  const schedule = reconnectBackoffMs();

  it("starts by doubling from 1s: 1s, 2s, 4s, 8s", () => {
    expect(schedule.slice(0, 4)).toEqual([1000, 2000, 4000, 8000]);
  });

  it("caps every delay at 8s", () => {
    for (const delay of schedule) expect(delay).toBeLessThanOrEqual(8000);
  });

  it("holds every delay after the 4th at the 8s cap", () => {
    for (const delay of schedule.slice(4)) expect(delay).toBe(8000);
  });

  it("spends a total budget of roughly 30s (28s..32s)", () => {
    const total = schedule.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(28000);
    expect(total).toBeLessThanOrEqual(32000);
  });

  it("is finite (never loops forever)", () => {
    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule.length).toBeLessThan(50);
  });

  it("honors injected base/cap/budget (deterministic, no real clock)", () => {
    // base 100, cap 400, budget 1000 → 100,200,400, then sumBefore(700)<1000 → 400 → sum 1100 stop.
    expect(reconnectBackoffMs({ baseMs: 100, capMs: 400, budgetMs: 1000 })).toEqual([
      100, 200, 400, 400,
    ]);
  });
});
