import { describe, expect, it } from "vitest";
import { bedAt, bedTexture, fillBedHoles, newBedGrid, rasterBed } from "./waterBed";
import { plantGeometry, type FlowerSpec, type LeafSpec } from "./waterPlants";
import { POND_BRIDGE_Z, POND_FLOOR_Y, POND_RECT, POND_WATER_Y, planPond, pondSpot } from "./pond/pondPlan";
import { LILY_BAYS, planLakeShore } from "../lake/lakeShorePlan";
import { LAKE_DECKS, LAKE_SHORE, LAKE_WATER_Y, distToPolygonEdge, insidePolygon } from "@caysonverse/shared/village/lakeLayout";
import { LAKE_FISHING_SPOTS } from "@caysonverse/shared/village/lakeLayout";

/** A bowl: ground at y 0 outside radius 6 around (0, 0), sloping to -2 in the middle, one quad grid. */
function bowl(): { position: Float32Array; index: Uint32Array } {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = 49;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = -12 + i * 0.5;
      const z = -12 + j * 0.5;
      const r = Math.hypot(x, z);
      pos.push(x, -2 * Math.max(0, 1 - r / 6), z);
    }
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
    }
  return { position: new Float32Array(pos), index: new Uint32Array(idx) };
}

describe("water bed", () => {
  const rect = { x0: -10, z0: -10, x1: 10, z1: 10 };
  it("rasterises ground triangles into a height grid and reads them back", () => {
    const g = newBedGrid(rect, 0.25);
    rasterBed(g, bowl());
    fillBedHoles(g);
    expect(bedAt(g, 0, 0)).toBeLessThan(-1.85);
    expect(bedAt(g, 9, 9)).toBeCloseTo(0, 2);
    expect(bedAt(g, 3, 0)).toBeCloseTo(-1, 1);
    expect(Number.isNaN(bedAt(g, 50, 0))).toBe(true);
    expect(bedAt(g, 50, 0, 7)).toBe(7);
  });
  it("packs the heights into the depth water's map (R = height over the range)", () => {
    const g = newBedGrid(rect, 0.5);
    rasterBed(g, bowl());
    const t = bedTexture(g, [-4, 1]);
    const d = t.image.data as Uint8Array;
    expect(t.image.width).toBe(g.w);
    // row j, column i: the middle (0, 0) is -2 -> (−2 + 4) / 5
    const k = (Math.floor(10 / 0.5) * g.w + Math.floor(10 / 0.5)) * 2;
    expect(d[k]! / 255).toBeCloseTo(0.4, 1);
  });
});

describe("water plants", () => {
  const leaf: LeafSpec = { x: 1, y: 0, z: 2, r: 0.3, yaw: 0.4, seed: 3, tone: 1, cup: 0.05 };
  const flower: FlowerSpec = { x: 1.5, y: 0.1, z: 2.2, r: 0.1, yaw: 0, seed: 4, open: 1, pink: 0.5 };
  it("builds one coloured geometry for the leaves and the flowers", () => {
    const g = plantGeometry([leaf, { ...leaf, seed: 5, stalkFrom: -0.5 }], [flower, { ...flower, stalkFrom: -0.5 }])!;
    expect(g.getAttribute("position").count).toBeGreaterThan(100);
    expect(g.getAttribute("color").count).toBe(g.getAttribute("position").count);
    const tri = g.index!.count / 3;
    expect(tri).toBeGreaterThan(100);
    for (const v of g.getAttribute("position").array) expect(Number.isFinite(v)).toBe(true);
  });
  it("is deterministic and empty without plants", () => {
    expect(plantGeometry([], [])).toBeNull();
    const a = plantGeometry([leaf], [flower])!;
    const b = plantGeometry([leaf], [flower])!;
    expect(Array.from(a.getAttribute("position").array)).toEqual(Array.from(b.getAttribute("position").array));
  });
  it("keeps a floating pad's rim above its middle and inside its radius", () => {
    const g = plantGeometry([leaf], [])!;
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      expect(Math.hypot(p.getX(i) - leaf.x, p.getZ(i) - leaf.z)).toBeLessThanOrEqual(leaf.r * 1.12);
      expect(p.getY(i)).toBeGreaterThanOrEqual(leaf.y - 1e-6);
    }
  });
});

