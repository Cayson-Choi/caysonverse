import { describe, it, expect } from "vitest";
import { isBlocked } from "../collision";
import type { AABB } from "../collision";
import { makeGeometry } from "../school/geometry";
import type { MapGeometry } from "../school/geometry";
import { centre, hasNear, inside, overlaps, reachable } from "../school/reachTestUtil";
import { PLAYER_RADIUS } from "../worldMap";
import {
  VILLAGE_LAYOUT,
  areaGapBlockers,
  boxAt,
  buildVillageGeometry,
  exportVillageLayout,
  greyboxColliders,
  hallWalls,
  villageBounds,
  villageGeometry,
} from "./villageLayout";
import type { PlotId } from "./villageLayout";

const L = VILLAGE_LAYOUT;
const EPS = 1e-9;
/** The flood-fill grid of the brief (m). */
const GRID = 0.5;
const SPAWN = { x: L.spawn.x, z: L.spawn.z };
const HALL = L.areas.hall;
const HALL_SPAWN = { x: L.memorial.interior.spawn.x, z: L.memorial.interior.spawn.z };

const sameBox = (a: AABB, b: AABB) => a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;

/** Distance (m) from a point to the nearest point of a box (0 inside). */
function distToBox(p: { x: number; z: number }, b: AABB): number {
  const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
  const dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ);
  return Math.hypot(dx, dz);
}

/** Village walk: the server clamps a player into the bounds, so the fill stops there too (margin 0). */
function villageFill(geo: MapGeometry) {
  return reachable(geo, SPAWN, GRID, 0);
}

/** The real geometry plus one extra obstacle (proves a check can fail). */
function withExtra(geo: MapGeometry, extra: AABB): MapGeometry {
  return makeGeometry("village", geo.bounds, [], [...geo.obstacles, extra]);
}

/** The real geometry minus every obstacle for which `drop` is true. */
function without(geo: MapGeometry, drop: (o: AABB) => boolean): MapGeometry {
  return makeGeometry("village", geo.bounds, [], geo.obstacles.filter((o) => !drop(o)));
}

const plot = (id: PlotId) => L.plots.find((p) => p.id === id)!;
const plotBox = (id: PlotId) => boxAt(plot(id).centre, plot(id).size);

