import { describe, expect, it } from "vitest";
import { HOUSE_FLOWER_LOD, HOUSE_FLOWER_MASS, VEG_TIERS } from "../veg/vegLod";
import { houseFlowerBoxBeds } from "./houseFlowerBoxes";
import { flowerMassGeometry } from "./houseFlowerMass";

const boxes = () => houseFlowerBoxBeds().filter((b): b is Extract<typeof b, { kind: "box" }> => b.kind === "box");

describe("the houses' flower masses (street view of the window boxes)", () => {
  it("is one cheap mesh for every box, basket, pot and border", () => {
    const { geometry, stats } = flowerMassGeometry(boxes());
    expect(stats.beds).toBe(boxes().length);
    expect(stats.triangles).toBeGreaterThan(stats.beds * 20);
    // the scene budget (contract 13.2): the masses are drawn for every house, all the time
    expect(stats.triangles).toBeLessThanOrEqual(5_500);
    expect(geometry.getAttribute("aSoil").count).toBe(geometry.getAttribute("position").count);
  });

  it("stands on its soil and drapes over a window box's outer rim", () => {
    const one = boxes().find((b) => b.plant === "window" && b.out)!;
    const { geometry } = flowerMassGeometry([one]);
    const p = geometry.getAttribute("position");
    const s = geometry.getAttribute("aSoil");
    let top = -Infinity;
    let bottom = Infinity;
    for (let i = 0; i < p.count; i++) {
      top = Math.max(top, p.getY(i));
      bottom = Math.min(bottom, p.getY(i));
      // collapsed, every vertex lies on the soil (hidden by the plants up close)
      expect(s.getY(i)).toBeCloseTo(one.y, 6);
    }
    expect(top).toBeGreaterThan(one.y + 0.15); // a mound
    expect(bottom).toBeLessThan(one.y - 0.1); // the drape hangs over the rim
  });

  it.each([[3, 1.6], [1.6, 3]])("faces the sky across a %s by %s park trough", (w, d) => {
    const { geometry } = flowerMassGeometry([{ kind: "box", x0: -w / 2, x1: w / 2, z0: -d / 2, z1: d / 2, y: 0.84, out: null, plant: "pot" }]);
    const pos = geometry.getAttribute("position");
    const norm = geometry.getAttribute("normal");
    let tested = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 1.02) continue;
      expect(norm.getY(i)).toBeGreaterThan(0);
      tested++;
    }
    expect(tested).toBeGreaterThan(10);
    geometry.dispose();
  });

  it("keeps the houses' flowers fuller than the village's and grows the mass in where the plants simplify", () => {
    for (const t of ["high", "low"] as const) {
      expect(HOUSE_FLOWER_LOD[t].far[1]).toBeGreaterThan(VEG_TIERS[t].flowers.far[1]);
      expect(HOUSE_FLOWER_LOD[t].thin).toBeGreaterThan(VEG_TIERS[t].flowers.thin);
      expect(HOUSE_FLOWER_MASS[t].full).toBeLessThanOrEqual(HOUSE_FLOWER_LOD[t].far[0]);
    }
    expect(HOUSE_FLOWER_MASS.low.full).toBe(8); // phone: the mass from about 8 m
  });
});
