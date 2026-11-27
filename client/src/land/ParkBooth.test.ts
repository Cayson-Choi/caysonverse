import { describe, expect, it } from "vitest";
import { BOOTH_BACK, buildBooth, type BoothSpec } from "./ParkBooth";

const booth: BoothSpec = {
  x: 55, z: -177, w: 4.2, d: 3.4, kind: "snack", plaster: "#eee", tile: "#a96",
  title: "별빛 간식", sub: "SNACKS", stripes: [[0.3, 0.34, 0.8], [0.97, 0.94, 0.88]],
};

describe("park booth awnings", () => {
  it.each(["snack", "ticket"] as const)("sews the %s booth's hanging hem to the canopy all the way across", (kind) => {
    const built = buildBooth({ ...booth, kind });
    const fabric = built.cloth.getAttribute("position");
    const normals = built.cloth.getAttribute("normal");
    const wall = booth.z + booth.d / 2;
    const nose = wall + 1.14;
    const upperEdge = new Set<number>();
    const hemEdge = new Set<number>();
    let wallHeight = 0;
    let railHeight = 0;
    let lowHem = Infinity;
    for (let i = 0; i < fabric.count; i++) {
      const z = fabric.getZ(i);
      const y = fabric.getY(i);
      if (Math.abs(z - wall) < 0.001) wallHeight = Math.max(wallHeight, y);
      if (Math.abs(z - nose) < 0.001 && normals.getY(i) > 0.5) {
        upperEdge.add(fabric.getX(i));
        railHeight = Math.max(railHeight, y);
      }
      if (z >= nose - 0.001 && normals.getZ(i) === 1) {
        lowHem = Math.min(lowHem, y);
        if (Math.abs(y - 2.48) < 0.001) hemEdge.add(fabric.getX(i));
      }
    }
    expect(wallHeight - railHeight).toBeGreaterThan(0.3);
    expect(upperEdge.size).toBeGreaterThan(6);
    for (const x of upperEdge) expect(hemEdge.has(x)).toBe(true);
    expect(railHeight - lowHem).toBeCloseTo(0.18);
    // Both kiosks retain the shared matte draw for awning and confectionery.
    expect(built.cloth.index!.count / 3).toBeLessThan(1600);
  });
});

describe("park booth backs", () => {
  it.each(["snack", "ticket"] as const)("gives the %s booth a door, a window and shutters on its back, within 0.4 m of the wall", (kind) => {
    const spec = { ...booth, kind, w: kind === "ticket" ? 3.4 : 4.2, d: kind === "ticket" ? 3.0 : 3.4 };
    const built = buildBooth(spec);
    const back = spec.z - spec.d / 2;
    let behind = 0;
    for (const g of [built.wood, built.stone, built.goods]) {
      const p = g.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i);
        if (z >= back - 1e-6) continue;
        // nothing past the plinth's step, nothing wider than the booth's eaves
        if (z > back - 0.15 || g === built.stone) {
          expect(z).toBeGreaterThan(back - 0.41);
          expect(Math.abs(p.getX(i) - spec.x)).toBeLessThan(spec.w / 2 + 0.6);
        }
        behind++;
      }
    }
    // the door's boards, ledges and braces, the window's frame and shutters: a few hundred corners behind the wall
    expect(behind).toBeGreaterThan(300);
    // the door is a person's height and stands on the plinth's cap
    expect(BOOTH_BACK.doorTop - 0.37).toBeGreaterThan(1.95);
  });
});