describe("layout values (the brief, verbatim)", () => {
  it("walk bounds, spawn, plaza, ring road", () => {
    expect(L.walkBounds).toEqual({ minX: -60, maxX: 60, minZ: -60, maxZ: 60 });
    expect(L.spawn.x).toBe(0);
    expect(L.spawn.z).toBe(9); // owner change 2026-11-03: start on the fountain plaza (was (0, 52))
    expect(L.spawn.jitter).toBe(2.5);
    // Facing north (-z): yaw = atan2(dirX, dirZ) = atan2(0, -1) = PI (yaw 0 faces +z).
    expect(L.spawn.yaw).toBeCloseTo(Math.atan2(0, -1), 12);
    // ...which is toward the fountain: the direction from the spawn to the fountain's centre.
    const f = L.plaza.fountain.centre;
    expect(L.spawn.yaw).toBeCloseTo(Math.atan2(f.x - L.spawn.x, f.z - L.spawn.z), 12);
    expect(L.ringRoad).toEqual({ centre: { x: 0, z: 0 }, radius: 20, width: 5 });
  });

  it("plaza: a fountain plaza (owner change 2026-11-03), not a tree", () => {
    expect(L.plaza.centre).toEqual({ x: 0, z: 0 });
    expect(L.plaza.fountain).toEqual({ centre: { x: 0, z: 0 }, basinDiameter: 12, collider: { x: 9, z: 9 } });
    expect(L.plaza.paving).toEqual({ centre: { x: 0, z: 0 }, radius: 17 });
    expect(L.plaza.zelkova).toEqual({ centre: { x: -12, z: -10 }, collider: { x: 5, z: 5 } });
    // The brief's centre tree trunk and 7 x 7 centre deck are gone.
    expect(L.plaza).not.toHaveProperty("trunk");
    expect(L.plaza).not.toHaveProperty("deck");
  });

  it("stream, bridge and pavilion", () => {
    expect(L.stream).toEqual({ z: 30, minX: -60, maxX: 60, width: 6, bridgeGap: { minX: -2, maxX: 2 } });
    expect(L.bridge).toEqual({ minX: -2, maxX: 2, minZ: 27, maxZ: 33 });
    expect(L.pavilion).toEqual({ centre: { x: -14, z: 36 }, size: { x: 5, z: 5 } });
  });

  it("six 16 x 16 plots with the planned ids, centres, labels and sign text", () => {
    expect(L.plots.map((p) => [p.id, p.centre.x, p.centre.z, p.size.x, p.size.z])).toEqual([
      ["plot_n", 0, -40, 16, 16],
      ["plot_ne", 36, -22, 16, 16],
      ["plot_e", 40, 10, 16, 16],
      ["plot_w", -40, 10, 16, 16],
      ["plot_nw", -36, -22, 16, 16],
      ["plot_s", 30, 44, 16, 16],
    ]);
    // plot_n holds the memorial hall (no sign); the rest are empty with an upcoming label.
    expect(plot("plot_n").sign).toBeNull();
    const upcoming: Record<string, string> = { plot_w: "도서관", plot_e: "학교", plot_ne: "성당", plot_nw: "절", plot_s: "교회" };
    for (const [id, label] of Object.entries(upcoming)) {
      expect(plot(id as PlotId).label, id).toBe(label);
      expect(plot(id as PlotId).sign, id).toBe("곧 지어져요");
    }
    expect(plot("plot_n").label.length).toBeGreaterThan(0);
  });

  it("memorial exterior and interior", () => {
    const ex = L.memorial.exterior;
    expect(ex.centre).toEqual({ x: 0, z: -42 });
    expect(ex.size).toEqual({ x: 14, z: 12 });
    expect(boxAt(ex.centre, ex.size)).toEqual({ minX: -7, maxX: 7, minZ: -48, maxZ: -36 });
    expect(ex.doorSide).toBe("s");
    expect(ex.doorPad).toEqual({ centre: { x: 0, z: -35.6 }, radius: 1.6 });

    const inn = L.memorial.interior;
    expect(inn.origin).toEqual({ x: 300, z: 0 });
    expect(inn.size).toEqual({ x: 9, z: 12 });
    expect(inn.room).toEqual({ minX: 295.5, maxX: 304.5, minZ: -6, maxZ: 6 });
    expect(inn.ceilingHeight).toBe(3.4);
    expect(inn.doorPad).toEqual({ centre: { x: 300, z: 5.2 }, radius: 1.4 });
    expect(inn.spawn.x).toBe(300);
    expect(inn.spawn.z).toBe(4.2);
    expect(inn.spawn.yaw).toBeCloseTo(Math.PI, 12); // facing -z
  });

  it("five non-enterable 9 x 7 scenery houses (the (52, 30) one moved to (52, 40): it sat in the stream)", () => {
    expect(L.sceneryHouses.map((h) => [h.centre.x, h.centre.z, h.size.x, h.size.z, h.enterable])).toEqual([
      [-46, 40, 9, 7, false],
      [-30, 50, 9, 7, false],
      [46, -46, 9, 7, false],
      [52, 40, 9, 7, false],
      [-52, -44, 9, 7, false],
    ]);
    expect(new Set(L.sceneryHouses.map((h) => h.id)).size).toBe(5);
  });

  it("areas: village = walk bounds, hall = the interior rectangle", () => {
    expect(Object.keys(L.areas).sort()).toEqual(["hall", "village"]);
    expect(L.areas.village).toEqual(L.walkBounds);
    expect(L.areas.hall).toEqual({ minX: 295.5, maxX: 304.5, minZ: -6, maxZ: 6 });
  });

  it("derived values agree: bridge = stream gap x water band, ring road centred on the plaza", () => {
    expect(L.bridge.minX).toBe(L.stream.bridgeGap.minX);
    expect(L.bridge.maxX).toBe(L.stream.bridgeGap.maxX);
    expect(L.bridge.minZ).toBe(L.stream.z - L.stream.width / 2);
    expect(L.bridge.maxZ).toBe(L.stream.z + L.stream.width / 2);
    expect(L.ringRoad.centre).toEqual(L.plaza.centre);
    expect(L.stream.minX).toBe(L.walkBounds.minX);
    expect(L.stream.maxX).toBe(L.walkBounds.maxX);
  });
});

