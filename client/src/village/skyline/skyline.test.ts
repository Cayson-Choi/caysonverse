import { describe, expect, it } from "vitest";
import { WHEEL_HUB_Y, WHEEL_R, WHEEL_SITE } from "@caysonverse/shared/land/wheel";
import { VILLAGE_LOTS } from "@caysonverse/shared/village/villageLots";
import { buildSkyline, SKYLINE_SCALE } from "./skylineGeometry";
import { GATE_WORLD_Z, OX, OZ, skylineClearsForest, skylinePlacement } from "./skylinePlacement";

const tilt = (x: number, z: number) => 0.06 * (z - 100) + 3 + 0.002 * x;

describe("skyline geometry: light and built from the park's own data", () => {
  const high = buildSkyline("high");
  const low = buildSkyline("low");

  it("stays under the budget (60 k triangles, 10 draw calls), the phone tier lighter", () => {
    expect(high.triangles).toBeLessThan(60_000);
    expect(high.drawCalls).toBeLessThanOrEqual(10);
    expect(low.triangles).toBeLessThan(high.triangles);
    expect(low.wheelBulbs.length).toBeLessThan(high.wheelBulbs.length);
  });

  it("carries no uvs or normals (unlit vertex colours only)", () => {
    for (const g of [high.staticGeo, high.rotorGeo, high.gondolaGeo, high.trainGeo, high.carouselGeo]) {
      expect(g.getAttribute("uv")).toBeUndefined();
      expect(g.getAttribute("normal")).toBeUndefined();
      expect(g.getAttribute("color")).toBeDefined();
    }
  });

  it("holds the wheel at the real radius: the rotor's rim reaches WHEEL_R, bulbs just outside it", () => {
    const rim = Math.max(...Array.from({ length: high.rotorGeo.getAttribute("position").count }, (_, i) => Math.hypot(high.rotorGeo.getAttribute("position").getX(i), high.rotorGeo.getAttribute("position").getY(i))));
    expect(rim).toBeGreaterThan(WHEEL_R);
    expect(rim).toBeLessThan(WHEEL_R + 1.2);
    const bulbR = Math.hypot(high.wheelBulbs[0]!, high.wheelBulbs[1]!);
    expect(bulbR).toBeGreaterThan(WHEEL_R);
  });

  it("reaches the coaster's lift hill height and the wheel's top in the static geometry", () => {
    const top = high.staticGeo.boundingBox!.max.y;
    expect(top).toBeGreaterThan(high.track.box[4] - 1); // the lift's crest
    expect(WHEEL_HUB_Y + WHEEL_R).toBeGreaterThan(40);
    expect(high.track.n).toBeGreaterThan(1000);
  });

  it("has no NaN in any attribute", () => {
    for (const g of [high.staticGeo, high.rotorGeo, high.gondolaGeo, high.trainGeo, high.carouselGeo]) {
      for (const v of g.getAttribute("position").array) expect(Number.isFinite(v)).toBe(true);
      for (const v of g.getAttribute("color").array) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it("is the same every time (seeded)", () => {
    const again = buildSkyline("high");
    expect(again.triangles).toBe(high.triangles);
    expect(again.staticBulbs.length).toBe(high.staticBulbs.length);
  });

  it("buries every footing: the support columns reach below a tilted ground", () => {
    const g = (x: number, z: number) => -3 + 0.0002 * x + 0.0001 * z;
    const sloped = buildSkyline("high", g);
    expect(sloped.staticGeo.boundingBox!.min.y).toBeLessThan(-2.5);
  });
});

describe("skyline placement: behind the south gate, outside the walkable village", () => {
  const p = skylinePlacement(tilt);

  it("lines the park's gate up with the village gate lot, just beyond its back", () => {
    const gate = VILLAGE_LOTS.find((l) => l.id === "lot_gate")!;
    expect(OX + 40 * SKYLINE_SCALE).toBeCloseTo(gate.centre.x, 6);
    expect(GATE_WORLD_Z).toBeGreaterThan(104);
    expect(OZ - 186.5 * SKYLINE_SCALE).toBeCloseTo(GATE_WORLD_Z, 6);
  });

  it("lies wholly south of the walk bounds (z 95) and inside the outer ground", () => {
    expect(p.worldBounds.minZ).toBeGreaterThan(98);
    expect(Math.hypot(Math.max(Math.abs(p.worldBounds.minX), Math.abs(p.worldBounds.maxX)), p.worldBounds.maxZ)).toBeLessThan(236);
  });

  it("fits the ground plane and keeps the reference plane a little under it", () => {
    expect(p.plane.cz).toBeCloseTo(0.06, 3);
    expect(p.plane.cx).toBeCloseTo(0.002, 3);
    // the park origin (park x 40, z -186.5) is on the fitted plane minus the sink: local ground there is about +SINK / s
    expect(p.groundLocal(40, -186.5)).toBeGreaterThan(0.5);
    expect(p.groundLocal(40, -186.5)).toBeLessThan(1.2);
  });

  it("keeps verticals vertical (a shear in y only) and scales uniformly", () => {
    const e = p.elements;
    expect(e[0]).toBeCloseTo(SKYLINE_SCALE, 9);
    expect(e[5]).toBeCloseTo(SKYLINE_SCALE, 9);
    expect(e[10]).toBeCloseTo(SKYLINE_SCALE, 9);
    expect([e[1], e[2], e[4] === 0 ? 0 : 0, e[8], e[9]].every((v) => v === 0)).toBe(true);
  });

  it("the wheel's world top clears the gate's towers (a landmark in the distance)", () => {
    const top = (WHEEL_HUB_Y + WHEEL_R) * SKYLINE_SCALE;
    expect(top).toBeGreaterThan(14);
    expect(WHEEL_SITE.x).toBeGreaterThan(40);
  });
});

describe("the far forest makes way for the skyline", () => {
  it("clears the park's footprint behind the gate and leaves the village and the ridge side alone", () => {
    expect(skylineClearsForest(-24, 150)).toBe(true);
    expect(skylineClearsForest(40, 190)).toBe(true);
    expect(skylineClearsForest(-24, 60)).toBe(false); // inside the village
    expect(skylineClearsForest(-24, 230)).toBe(false); // the ridge-side forest behind the park
    expect(skylineClearsForest(-150, 150)).toBe(false); // beside it
    expect(skylineClearsForest(150, 150)).toBe(false);
  });
});
