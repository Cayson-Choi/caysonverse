import { describe, expect, it } from "vitest";
import { createFrameSampler, summarizeIntervals } from "./frameStats";

describe("summarizeIntervals", () => {
  it("is all zeros with no intervals", () => {
    expect(summarizeIntervals([], 20000)).toEqual({ frames: 0, meanMs: 0, p95Ms: 0, maxMs: 0, windowMs: 20000 });
  });

  it("reports mean, p95 (s[floor(n*0.95)]) and max", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100 ms
    const s = summarizeIntervals(v, 5000);
    expect(s.frames).toBe(100);
    expect(s.meanMs).toBeCloseTo(50.5, 6);
    expect(s.p95Ms).toBe(96);
    expect(s.maxMs).toBe(100);
    expect(s.windowMs).toBe(5000);
  });
});

describe("createFrameSampler", () => {
  it("measures the gaps between recorded timestamps", () => {
    const f = createFrameSampler(16);
    for (let t = 0; t <= 160; t += 16) f.sample(t);
    const s = f.stats(1000, 160);
    expect(s.frames).toBe(10);
    expect(s.meanMs).toBeCloseTo(16, 6);
    expect(s.maxMs).toBe(16);
  });

  it("only counts intervals that ended inside the window", () => {
    const f = createFrameSampler(64);
    for (let t = 0; t < 1000; t += 10) f.sample(t); // 10 ms frames
    for (let t = 1000; t <= 1300; t += 50) f.sample(t); // then 50 ms frames
    const s = f.stats(249, 1300); // intervals that ended at 1100 … 1300 (the window edge is inclusive: 250 would take 1050 too)
    expect(s.meanMs).toBeCloseTo(50, 6);
    expect(s.frames).toBe(5);
  });

  it("keeps working after the ring wraps (the oldest stamps are overwritten)", () => {
    const f = createFrameSampler(8);
    for (let t = 0; t < 200; t += 20) f.sample(t); // 10 stamps into 8 slots
    const s = f.stats(10_000, 180);
    expect(s.frames).toBe(7);
    expect(s.meanMs).toBeCloseTo(20, 6);
  });

  it("is empty with fewer than two stamps", () => {
    const f = createFrameSampler(8);
    expect(f.stats(1000, 0).frames).toBe(0);
    f.sample(5);
    expect(f.stats(1000, 5).frames).toBe(0);
  });
});
