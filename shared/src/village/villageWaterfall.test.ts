/**
 * B1 waterfall: the W0 shape lock in the layout (`VILLAGE_LAYOUT.backdrop.waterfall`). The numbers are shared by the art
 * (art/village/tools/falls_shape.py reads them from layout.json), the runtime (client/src/village/falls/*) and walking
 * (W5). docs/designs/waterfall/falls-contract.json is falls_shape.py's export; the last test keeps it in step.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT, boxAt, exportVillageLayout, type Point2, type WaterfallSlab } from "./villageLayout";
import type { Bounds } from "../school/geometry";

const L = VILLAGE_LAYOUT;
const W = L.backdrop.waterfall;
const G = 9.81;

const inBox = (p: Point2, b: Bounds) => p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
const boxInBox = (a: Bounds, b: Bounds) => a.minX >= b.minX && a.maxX <= b.maxX && a.minZ >= b.minZ && a.maxZ <= b.maxZ;
/** Normalised radius of the pool's waterline ellipse grown by `grow` m (1 = on it). */
const poolQ = (p: Point2, grow = 0) =>
  Math.hypot((p.x - W.pool.centre.x) / (W.pool.radiusX + grow), (p.z - W.pool.centre.z) / (W.pool.radiusZ + grow));
/** Normalised radius in a slab's own (turned) frame. */
const slabQ = (s: WaterfallSlab, p: Point2) => {
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  const dx = p.x - s.centre.x;
  const dz = p.z - s.centre.z;
  return Math.hypot((dx * c - dz * sn) / s.radiusX, (dx * sn + dz * c) / s.radiusZ);
};
const segDist = (p: Point2, a: Point2, b: Point2) => {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
};
const wallX = (z: number) => {
  const w = W.cameraWall;
  if (z <= w[0].z) return w[0].x;
  for (let i = 1; i < w.length; i++) {
    if (z <= w[i].z) return w[i - 1].x + ((w[i].x - w[i - 1].x) * (z - w[i - 1].z)) / (w[i].z - w[i - 1].z);
  }
  return w[w.length - 1].x;
};

describe("B1 waterfall: the site box (waterfall.glb owns everything inside)", () => {
  it("is x -140..-100, z -104..-58, wholly outside the walk bounds, round the old backdrop rectangle", () => {
    expect(W.site).toEqual({ minX: -140, maxX: -100, minZ: -104, maxZ: -58 });
    expect(W.site.maxX).toBeLessThan(L.walkBounds.minX);
    expect(boxInBox(boxAt(W.centre, W.size), W.site)).toBe(true);
    // the old values stay: parts_nature.py still reads them until the village rebuild
    expect(W).toMatchObject({ centre: { x: -118, z: -78 }, size: { x: 28, z: 14 }, height: 36, facing: "e" });
  });

  it("holds the lip, the impact, the pool, the outlet and every slab, seat and lamp", () => {
    expect(inBox(W.lip, W.site)).toBe(true);
    expect(inBox(W.impact, W.site)).toBe(true);
    for (const a of [0, 1, 2, 3].map((k) => (k * Math.PI) / 2)) {
      const p = { x: W.pool.centre.x + (W.pool.radiusX + W.pool.keepOut) * Math.cos(a), z: W.pool.centre.z + (W.pool.radiusZ + W.pool.keepOut) * Math.sin(a) };
      expect(inBox(p, W.site), `pool keep-out at ${a}`).toBe(true);
    }
    for (const p of W.outlet.points) expect(inBox(p, W.site)).toBe(true);
    for (const s of W.slabs) expect(inBox(s.centre, W.site), s.id).toBe(true);
    for (const s of W.seats) expect(boxInBox(boxAt(s.centre, s.size), W.site), s.id).toBe(true);
    for (const l of W.lamps) expect(inBox(l, W.site)).toBe(true);
  });
});

describe("B1 waterfall: the falls", () => {
  it("36 m in all: the upper cascade from 36 m down to the lip at 17 m, a free plunge below", () => {
    expect(W.height).toBe(36);
    expect(W.lip).toEqual({ x: -117, y: 17, z: -78 });
    expect(W.lip.y).toBeLessThan(W.height);
  });

  it("the plunge leaves the lip at 2.2 m/s and its parabola lands on the pool surface at the impact point", () => {
    const t = Math.sqrt((2 * (W.lip.y - W.pool.waterY)) / G);
    expect(W.plungeSpeed).toBe(2.2);
    expect(W.impact.x).toBeCloseTo(W.lip.x + W.plungeSpeed * t, 2);
    expect(W.impact.y).toBe(W.pool.waterY);
    expect(W.impact.z).toBe(W.lip.z);
    expect(W.impact.x - W.lip.x).toBeGreaterThan(3.5); // ~4 m out from the ledge (design section 4)
    expect(poolQ(W.impact)).toBeLessThan(0.5); // well inside the pool
  });
});

