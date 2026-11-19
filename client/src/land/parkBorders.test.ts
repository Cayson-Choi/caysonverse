import { PARK_LAMPS, PARK_PLAZA } from "@caysonverse/shared/village/parkArea";
import { describe, expect, it } from "vitest";
import { parkBorders, parkFlowerCrowns } from "./parkBorders";
import { placeFlowers } from "../village/veg/flowerPlacement";
import { buildSoil } from "../village/veg/vegSoil";
import { flowerMassGeometry } from "../village/houses/houseFlowerMass";

describe("the planted borders beside the station and plaza", () => {
  it.each([[3, 1.4], [1.4, 3]])("keeps visible ivory and rose petal trusses within a %s by %s trough", (w, d) => {
    const box = { kind: "box", plant: "pot", x0: 0, x1: w, z0: 0, z1: d, y: 0.84 } as const;
    const crowns = parkFlowerCrowns([box]);
    expect(crowns.length).toBe(3);
    const { geometry, stats } = flowerMassGeometry(crowns, "park");
    const pos = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
    let petals = 0;
    for (let i = 0; i < pos.count; i++) {
      if (uv.getX(i) !== 0.5 || uv.getY(i) !== 0.5) continue;
      expect(pos.getY(i)).toBeGreaterThan(box.y + 0.12);
      expect(pos.getX(i)).toBeGreaterThan(0);
      expect(pos.getX(i)).toBeLessThan(w);
      expect(pos.getZ(i)).toBeGreaterThan(0);
      expect(pos.getZ(i)).toBeLessThan(d);
      petals++;
    }
    expect(petals).toBeGreaterThan(300);
    expect(stats.triangles).toBeLessThan(1000);
    geometry.dispose();
  });

  it("grows flowers on the built island surface and still generates soil for ordinary pots", () => {
    const island = parkBorders().flowers[0]!;
    const pot = { ...island, x0: island.x0 + 20, x1: island.x1 + 20, soilProvided: false };
    const beds = [island, pot];
    const cards = beds.map((b, id) => {
      const x = (b.x0 + b.x1) / 2, z = (b.z0 + b.z1) / 2;
      return { id, x, y: b.y + 0.15, z, ax: x - 0.2, az: z, bx: x + 0.2, bz: z, floor: b.y, h: 0.3, u: 0.5, v: 0.12, light: 1, tris: [] };
    });
    const { plants } = placeFlowers(cards, beds);
    const onIsland = plants.filter(p => p.soilProvided);
    const inPot = plants.filter(p => !p.soilProvided);
    expect(onIsland.length).toBeGreaterThan(0);
    expect(inPot.length).toBeGreaterThan(0);
    const soil = buildSoil(plants);
    expect(soil.beds).toBe(1);
    expect(onIsland.every(p => p.y === island.y && soil.heightAt(p) === null)).toBe(true);
    expect(inPot.every(p => soil.heightAt(p) !== null)).toBe(true);
    soil.soil.forEach(area => area.geo.dispose());
    soil.coping?.dispose();
  });

  it("keeps both paths and the lamp bases clear along the entire stone edge", () => {
    const edge = parkBorders().edging.getAttribute("position");
    let clear = true;
    for (let i = 0; i < edge.count; i++) {
      const x = edge.getX(i), z = edge.getZ(i);
      const onApproach = x >= -4 && x <= 8 && z >= -106 && z <= -19;
      const onAvenue = x >= -23 && x <= 345 && z >= -118 && z <= -106;
      const onPlaza = Math.hypot(x - PARK_PLAZA.x, z - PARK_PLAZA.z) <= PARK_PLAZA.radius;
      const onLamp = PARK_LAMPS.some(lamp => Math.hypot(x - lamp.x, z - lamp.z) < 0.4);
      if (onApproach || onAvenue || onPlaza || onLamp) clear = false;
    }
    expect(clear).toBe(true);
  });
});