describe("layout sanity (nothing is built on the water, the road or each other)", () => {
  const water: AABB = { minX: L.stream.minX, maxX: L.stream.maxX, minZ: 27, maxZ: 33 };
  /** True when the box touches the ring road's annulus (nearest and farthest corner against the band). */
  function touchesRing(b: AABB): boolean {
    const c = L.ringRoad.centre;
    const near = distToBox(c, b);
    const far = Math.max(
      ...[b.minX, b.maxX].flatMap((x) => [b.minZ, b.maxZ].map((z) => Math.hypot(x - c.x, z - c.z))),
    );
    const lo = L.ringRoad.radius - L.ringRoad.width / 2;
    const hi = L.ringRoad.radius + L.ringRoad.width / 2;
    return near < hi && far > lo;
  }
  const footprints: Array<[string, AABB]> = [
    ...L.plots.map((p): [string, AABB] => [p.id, boxAt(p.centre, p.size)]),
    ...L.sceneryHouses.map((h): [string, AABB] => [h.id, boxAt(h.centre, h.size)]),
    ["pavilion", boxAt(L.pavilion.centre, L.pavilion.size)],
  ];

  it("every footprint is inside the walk bounds", () => {
    for (const [name, b] of footprints) {
      expect(b.minX, name).toBeGreaterThanOrEqual(L.walkBounds.minX);
      expect(b.maxX, name).toBeLessThanOrEqual(L.walkBounds.maxX);
      expect(b.minZ, name).toBeGreaterThanOrEqual(L.walkBounds.minZ);
      expect(b.maxZ, name).toBeLessThanOrEqual(L.walkBounds.maxZ);
    }
    for (const b of [boxAt(L.plaza.fountain.centre, L.plaza.fountain.collider), boxAt(L.plaza.zelkova.centre, L.plaza.zelkova.collider)]) {
      expect(inside(L.walkBounds, { x: b.minX, z: b.minZ })).toBe(true);
      expect(inside(L.walkBounds, { x: b.maxX, z: b.maxZ })).toBe(true);
    }
  });

  it("no footprint overlaps the stream, the bridge, the ring road or another footprint", () => {
    for (const [name, b] of footprints) {
      expect(overlaps(b, water), `${name} in the stream`).toBe(false);
      expect(overlaps(b, L.bridge), `${name} on the bridge`).toBe(false);
      expect(touchesRing(b), `${name} on the ring road`).toBe(false);
    }
    for (let i = 0; i < footprints.length; i++) {
      for (let j = i + 1; j < footprints.length; j++) {
        expect(overlaps(footprints[i][1], footprints[j][1]), `${footprints[i][0]} / ${footprints[j][0]}`).toBe(false);
      }
    }
  });

  it("the check is not vacuous: the original (52, 30) house position overlaps the stream", () => {
    const old = boxAt({ x: 52, z: 30 }, { x: 9, z: 7 });
    expect(overlaps(old, water)).toBe(true);
  });

  it("the memorial footprint sits inside plot_n", () => {
    const fp = boxAt(L.memorial.exterior.centre, L.memorial.exterior.size);
    const pn = plotBox("plot_n");
    expect(fp.minX).toBeGreaterThanOrEqual(pn.minX);
    expect(fp.maxX).toBeLessThanOrEqual(pn.maxX);
    expect(fp.minZ).toBeGreaterThanOrEqual(pn.minZ);
    expect(fp.maxZ).toBeLessThanOrEqual(pn.maxZ);
  });

  it("plaza: paving inside the ring road, fountain basin inside the paving, zelkova at the paving's edge clear of the fountain", () => {
    const f = L.plaza.fountain;
    const z = L.plaza.zelkova;
    const ringInner = L.ringRoad.radius - L.ringRoad.width / 2;
    expect(L.plaza.paving.radius).toBeLessThanOrEqual(ringInner);
    expect(f.basinDiameter / 2).toBeLessThan(L.plaza.paving.radius);
    expect(L.plaza.paving.centre).toEqual(L.ringRoad.centre);
    // The zelkova's centre is on the paving, outside the fountain's collider (a 5 m round deck: 2.5 m radius).
    const distFromPlaza = Math.hypot(z.centre.x - L.plaza.centre.x, z.centre.z - L.plaza.centre.z);
    expect(distFromPlaza).toBeLessThan(L.plaza.paving.radius);
    expect(overlaps(boxAt(f.centre, f.collider), boxAt(z.centre, z.collider))).toBe(false);
    expect(distFromPlaza - z.collider.x / 2).toBeGreaterThan(f.basinDiameter / 2); // the round deck clears the basin
  });
});