describe("B1 waterfall: the pool (소)", () => {
  it("keeps the design's ellipse and depths, and cannot be entered", () => {
    expect(W.pool).toEqual({ centre: { x: -111.5, z: -78 }, radiusX: 8.5, radiusZ: 11, waterY: -0.25, depth: 2.2, edgeDepth: 0.3, keepOut: 0.6, enterable: false });
  });

  it("its keep-out ring stays out of the village's walk bounds", () => {
    expect(W.pool.centre.x + W.pool.radiusX + W.pool.keepOut).toBeLessThan(L.walkBounds.minX);
  });

  it("the outlet starts in the pool, runs downhill and leaves at the site's south edge, clear of the pocket", () => {
    const pts = W.outlet.points;
    expect(poolQ(pts[0])).toBeLessThan(1);
    expect(pts[pts.length - 1]).toEqual({ x: -107, z: -58 });
    expect(pts[pts.length - 1].z).toBe(W.site.maxZ);
    expect(W.outlet.waterY[0]).toBe(W.pool.waterY);
    expect(W.outlet.waterY[1]).toBeLessThanOrEqual(W.outlet.waterY[0]);
    const pocketCorners = [
      { x: W.pocket.minX, z: W.pocket.maxZ },
      { x: W.pocket.minX, z: W.pocket.minZ },
    ];
    for (const c of pocketCorners) {
      for (let i = 1; i < pts.length; i++) expect(segDist(c, pts[i - 1], pts[i])).toBeGreaterThan(W.outlet.width / 2 + 1);
    }
    for (let i = 1; i < pts.length; i++) expect(pts[i].z).toBeGreaterThan(pts[i - 1].z); // it heads south
  });
});