describe("temple pond plan", () => {
  // an ellipse-ish pond: two lobes either side of the bridge band, floor at POND_FLOOR_Y, land (0.4) elsewhere
  function pondGrid() {
    const g = newBedGrid(POND_RECT, 0.05);
    for (let j = 0; j < g.h; j++)
      for (let i = 0; i < g.w; i++) {
        const x = g.rect.x0 + (i + 0.5) * g.res;
        const z = g.rect.z0 + (j + 0.5) * g.res;
        const inside = Math.hypot((x + 46) / 2.1, (z + 44) / 2.7) < 1;
        g.heights[j * g.w + i] = inside ? POND_FLOOR_Y : 0.4;
      }
    return g;
  }
  it("puts every plant well inside the water and clear of the bridge", () => {
    const g = pondGrid();
    const plan = planPond(g, [{ x: -46, z: -42.5 }, { x: -45, z: -45.5 }, { x: -49, z: -44 }], [{ x: -46.5, z: -42 }, { x: -44.8, z: -45.8 }], false);
    expect(plan.leaves.length).toBeGreaterThan(8);
    expect(plan.flowers.length).toBe(2); // the one at x -49 is outside the water
    expect(plan.pebbles.length).toBeGreaterThan(20);
    for (const l of plan.leaves) {
      expect(pondSpot(g, l.x, l.z, 0.2)).toBe(true);
      expect(l.z < POND_BRIDGE_Z.min || l.z > POND_BRIDGE_Z.max).toBe(true);
      expect(l.y).toBeGreaterThan(POND_FLOOR_Y);
    }
    for (const s of plan.pebbles) expect(s.top).toBeLessThan(POND_WATER_Y);
  });
  it("is deterministic", () => {
    const g = pondGrid();
    const a = planPond(g, [], [], true);
    const b = planPond(g, [], [], true);
    expect(a.leaves.map((l) => [l.x, l.z])).toEqual(b.leaves.map((l) => [l.x, l.z]));
  });
});

describe("lake shore plan", () => {
  // a lake bed matching the shoreline: -0.5 at the waterline falling to -3 at 8 m in, land (0.2) outside
  function lakeGrid() {
    const xs = LAKE_SHORE.map((p) => p.x);
    const zs = LAKE_SHORE.map((p) => p.z);
    const g = newBedGrid({ x0: Math.min(...xs) - 3, x1: Math.max(...xs) + 3, z0: Math.min(...zs) - 3, z1: Math.max(...zs) + 3 }, 0.5);
    for (let j = 0; j < g.h; j++)
      for (let i = 0; i < g.w; i++) {
        const x = g.rect.x0 + (i + 0.5) * g.res;
        const z = g.rect.z0 + (j + 0.5) * g.res;
        g.heights[j * g.w + i] = insidePolygon(x, z, LAKE_SHORE) ? -0.6 - Math.min(2.4, distToPolygonEdge(x, z, LAKE_SHORE) * 0.3) : 0.2;
      }
    return g;
  }
  it("plants reeds and lilies in the water, clear of the decks and the floats", () => {
    const plan = planLakeShore(lakeGrid(), false);
    expect(plan.reeds.length).toBeGreaterThan(20);
    expect(plan.leaves.length).toBeGreaterThan(20);
    expect(plan.flowers.length).toBeGreaterThan(0);
    for (const l of plan.leaves) {
      expect(insidePolygon(l.x, l.z, LAKE_SHORE)).toBe(true);
      expect(l.y).toBeGreaterThan(LAKE_WATER_Y - 0.1);
      for (const s of LAKE_FISHING_SPOTS) expect(Math.hypot(s.float.x - l.x, s.float.z - l.z)).toBeGreaterThanOrEqual(5);
      for (const d of LAKE_DECKS) expect(l.x > d.box.minX && l.x < d.box.maxX && l.z > d.box.minZ && l.z < d.box.maxZ).toBe(false);
      expect(LILY_BAYS.some((b) => Math.hypot(b.x - l.x, b.z - l.z) <= b.r + 0.01)).toBe(true);
    }
    for (const r of plan.reeds) for (const s of LAKE_FISHING_SPOTS) expect(Math.hypot(s.float.x - r.x, s.float.z - r.z)).toBeGreaterThan(3);
  });
  it("makes fewer on the phone tier, deterministically", () => {
    const g = lakeGrid();
    const hi = planLakeShore(g, false);
    const lo = planLakeShore(g, true);
    expect(lo.reeds.length).toBeLessThan(hi.reeds.length);
    expect(lo.leaves.length).toBeLessThan(hi.leaves.length);
    expect(planLakeShore(g, true).reeds.map((r) => r.x)).toEqual(lo.reeds.map((r) => r.x));
  });
});