describe("village colliders are built from the layout", () => {
  const colliders = greyboxColliders(L);

  it("greybox list: fountain, zelkova deck, two stream banks, pavilion, memorial pieces and the five houses", () => {
    const ids = colliders.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // unique, so Task 7's col__<id> names can match
    for (const id of ["plaza_fountain", "plaza_zelkova", "stream_bank_w", "stream_bank_e", "pavilion"]) expect(ids).toContain(id);
    expect(ids).not.toContain("plaza_trunk");
    expect(ids).not.toContain("plaza_deck");
    expect(ids.filter((i) => i.startsWith("memorial_"))).toHaveLength(3);
    expect(ids.filter((i) => i.startsWith("house_"))).toHaveLength(5);
    expect(colliders).toHaveLength(13);
  });

  it("plaza colliders: 9 x 9 fountain centred on the plaza, 5 x 5 zelkova deck at (-12, -10)", () => {
    const box = (id: string) => colliders.find((c) => c.id === id)!.box;
    expect(box("plaza_fountain")).toEqual({ minX: -4.5, maxX: 4.5, minZ: -4.5, maxZ: 4.5 });
    expect(box("plaza_zelkova")).toEqual({ minX: -14.5, maxX: -9.5, minZ: -12.5, maxZ: -7.5 });
  });

  it("the stream is walled off along its full length except the bridge gap", () => {
    const west = colliders.find((c) => c.id === "stream_bank_w")!.box;
    const east = colliders.find((c) => c.id === "stream_bank_e")!.box;
    expect(west).toEqual({ minX: -60, maxX: -2, minZ: 27, maxZ: 33 });
    expect(east).toEqual({ minX: 2, maxX: 60, minZ: 27, maxZ: 33 });
  });

  it("changing a layout value moves its collider (values and collider list are separate)", () => {
    const moved = greyboxColliders({ ...L, pavilion: { ...L.pavilion, centre: { x: -14, z: 40 } } });
    expect(moved.find((c) => c.id === "pavilion")!.box).toEqual({ minX: -16.5, maxX: -11.5, minZ: 37.5, maxZ: 42.5 });
    expect(colliders.find((c) => c.id === "pavilion")!.box).toEqual({ minX: -16.5, maxX: -11.5, minZ: 33.5, maxZ: 38.5 });
  });

  it("buildVillageGeometry takes any collider list (Task 7 swaps in the generated one)", () => {
    const bare = buildVillageGeometry(L, []);
    expect(bare.obstacles).toHaveLength(hallWalls(L).length + areaGapBlockers(L).length);
    const one = buildVillageGeometry(L, [{ id: "x", box: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, camera: false }]);
    expect(one.obstacles).toHaveLength(bare.obstacles.length + 1);
  });
});

describe("villageGeometry", () => {
  it("is the 'village' geometry, with bounds spanning the village and the hall", () => {
    expect(villageGeometry.id).toBe("village");
    expect(villageGeometry.bounds).toEqual(villageBounds(L));
    expect(villageGeometry.bounds).toEqual({ minX: -60, maxX: 305, minZ: -60, maxZ: 60 });
    for (const a of [L.areas.village, L.areas.hall]) {
      expect(villageGeometry.bounds.minX).toBeLessThanOrEqual(a.minX);
      expect(villageGeometry.bounds.maxX).toBeGreaterThanOrEqual(a.maxX);
      expect(villageGeometry.bounds.minZ).toBeLessThanOrEqual(a.minZ);
      expect(villageGeometry.bounds.maxZ).toBeGreaterThanOrEqual(a.maxZ);
    }
  });

  it("holds the hall walls, the gap blocker and every village collider", () => {
    for (const w of hallWalls(L)) expect(villageGeometry.obstacles).toContainEqual(w);
    for (const b of areaGapBlockers(L)) expect(villageGeometry.obstacles).toContainEqual(b);
    for (const c of greyboxColliders(L)) expect(villageGeometry.obstacles).toContainEqual(c.box);
    expect(villageGeometry.obstacles).toHaveLength(4 + 1 + 13);
  });

  it("the camera cannot see through the hall walls and the buildings, but looks over fountain, zelkova deck, banks and pavilion", () => {
    for (const w of hallWalls(L)) expect(villageGeometry.cameraBoxes).toContainEqual(w);
    for (const c of greyboxColliders(L)) {
      const isCamera = villageGeometry.cameraBoxes.some((b) => sameBox(b, c.box));
      expect(isCamera, c.id).toBe(c.id.startsWith("house_") || c.id.startsWith("memorial_"));
    }
    expect(villageGeometry.cameraBoxes).toHaveLength(4 + 3 + 5);
  });

  it("no collider overlaps the bridge walkway (bank and bridge only touch at x = +-2)", () => {
    for (const o of villageGeometry.obstacles) expect(overlaps(o, L.bridge), JSON.stringify(o)).toBe(false);
    // Not vacuous: a plank across the bridge does overlap it.
    expect(overlaps({ minX: -1, maxX: 1, minZ: 29, maxZ: 31 }, L.bridge)).toBe(true);
  });

  it("every village collider lies inside the walk bounds", () => {
    for (const c of greyboxColliders(L)) {
      expect(c.box.minX, c.id).toBeGreaterThanOrEqual(L.walkBounds.minX);
      expect(c.box.maxX, c.id).toBeLessThanOrEqual(L.walkBounds.maxX);
      expect(c.box.minZ, c.id).toBeGreaterThanOrEqual(L.walkBounds.minZ);
      expect(c.box.maxZ, c.id).toBeLessThanOrEqual(L.walkBounds.maxZ);
    }
  });
});

