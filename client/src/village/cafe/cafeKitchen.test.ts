import { describe, expect, it } from "vitest";
import { KITCHEN, KITCHEN_LAMPS, buildKitchen } from "./cafeKitchen";

describe("the café kitchen behind the back windows", () => {
  const geo = buildKitchen().build((p) => p, (n) => n);
  const pos = geo.getAttribute("position");

  it("stays inside the kitchen's room (the café's walls and the partition)", () => {
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getX(i)).toBeGreaterThanOrEqual(KITCHEN.x0 - 1e-6);
      expect(pos.getX(i)).toBeLessThanOrEqual(KITCHEN.x1 + 1e-6);
      expect(pos.getZ(i)).toBeGreaterThanOrEqual(KITCHEN.zb - 1e-6);
      expect(pos.getZ(i)).toBeLessThanOrEqual(KITCHEN.zp + 1e-6);
      expect(pos.getY(i)).toBeGreaterThanOrEqual(-1e-6);
      expect(pos.getY(i)).toBeLessThanOrEqual(KITCHEN.h + 1e-6);
    }
  });

  it("is light: one geometry under 6 k triangles, with a tile, a day and a night light per vertex", () => {
    expect(geo.index!.count / 3).toBeLessThan(6000);
    expect(geo.getAttribute("aTile").count).toBe(pos.count);
    expect(geo.getAttribute("aDay").count).toBe(pos.count);
    expect(geo.getAttribute("aNight").count).toBe(pos.count);
  });

  it("lights the room by day from the windows and by night under the pendants", () => {
    const day = geo.getAttribute("aDay");
    const night = geo.getAttribute("aNight");
    // by day: a vertex by the windows is brighter than one at the partition; by night, one under a lamp brighter than a corner's
    let nearWin = 0, farWin = 0, underLamp = 0, corner = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i), y = pos.getY(i), x = pos.getX(i);
      if (y > 0.02) continue; // the floor only
      if (z < KITCHEN.zb + 0.5) nearWin = Math.max(nearWin, day.getX(i));
      if (z > KITCHEN.zp - 0.1) farWin = Math.max(farWin, day.getX(i));
      const [lx, , lz] = KITCHEN_LAMPS[1]!;
      if (Math.hypot(x - lx, z - lz) < 1.5) underLamp = Math.max(underLamp, night.getX(i));
      if (Math.abs(x) > 6.5) corner = Math.min(corner, night.getX(i));
    }
    expect(nearWin).toBeGreaterThan(farWin);
    expect(underLamp).toBeGreaterThan(corner);
  });
});
