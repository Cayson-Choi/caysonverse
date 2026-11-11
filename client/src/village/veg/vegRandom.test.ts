import { describe, expect, it } from "vitest";
import { PyRandom, hash3, mulberry32, valueNoise3 } from "./vegRandom";

describe("PyRandom (Python's random.Random, MT19937)", () => {
  it("replays random.Random(100).random() bit for bit", () => {
    // python -c "import random; r=random.Random(100); print([r.random() for _ in range(5)])"
    const r = new PyRandom(100);
    const want = [0.1456692551041303, 0.45492700451402135, 0.7707838056590222, 0.705513226934028, 0.7319589730332557];
    for (const w of want) expect(r.random()).toBe(w);
  });

  it("replays uniform and randrange (Random(105))", () => {
    // python: r=random.Random(105); [r.uniform(-0.3,0.3) for _ in range(3)] + [r.randrange(3), r.randrange(4), r.randrange(1<<30)]
    const r = new PyRandom(105);
    expect(r.uniform(-0.3, 0.3)).toBeCloseTo(0.2268596094458955, 15);
    expect(r.uniform(-0.3, 0.3)).toBeCloseTo(-0.0905288118985777, 15);
    expect(r.uniform(-0.3, 0.3)).toBeCloseTo(0.17443419594359838, 15);
    expect(r.randrange(3)).toBe(0);
    expect(r.randrange(4)).toBe(2);
    expect(r.randrange(1 << 30)).toBe(718759978);
  });
});

describe("mulberry32 / hash / noise", () => {
  it("is deterministic and in [0, 1)", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("hashes integers to well-spread 32-bit values", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) for (let j = 0; j < 50; j++) seen.add(hash3(i, j, 3));
    expect(seen.size).toBe(2500);
  });

  it("value noise is continuous and in [0, 1]", () => {
    let prev = valueNoise3(0, 0.5, 0.25);
    for (let i = 1; i <= 200; i++) {
      const v = valueNoise3(i * 0.01, 0.5, 0.25);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.05);
      prev = v;
    }
  });
});