describe("spawn", () => {
  it("is at least 1.4 m from every collider, and the whole spawn disk (jitter + body) is clear", () => {
    for (const o of villageGeometry.obstacles) expect(distToBox(SPAWN, o), JSON.stringify(o)).toBeGreaterThanOrEqual(1.4);
    expect(isBlocked(SPAWN.x, SPAWN.z, L.spawn.jitter + PLAYER_RADIUS, villageGeometry.obstacles, 0)).toBe(false);
  });

  it("lies on the paving, south of the fountain", () => {
    const f = L.plaza.fountain.centre;
    expect(Math.hypot(SPAWN.x - f.x, SPAWN.z - f.z)).toBeLessThan(L.plaza.paving.radius);
    expect(SPAWN.z).toBeGreaterThan(f.z + L.plaza.fountain.collider.z / 2);
  });

  it("the clearance check is not vacuous: a crate 1 m from the spawn fails it", () => {
    const geo = withExtra(villageGeometry, { minX: 1, maxX: 2, minZ: 8.5, maxZ: 9.5 });
    expect(geo.obstacles.some((o) => distToBox(SPAWN, o) < 1.4)).toBe(true);
    expect(isBlocked(SPAWN.x, SPAWN.z, L.spawn.jitter + PLAYER_RADIUS, geo.obstacles, 0)).toBe(true);
  });

  it("lies inside the village area", () => {
    expect(inside(L.areas.village, SPAWN)).toBe(true);
  });
});

