import { describe, expect, it } from "vitest";
import { growGreen, PLAZA_ZELKOVA } from "./greenTree";

describe("green broadleaf crown", () => {
  it("keeps the zelkova at the existing deck position and scale", () => {
    const c = growGreen();
    expect(c.spec).toEqual(PLAZA_ZELKOVA);
    expect(c.bounds.x).toBe(-25);
    expect(c.bounds.z).toBe(5);
    expect(c.bounds.r).toBeGreaterThan(8.5);
  });

  it("grows a branch skeleton and hundreds of separate leaf clusters", () => {
    const c = growGreen();
    expect(c.twigs.length).toBeGreaterThanOrEqual(21);
    expect(c.clusters.length).toBeGreaterThan(180);
    expect(c.clusters.length).toBeLessThan(321);
  });

  it("is deterministic and leaves gaps in the crown", () => {
    const a = growGreen();
    const b = growGreen();
    expect(b).toEqual(a);
    const heights = a.clusters.map((x) => x.y);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(2);
  });
});
