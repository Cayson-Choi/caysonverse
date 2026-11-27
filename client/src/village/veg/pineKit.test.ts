import { describe, expect, it } from "vitest";
import { PINE_VARIANTS, crownBalance, pineGeo } from "./pineKit";

describe("pineGeo (the temple's red pines)", () => {
  it("is the same tree every load", () => {
    const a = pineGeo(0, 11, { low: false });
    const b = pineGeo(0, 11, { low: false });
    expect(a.tris).toBe(b.tris);
    expect(Array.from(a.needles.getAttribute("position").array.slice(0, 30))).toEqual(Array.from(b.needles.getAttribute("position").array.slice(0, 30)));
  });

  it("keeps each variant within budget, the phone's lighter", () => {
    for (let k = 0; k < PINE_VARIANTS.length; k++) {
      const pc = pineGeo(k, 11 + k * 5, { low: false });
      const ph = pineGeo(k, 11 + k * 5, { low: true });
      expect(pc.tris).toBeLessThan(9000);
      expect(ph.tris).toBeLessThan(pc.tris * 0.75);
      expect(pc.pads).toBeGreaterThan(10);
    }
  });

  it("is bare below its crown, its pads high enough to walk under", () => {
    for (let k = 0; k < PINE_VARIANTS.length; k++) {
      const g = pineGeo(k, 11 + k * 5, { low: false });
      const pos = g.needles.getAttribute("position");
      let minY = Infinity;
      for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i));
      expect(minY).toBeGreaterThan(2.4);
    }
  });

  it("blends the foot's bark in by the vertex alpha: 1 at the ground, 0 up the trunk", () => {
    const g = pineGeo(1, 16, { low: false });
    const pos = g.bark.getAttribute("position");
    const col = g.bark.getAttribute("color");
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 0.3) expect(col.getW(i)).toBeGreaterThan(0.95);
      if (pos.getY(i) > 3.6) expect(col.getW(i)).toBe(0);
    }
  });

  it("grows its crown all round the trunk: every eighth of the compass holds needles, the crown's middle over the foot", () => {
    // owner 2026-11-27: "한쪽으로만 가지가 뻗어있고 ... 전체적으로 골고루 있어야지" (the old crowns: 0.01-0.08 of the mean in the
    // emptiest sector, their middle 1.5-1.9 m off the foot)
    for (let k = 0; k < PINE_VARIANTS.length; k++) {
      for (const seed of [11, 16, 25, 40]) {
        for (const low of [false, true]) {
          const g = pineGeo(k, seed, { low });
          const b = crownBalance(g.needles, 8);
          expect(b.min, `variant ${k} seed ${seed} sectors ${b.sectors.map((v) => v.toFixed(2)).join(" ")}`).toBeGreaterThan(0.4);
          expect(Math.max(...b.sectors)).toBeLessThan(2);
          expect(b.offset, `variant ${k} seed ${seed}`).toBeLessThan(0.05 * g.R);
          // four quarters: none under 0.55 of the mean
          expect(Math.min(...crownBalance(g.needles, 4).sectors)).toBeGreaterThan(0.55);
        }
      }
    }
  });

  it("leans its trunk toward +x but the crown takes it back: the trunk's middle is off the foot, the crown's is not", () => {
    for (let k = 0; k < PINE_VARIANTS.length; k++) {
      const g = pineGeo(k, 11 + k * 5, { low: false });
      const pos = g.bark.getAttribute("position");
      // the trunk at mid-height (the thick wood there: limbs leave higher up)
      let sx = 0;
      let n = 0;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y > g.H * 0.25 && y < g.H * 0.35 && Math.hypot(pos.getX(i), pos.getZ(i)) < 1.2) (sx += pos.getX(i)), n++;
      }
      if (PINE_VARIANTS[k]!.lean >= 0.2) expect(sx / n).toBeGreaterThan(0.15);
      expect(crownBalance(g.needles).offset).toBeLessThan(0.1 * g.R);
    }
  });

  it("shortens only the limbs that would reach into something blocked, the rest of the crown stays full", () => {
    // a wall of roof on the tree's -z side from 2 m out, up to 7 m; the generator is told it with a 0.3 m clearance (as the
    // temple's roofs are: templePines ROOF_CLEAR), no needle may be in the wall itself
    const blocked = ([, y, z]: [number, number, number]) => z < -2 && y < 7;
    const near = ([, y, z]: [number, number, number]) => z < -1.7 && y < 7.3;
    for (let k = 0; k < PINE_VARIANTS.length; k++) {
      const g = pineGeo(k, 11 + k * 5, { low: false, blocked: near });
      const pos = g.needles.getAttribute("position");
      let inside = 0;
      for (let i = 0; i < pos.count; i++) if (blocked([pos.getX(i), pos.getY(i), pos.getZ(i)])) inside++;
      expect(inside).toBe(0);
      const b = crownBalance(g.needles, 4);
      // the blocked side keeps needles too (its limbs shortened, not removed)
      expect(b.min).toBeGreaterThan(0.3);
      expect(b.offset).toBeLessThan(0.2 * g.R);
    }
  });
});