describe("village reachability (0.5 m grid flood fill over isBlocked)", () => {
  const r = villageFill(villageGeometry);

  it("the village really was walked", () => {
    expect(r.length).toBeGreaterThan(40000);
    expect(r.every((p) => inside(L.areas.village, p))).toBe(true);
  });

  /** Plots and scenery houses by side of the stream. The spawn (z = 9) is on the north side. */
  const northPlots = L.plots.filter((p) => p.centre.z < L.stream.z);
  const southPlots = L.plots.filter((p) => p.centre.z > L.stream.z);
  const northHouses = L.sceneryHouses.filter((h) => h.centre.z < L.stream.z);
  const southHouses = L.sceneryHouses.filter((h) => h.centre.z > L.stream.z);
  /** Some reachable cell stands within 1 m of the house's walls (it can be walked up to). */
  const walkUpTo = (cells: readonly { x: number; z: number }[], h: { centre: { x: number; z: number }; size: { x: number; z: number } }) =>
    cells.some((p) => distToBox(p, boxAt(h.centre, h.size)) <= 1);
  /** The bridge's whole walkway blocked: the stream then has no crossing at all. */
  const bridgeBlocked = withExtra(villageGeometry, L.bridge);

  it("every plot is reachable from the spawn", () => {
    for (const p of L.plots) {
      const b = boxAt(p.centre, p.size);
      expect(r.some((q) => inside(b, q)), p.id).toBe(true);
    }
    // The five empty plots can be walked onto: their centres are free and reached (plot markers are not colliders).
    for (const p of L.plots) {
      if (p.sign === null) continue;
      expect(hasNear(r, p.centre, GRID), p.id).toBe(true);
      expect(isBlocked(p.centre.x, p.centre.z, PLAYER_RADIUS, villageGeometry.obstacles), p.id).toBe(false);
    }
    for (const h of L.sceneryHouses) expect(walkUpTo(r, h), h.id).toBe(true);
  });

  it("the sides of the stream: plot_s and the three southern houses are south, the five other plots and two northern houses are north", () => {
    expect(northPlots.map((p) => p.id).sort()).toEqual(["plot_e", "plot_n", "plot_ne", "plot_nw", "plot_w"]);
    expect(southPlots.map((p) => p.id)).toEqual(["plot_s"]);
    expect(northHouses.map((h) => h.id)).toEqual(["house_3", "house_5"]);
    expect(southHouses.map((h) => h.id)).toEqual(["house_1", "house_2", "house_4"]);
    expect(SPAWN.z).toBeLessThan(L.stream.z - L.stream.width / 2);
  });

  it("without the bridge: the memorial door pad and the northern plots and houses are still reachable", () => {
    const cut = villageFill(bridgeBlocked);
    expect(hasNear(cut, L.memorial.exterior.doorPad.centre, GRID)).toBe(true);
    for (const p of northPlots) expect(cut.some((q) => inside(boxAt(p.centre, p.size), q)), p.id).toBe(true);
    for (const p of northPlots.filter((q) => q.sign !== null)) expect(hasNear(cut, p.centre, GRID), p.id).toBe(true);
    for (const h of northHouses) expect(walkUpTo(cut, h), h.id).toBe(true);
    expect(cut.length).toBeGreaterThan(15000);
  });

  it("everything south of the stream is reachable only over the bridge: with the bridge blocked no path exists", () => {
    // With the bridge, plot_s, the southern houses and the pavilion's surroundings are walked up to.
    for (const p of southPlots) expect(r.some((q) => inside(boxAt(p.centre, p.size), q)), p.id).toBe(true);
    for (const h of southHouses) expect(walkUpTo(r, h), h.id).toBe(true);
    expect(hasNear(r, { x: -14, z: 40 }, GRID)).toBe(true);
    // Without it: not one cell of the south side, not one cell on the bridge or the water band.
    const cut = villageFill(bridgeBlocked);
    expect(cut.every((q) => q.z < L.bridge.minZ)).toBe(true);
    for (const p of southPlots) expect(cut.some((q) => inside(boxAt(p.centre, p.size), q)), p.id).toBe(false);
    for (const h of southHouses) expect(walkUpTo(cut, h), h.id).toBe(false);
    expect(hasNear(cut, { x: -14, z: 40 }, GRID)).toBe(false);
    expect(hasNear(cut, { x: 0, z: 40 }, GRID)).toBe(false);
  });

  it("the memorial door pad is reachable, and so is the plaza around the fountain and the pavilion's surroundings", () => {
    expect(hasNear(r, L.memorial.exterior.doorPad.centre, GRID)).toBe(true);
    expect(isBlocked(L.memorial.exterior.doorPad.centre.x, L.memorial.exterior.doorPad.centre.z, PLAYER_RADIUS, villageGeometry.obstacles)).toBe(false);
    for (const q of [{ x: 0, z: 6 }, { x: 0, z: -6 }, { x: 6, z: 0 }, { x: -6, z: 0 }]) {
      expect(hasNear(r, q, GRID), `fountain side ${JSON.stringify(q)}`).toBe(true);
    }
    expect(hasNear(r, { x: -14, z: 40 }, GRID)).toBe(true); // south of the pavilion
  });

  it("the zelkova's deck can be walked all the way round, and nothing sits inside the fountain's box", () => {
    const z = boxAt(L.plaza.zelkova.centre, L.plaza.zelkova.collider);
    for (const q of [
      { x: z.minX - 1, z: L.plaza.zelkova.centre.z },
      { x: z.maxX + 1, z: L.plaza.zelkova.centre.z },
      { x: L.plaza.zelkova.centre.x, z: z.minZ - 1 },
      { x: L.plaza.zelkova.centre.x, z: z.maxZ + 1 },
    ]) {
      expect(hasNear(r, q, GRID), JSON.stringify(q)).toBe(true);
    }
    expect(r.some((p) => inside(boxAt(L.plaza.fountain.centre, L.plaza.fountain.collider), p))).toBe(false);
    expect(r.some((p) => inside(z, p))).toBe(false);
  });

  it("the ring road can be walked all the way round along its centre line (the zelkova's deck pokes into its inner edge)", () => {
    const { centre: c, radius } = L.ringRoad;
    for (let deg = 0; deg < 360; deg += 5) {
      const a = (deg * Math.PI) / 180;
      const q = { x: c.x + radius * Math.cos(a), z: c.z + radius * Math.sin(a) };
      expect(isBlocked(q.x, q.z, PLAYER_RADIUS, villageGeometry.obstacles), `${deg} deg`).toBe(false);
      expect(hasNear(r, q, GRID), `${deg} deg`).toBe(true);
    }
  });

  it("the stream is crossed only by the bridge", () => {
    const inBand = r.filter((p) => p.z >= L.bridge.minZ && p.z <= L.bridge.maxZ);
    expect(inBand.length).toBeGreaterThan(10); // the bridge itself was walked
    expect(inBand.every((p) => p.x >= L.bridge.minX && p.x <= L.bridge.maxX)).toBe(true);
    // Both banks are reached.
    expect(r.some((p) => p.z < L.bridge.minZ - 5)).toBe(true);
    expect(r.some((p) => p.z > L.bridge.maxZ + 5)).toBe(true);
  });

  it("a plank across only part of the bridge does not cut the village (the cut above really needs the whole walkway)", () => {
    const half = villageFill(withExtra(villageGeometry, { minX: -2, maxX: 0, minZ: 27, maxZ: 33 }));
    expect(half.some((q) => inside(plotBox("plot_s"), q))).toBe(true); // squeezing past on the other half
  });
});

