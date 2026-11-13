import { describe, expect, it } from "vitest";
import { buildingSpace, crownKeepOut, BUILDING_BOX } from "./crownSpace";
import { growCherry, outdoorCherrySkeletons, crownEnvelope } from "./cherryTree";
import type { Envelope } from "./crownGrowth";

const env = (x: number, z: number, r = 3): Envelope => ({ c: [x, 5, z], rx: r, up: 2.5, down: 1.5 });

describe("crownKeepOut", () => {
  it("leaves a crown that meets nothing as it was", () => {
    const a = env(0, 0);
    expect(crownKeepOut(a, [a, env(20, 0)], [buildingSpace("col__house_1", [10, 0, -4], [18, 8.5, 4])])).toBeUndefined();
  });

  it("splits the air between two crowns that meet, with a gap between", () => {
    const a = env(0, 0);
    const b = env(4, 0);
    const ka = crownKeepOut(a, [a, b], [])!;
    const kb = crownKeepOut(b, [a, b], [])!;
    expect(ka).toBeDefined();
    // each keeps its own side and gives up the other's
    expect(ka([-1, 5, 0])).toBe(false);
    expect(ka([3, 5, 0])).toBe(true);
    expect(kb([3, 5, 0])).toBe(false);
    expect(kb([1, 5, 0])).toBe(true);
    // the middle belongs to neither (the gap)
    expect(ka([2, 5, 0])).toBe(true);
    expect(kb([2, 5, 0])).toBe(true);
  });

  it("keeps a crown out of a house beside it (its box and a margin)", () => {
    const a = env(0, 0);
    const k = crownKeepOut(a, [a], [buildingSpace("col__house_4", [2, 0, -4], [10, 8.5, 4])])!;
    expect(k([2.5, 5, 0])).toBe(true);
    expect(k([1.8, 5, 0])).toBe(true); // the margin
    expect(k([1.4, 5, 0])).toBe(false);
  });

  it("knows the buildings and the pavilion's roof", () => {
    expect(BUILDING_BOX.test("col__house_10")).toBe(true);
    expect(BUILDING_BOX.test("col__pavilion")).toBe(true);
    expect(BUILDING_BOX.test("col__bush_3")).toBe(false);
    expect(buildingSpace("col__pavilion", [0, 0, 0], [5, 1.2, 5]).max[1]).toBeGreaterThan(4);
  });

  it("a cherry grown with a keep-out has no twig or bunch in it, and one without is unchanged", () => {
    const sk = outdoorCherrySkeletons()[0]!;
    const plain = growCherry(sk);
    expect(growCherry(sk, { attractors: 540, bunchStep: 0.08, keepOut: undefined }).bunches.length).toBe(plain.bunches.length);
    const e = crownEnvelope(sk);
    // a wall through the crown's centre: everything east of it is kept out
    const wallX = e.c[0];
    const cut = growCherry(sk, { attractors: 540, bunchStep: 0.08, keepOut: (p) => p[0] > wallX });
    expect(cut.bunches.length).toBeGreaterThan(200);
    expect(cut.bunches.every((b) => b.x <= wallX)).toBe(true);
    // the twigs stay on their side too (a twig may start on a limb across it, but it does not reach into it)
    const tips = cut.twigs.map((t) => t.pts[t.pts.length - 1]!);
    expect(tips.filter((p) => p[0] > wallX + 0.6).length).toBe(0);
  });
});