describe("B1 waterfall: the rest area (폭포 쉼터, option B)", () => {
  it("the pocket is x -106..-95, z -90..-68, against the walk bounds' west edge, entered through z -86..-70", () => {
    expect(W.options.walkable).toBe(true);
    expect(W.pocket).toEqual({ minX: -106, maxX: -95, minZ: -90, maxZ: -68 });
    expect(W.pocket.maxX).toBe(L.walkBounds.minX);
    expect(W.entry).toEqual({ x: -95, minZ: -86, maxZ: -70 });
    expect(W.entry.x).toBe(L.walkBounds.minX);
    expect(W.entry.minZ).toBeGreaterThanOrEqual(W.pocket.minZ);
    expect(W.entry.maxZ).toBeLessThanOrEqual(W.pocket.maxZ);
    expect(W.entry.minZ).toBeGreaterThanOrEqual(L.walkBounds.minZ);
  });

  it("the pocket's walkable part reaches the water: the keep-out's east tip is inside it", () => {
    const tip = { x: W.pool.centre.x + W.pool.radiusX + W.pool.keepOut, z: W.pool.centre.z };
    expect(inBox(tip, W.pocket)).toBe(true);
    expect(tip.x).toBeCloseTo(-102.4, 6);
  });

  it("four slabs at the walk level (players walk at y = 0); the front one is the shore, its lip over the water at x ~ -104.5", () => {
    expect(W.slabs.map((s) => s.id)).toEqual(["falls_slab_0", "falls_slab_1", "falls_slab_2", "falls_slab_3"]);
    for (const s of W.slabs) {
      expect(inBox(s.centre, W.pocket), s.id).toBe(true);
      expect(s.top, s.id).toBeGreaterThanOrEqual(0);
      expect(s.top, s.id).toBeLessThanOrEqual(0.06);
      expect(poolQ({ x: s.centre.x + s.radiusX / 2, z: s.centre.z }), `${s.id} east half on the shore`).toBeGreaterThan(1);
    }
    const front = W.slabs[0];
    const lipX = front.centre.x - front.radiusX * Math.cos(front.yaw);
    expect(lipX).toBeGreaterThan(-104.9);
    expect(lipX).toBeLessThan(-104.2);
    expect(poolQ({ x: lipX + 0.1, z: front.centre.z })).toBeLessThan(1); // overhangs the water
    // no two slabs overlap (centres farther apart than the sum of their long radii)
    for (let i = 0; i < W.slabs.length; i++) {
      for (let j = i + 1; j < W.slabs.length; j++) {
        const a = W.slabs[i];
        const b = W.slabs[j];
        const d = Math.hypot(a.centre.x - b.centre.x, a.centre.z - b.centre.z);
        expect(d, `${a.id} / ${b.id}`).toBeGreaterThan(Math.max(a.radiusX, a.radiusZ) + Math.max(b.radiusX, b.radiusZ) - 0.6);
      }
    }
  });

  it("two backless seat stones, sat on from either long side, with room to stand on both sides", () => {
    expect(W.options.seats).toBe(true);
    expect(W.seats.map((s) => s.id)).toEqual(["falls_seat_n", "falls_seat_s"]);
    for (const s of W.seats) {
      const b = boxAt(s.centre, s.size);
      expect(s.facings).toEqual(["w", "e"]);
      expect(s.seatTop, s.id).toBeGreaterThan(0.38);
      expect(s.seatTop, s.id).toBeLessThan(0.48);
      expect(boxInBox(b, W.pocket), s.id).toBe(true);
      for (const z of [b.minZ, s.centre.z, b.maxZ]) {
        const west = { x: b.minX - 0.9, z };
        const east = { x: b.maxX + 0.9, z };
        expect(poolQ(west, W.pool.keepOut), `${s.id} west stand spot`).toBeGreaterThan(1);
        expect(inBox(west, W.pocket) && inBox(east, W.pocket), `${s.id} stand spots in the pocket`).toBe(true);
        for (const sl of W.slabs) expect(slabQ(sl, { x: s.centre.x, z }), `${s.id} off ${sl.id}`).toBeGreaterThan(1);
      }
    }
  });

  it("two warm night lamps on the shore stones (between the waterline and the keep-out), aimed at the bottom of the falls", () => {
    expect(W.options.nightLamps).toBe(2);
    expect(W.lamps).toHaveLength(2);
    for (const l of W.lamps) {
      expect(poolQ(l)).toBeGreaterThan(1);
      expect(poolQ(l, W.pool.keepOut)).toBeLessThan(1);
      expect(l.aim.y).toBeLessThanOrEqual(10); // the bottom 10 m only
      expect(l.aim.x).toBeLessThan(W.impact.x);
    }
  });

  it("the camera wall runs north to south past the pool, behind the lip, leaving room behind the pocket", () => {
    const w = W.cameraWall;
    for (let i = 1; i < w.length; i++) expect(w[i].z).toBeGreaterThan(w[i - 1].z);
    expect(w[0].z).toBeLessThanOrEqual(W.pool.centre.z - W.pool.radiusZ - 2);
    expect(w[w.length - 1].z).toBeGreaterThanOrEqual(W.pool.centre.z + W.pool.radiusZ + 2);
    expect(wallX(W.lip.z)).toBeGreaterThan(W.lip.x); // the lip and the rock under it stay behind the wall
    expect(wallX(W.lip.z)).toBeLessThan(W.impact.x); // the camera can still look down on the plunge
    for (let z = W.pocket.minZ; z <= W.pocket.maxZ; z += 0.5) expect(wallX(z), `z ${z}`).toBeLessThan(W.pocket.minX - 3);
    for (const p of w) expect(p.x).toBeGreaterThan(W.site.minX);
  });

  it("the morning rainbow is high tier only, in the morning", () => {
    expect(W.options.rainbowTier).toBe("high");
    expect(W.options.rainbowHours[0]).toBeGreaterThanOrEqual(5);
    expect(W.options.rainbowHours[1]).toBeLessThanOrEqual(12);
    expect(W.options.rainbowHours[0]).toBeLessThan(W.options.rainbowHours[1]);
  });
});

describe("B1 waterfall: export for the Blender scripts and the art contract", () => {
  const out = exportVillageLayout(L);

  it("exports every waterfall field (plus the old rectangle's bounds) as plain JSON", () => {
    const wf = out.backdrop.waterfall;
    for (const k of ["site", "pocket", "entry", "lip", "plungeSpeed", "impact", "pool", "outlet", "slabs", "seats", "lamps", "cameraWall", "options"]) {
      expect(wf, k).toHaveProperty(k);
    }
    expect(wf.bounds).toEqual({ minX: -132, maxX: -104, minZ: -85, maxZ: -71 });
    expect(JSON.parse(JSON.stringify(wf))).toStrictEqual(wf);
  });

  it("docs/designs/waterfall/falls-contract.json was exported from these same numbers (re-run falls_shape.py --export-contract if not)", () => {
    const file = fileURLToPath(new URL("../../../docs/designs/waterfall/falls-contract.json", import.meta.url));
    const contract = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(contract.format).toBe("caysonverse-falls-contract");
    expect(contract.layout).toStrictEqual(JSON.parse(JSON.stringify(out.backdrop.waterfall)));
    expect(contract.heights).toMatchObject({ top: 36, ledge: 17, waterY: -0.25 });
    expect(contract.plunge.impactComputed.x).toBeCloseTo(W.impact.x, 2);
    expect(contract.walk.cameraWall).toStrictEqual(JSON.parse(JSON.stringify(W.cameraWall)));
  });
});
