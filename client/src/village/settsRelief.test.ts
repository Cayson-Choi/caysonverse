import { describe, expect, it } from "vitest";
import { BufferGeometry, Float32BufferAttribute, Matrix4 } from "three";
import { SETTS_COURT_RADIUS, SETTS_RELIEF, SETTS_TILE_M, fixSettsUv } from "./settsRelief";

describe("the plaza's setts", () => {
  it("relays the inner court straight at the texture's own scale and leaves the rings outside it alone", () => {
    // two triangles: one in the court (a fan next to the fountain, its u collapsed), one in the rings
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([4, 0, 0, 5, 0, 0, 4, 0, 1, 12, 0, 0, 13, 0, 0, 12, 0, 1], 3));
    g.setAttribute("uv", new Float32BufferAttribute([0, 0, 0.001, 0, 0, 0.2, 5, 5, 5.5, 5, 5, 5.5], 2));
    g.setAttribute("uv1", new Float32BufferAttribute([0.1, 0.1, 0.2, 0.1, 0.1, 0.2, 0.3, 0.3, 0.4, 0.3, 0.3, 0.4], 2));
    g.setIndex([0, 1, 2, 3, 4, 5]);
    const out = fixSettsUv(g, new Matrix4());
    expect(out.relaid).toBe(1);
    const uv = out.geometry.getAttribute("uv");
    expect(uv.getX(1) - uv.getX(0)).toBeCloseTo(1 / SETTS_TILE_M, 5); // a metre along x is 1 / 1.8 of a tile
    expect(uv.getY(2) - uv.getY(0)).toBeCloseTo(1 / SETTS_TILE_M, 5);
    expect([uv.getX(3), uv.getY(3), uv.getX(4)]).toEqual([5, 5, 5.5]);
    expect(out.geometry.getAttribute("uv1").getX(4)).toBeCloseTo(0.4, 6); // the light map's layout is kept
    expect(SETTS_COURT_RADIUS).toBeGreaterThan(8);
    expect(g.getAttribute("uv").getX(1)).toBeCloseTo(0.001, 6); // the loader's geometry is not touched
  });
  it("the relief is filtered by the pixel's footprint and reads a smoothed height (no sparkle from the granite's grain)", () => {
    expect(SETTS_RELIEF).toMatch(/texture2D\( map, vMapUv, 2\.0 \)/);
    expect(SETTS_RELIEF).toMatch(/settsFade/);
    expect(SETTS_RELIEF).toMatch(/uVillageNight/);
  });
});