describe("memorial exterior collider and door pad", () => {
  const pieces = greyboxColliders(L).filter((c) => c.id.startsWith("memorial_"));
  const fp = boxAt(L.memorial.exterior.centre, L.memorial.exterior.size);
  const pad = L.memorial.exterior.doorPad;
  const area = (b: AABB) => (b.maxX - b.minX) * (b.maxZ - b.minZ);

  it("is the footprint minus the door-side pad area: the pieces tile it, apart from a pad-wide recess at the door", () => {
    for (const p of pieces) {
      expect(p.box.minX, p.id).toBeGreaterThanOrEqual(fp.minX - EPS);
      expect(p.box.maxX, p.id).toBeLessThanOrEqual(fp.maxX + EPS);
      expect(p.box.minZ, p.id).toBeGreaterThanOrEqual(fp.minZ - EPS);
      expect(p.box.maxZ, p.id).toBeLessThanOrEqual(fp.maxZ + EPS);
    }
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) expect(overlaps(pieces[i].box, pieces[j].box)).toBe(false);
    }
    const recess = (2 * pad.radius) * (fp.maxZ - (pad.centre.z - pad.radius));
    expect(pieces.reduce((s, p) => s + area(p.box), 0)).toBeCloseTo(area(fp) - recess, 9);
    // The rest of the footprint is solid: the back, both sides and the front corners.
    for (const q of [{ x: 0, z: -45 }, { x: -5, z: -40 }, { x: 5, z: -40 }, { x: -4, z: -36.5 }, { x: 4, z: -36.5 }]) {
      expect(isBlocked(q.x, q.z, 0.05, pieces.map((c) => c.box), 0), JSON.stringify(q)).toBe(true);
    }
  });

  it("the whole door pad disc is free of colliders, and its centre is a legal place to stand", () => {
    for (const p of pieces) expect(distToBox(pad.centre, p.box), p.id).toBeGreaterThanOrEqual(pad.radius - EPS);
    for (const o of villageGeometry.obstacles) expect(distToBox(pad.centre, o), JSON.stringify(o)).toBeGreaterThanOrEqual(pad.radius - EPS);
    expect(isBlocked(pad.centre.x, pad.centre.z, PLAYER_RADIUS, villageGeometry.obstacles)).toBe(false);
  });

  it("the pad check is not vacuous: the solid footprint (no recess) would put a collider inside the pad", () => {
    expect(distToBox(pad.centre, fp)).toBeLessThan(pad.radius);
  });
});

describe("the two areas", () => {
  it("the village's east edge is sealed from the hall: from the spawn nothing past x = 60 and nothing in the hall is reachable", () => {
    const r = villageFill(villageGeometry);
    expect(r.some((p) => p.x > L.walkBounds.maxX)).toBe(false);
    expect(r.some((p) => p.x >= HALL.minX - 1)).toBe(false);
    expect(r.some((p) => inside(HALL, p))).toBe(false);
  });

  it("the sealing check is not vacuous: without the gap blocker the village walks all the way to the hall", () => {
    const blockers = areaGapBlockers(L);
    expect(blockers.length).toBeGreaterThan(0);
    const open = without(villageGeometry, (o) => blockers.some((b) => sameBox(b, o)));
    const r = villageFill(open);
    expect(r.some((p) => p.x > 250)).toBe(true);
  });

  it("the gap blocker spans the full z range of the bounds and runs from the village edge to the hall wall", () => {
    for (const b of areaGapBlockers(L)) {
      expect(b.minX).toBe(L.walkBounds.maxX);
      expect(b.minZ).toBeLessThanOrEqual(villageGeometry.bounds.minZ);
      expect(b.maxZ).toBeGreaterThanOrEqual(villageGeometry.bounds.maxZ);
      // It stops at the hall's outer west wall face (walls are 0.5 m thick, outside the room).
      expect(b.maxX).toBe(L.areas.hall.minX - 0.5);
    }
  });

  it("interior: the inside spawn and the inside door pad are reachable, and the hall is a sealed room", () => {
    const r = reachable(villageGeometry, HALL_SPAWN, GRID, 1.5);
    expect(r.length).toBeGreaterThan(300); // the room really was walked
    expect(r.every((p) => inside(HALL, p))).toBe(true); // sealed: not a single cell outside the room, even with a 1.5 m margin
    const doorPad = L.memorial.interior.doorPad;
    expect(hasNear(r, doorPad.centre, GRID)).toBe(true);
    expect(isBlocked(doorPad.centre.x, doorPad.centre.z, PLAYER_RADIUS, villageGeometry.obstacles)).toBe(false);
    expect(hasNear(r, { x: HALL.minX + 1, z: HALL.minZ + 1 }, GRID)).toBe(true); // the far corner too
    expect(inside(HALL, HALL_SPAWN)).toBe(true);
    expect(inside(HALL, doorPad.centre)).toBe(true);
    expect(isBlocked(HALL_SPAWN.x, HALL_SPAWN.z, PLAYER_RADIUS, villageGeometry.obstacles)).toBe(false);
  });

  it("the sealed-room check is not vacuous: with the south wall gone the fill leaves the room", () => {
    const noSouth = without(villageGeometry, (o) => o.minZ === HALL.maxZ && o.minX < HALL.minX && o.maxX > HALL.maxX);
    const r = reachable(noSouth, HALL_SPAWN, GRID, 1.5);
    expect(r.some((p) => !inside(HALL, p))).toBe(true);
  });

  it("from the hall nothing of the village is reachable", () => {
    const r = reachable(villageGeometry, HALL_SPAWN, GRID, 1.5);
    expect(r.some((p) => p.x < HALL.minX)).toBe(false);
  });

  it("the hall walls are outside the room (the room itself stays completely free)", () => {
    for (const w of hallWalls(L)) expect(overlaps(w, HALL), JSON.stringify(w)).toBe(false);
    expect(isBlocked(HALL.minX + 0.4, HALL.minZ + 0.4, PLAYER_RADIUS, villageGeometry.obstacles)).toBe(false);
  });
});

