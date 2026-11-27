import { describe, expect, it } from "vitest";
import { PINE_VARIANTS, pineGeo } from "./pineKit";

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

  it("leans toward +x: the crown's middle is off the foot on that side", () => {
    for (let k = 0; k < PINE_VARIANTS.length; k++) {
      const pos = pineGeo(k, 11 + k * 5, { low: false }).needles.getAttribute("position");
      let sx = 0;
      for (let i = 0; i < pos.count; i++) sx += pos.getX(i);
      expect(sx / pos.count).toBeGreaterThan(0.2);
    }
  });
});