describe("export for the Blender scripts", () => {
  const out = exportVillageLayout(L);

  it("is plain JSON: it survives a stringify/parse round trip unchanged", () => {
    expect(JSON.parse(JSON.stringify(out))).toStrictEqual(out);
  });

  it("carries every section a Blender script needs", () => {
    for (const key of [
      "walkBounds", "spawn", "plaza", "ringRoad", "stream", "bridge", "pavilion", "plots", "memorial", "sceneryHouses", "areas", "colliders",
    ]) {
      expect(out, key).toHaveProperty(key);
    }
    expect(out.memorial).toHaveProperty("exterior");
    expect(out.memorial).toHaveProperty("interior");
    expect(out.plots).toHaveLength(6);
    expect(out.sceneryHouses).toHaveLength(5);
    expect(out.areas).toEqual({ village: L.areas.village, hall: L.areas.hall });
  });

  it("plots keep id, centre, size, label, sign and a ready-made rectangle", () => {
    const n = out.plots.find((p) => p.id === "plot_n")!;
    expect(n).toMatchObject({ label: L.plots[0].label, sign: null, centre: { x: 0, z: -40 }, size: { x: 16, z: 16 }, bounds: { minX: -8, maxX: 8, minZ: -48, maxZ: -32 } });
    const w = out.plots.find((p) => p.id === "plot_w")!;
    expect(w).toMatchObject({ label: "도서관", sign: "곧 지어져요", bounds: { minX: -48, maxX: -32, minZ: 2, maxZ: 18 } });
  });

  it("memorial exterior has footprint, door pad and collider pieces; interior has room, ceiling, pad and spawn", () => {
    expect(out.memorial.exterior.footprint).toEqual({ minX: -7, maxX: 7, minZ: -48, maxZ: -36 });
    expect(out.memorial.exterior.doorPad).toEqual(L.memorial.exterior.doorPad);
    expect(out.memorial.exterior.colliders).toHaveLength(3);
    expect(out.memorial.interior.room).toEqual(L.areas.hall);
    expect(out.memorial.interior.ceilingHeight).toBe(3.4);
    expect(out.memorial.interior.doorPad).toEqual(L.memorial.interior.doorPad);
    expect(out.memorial.interior.spawn).toEqual(L.memorial.interior.spawn);
  });

  it("stream banks, houses and the pavilion come with rectangles; colliders list every greybox box", () => {
    expect(out.stream.banks).toHaveLength(2);
    expect(out.sceneryHouses[3]).toMatchObject({ centre: { x: 52, z: 40 }, bounds: { minX: 47.5, maxX: 56.5, minZ: 36.5, maxZ: 43.5 } });
    expect(out.pavilion.bounds).toEqual({ minX: -16.5, maxX: -11.5, minZ: 33.5, maxZ: 38.5 });
    expect(out.colliders.map((c) => c.id)).toEqual(greyboxColliders(L).map((c) => c.id));
    expect(centre(out.plaza.fountain.collider.bounds)).toEqual({ x: 0, z: 0 });
  });

  it("plaza fields: fountain (basin diameter, 9 x 9 collider), paving disk, zelkova with its 5 x 5 collider", () => {
    expect(out.plaza.centre).toEqual({ x: 0, z: 0 });
    expect(out.plaza.fountain).toEqual({
      centre: { x: 0, z: 0 },
      basinDiameter: 12,
      collider: { size: { x: 9, z: 9 }, bounds: { minX: -4.5, maxX: 4.5, minZ: -4.5, maxZ: 4.5 } },
    });
    expect(out.plaza.paving).toEqual({ centre: { x: 0, z: 0 }, radius: 17 });
    expect(out.plaza.zelkova).toEqual({
      centre: { x: -12, z: -10 },
      collider: { size: { x: 5, z: 5 }, bounds: { minX: -14.5, maxX: -9.5, minZ: -12.5, maxZ: -7.5 } },
    });
    expect(out.plaza).not.toHaveProperty("trunk");
    expect(out.plaza).not.toHaveProperty("deck");
  });
});
