import { describe, it, expect } from "vitest";
import { isBlocked } from "../collision";
import type { AABB } from "../collision";
import { makeGeometry } from "../school/geometry";
import type { Bounds, MapGeometry } from "../school/geometry";
import { centre, hasNear, inside, overlaps, reachable } from "../school/reachTestUtil";
import { MOVE_ELAPSED_CEIL_MS, MOVE_SPEED_SLACK, RUN_SPEED } from "../constants";
import { PLAYER_RADIUS } from "../worldMap";
import { VILLAGE_CAMERA_BOXES, VILLAGE_COLLIDERS } from "./generated/villageColliders";
import { MEMORIAL_CAMERA_BOXES, MEMORIAL_COLLIDERS } from "./generated/memorialColliders";
import { guideColliders } from "./guides";
import {
  HALL_APRON,
  HALL_CEILING_DROP,
  HALL_MODEL_COLLIDERS,
  SCENERY_SIZES,
  VILLAGE_LAYOUT,
  VILLAGE_MODEL_COLLIDERS,
  areaGapBlockers,
  boxAt,
  buildVillageGeometry,
  colliderNode,
  cubbyAnchorNode,
  cubbyAnchors,
  cubbyWallBox,
  exportVillageLayout,
  greyboxColliders,
  hallCeilingSlab,
  hallInteriorColliders,
  hallSurroundBlockers,
  hallWalls,
  segmentBand,
  segmentBank,
  villageBounds,
  villageGeometry,
} from "./villageLayout";
import type { PlotId, Point2, Side, VillageLane } from "./villageLayout";

const L = VILLAGE_LAYOUT;
const EPS = 1e-9;
/** The flood-fill grid of the brief (m). */
const GRID = 0.5;
/** The fine grid for the seal checks (m): finds a gap down to 0.9 m, where the 0.5 m grid needs 1.3 m. */
const FINE_GRID = 0.1;
const SPAWN = { x: L.spawn.x, z: L.spawn.z };
const HALL = L.areas.hall;
const HALL_SPAWN = { x: L.memorial.interior.spawn.x, z: L.memorial.interior.spawn.z };
const STREAM = L.stream;
const GAP = STREAM.bridgeGap;
const PAD = L.memorial.exterior.doorPad;
/** The longest step the server accepts in one Move (m): RUN_SPEED x the 500 ms ceiling x the 1.5 slack = 4.8. */
const MAX_STEP = RUN_SPEED * (MOVE_ELAPSED_CEIL_MS / 1000) * MOVE_SPEED_SLACK;

const sameBox = (a: AABB, b: AABB) => a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;

/** Distance (m) from a point to the nearest point of a box (0 inside). */
function distToBox(p: Point2, b: AABB): number {
  const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
  const dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ);
  return Math.hypot(dx, dz);
}

/** The farthest corner of a box from `from` (m). */
function farCorner(b: AABB, from: Point2 = { x: 0, z: 0 }): number {
  return Math.max(...[b.minX, b.maxX].flatMap((x) => [b.minZ, b.maxZ].map((z) => Math.hypot(x - from.x, z - from.z))));
}

/** The box of a layout item with a centre and a size. */
const boxOf = (o: { centre: Point2; size: { x: number; z: number } }) => boxAt(o.centre, o.size);

/** The compass side of a box's centre that faces the plaza centre (the dominant axis of the way there). */
function sideTowardPlaza(c: Point2): Side {
  const dx = L.plaza.centre.x - c.x;
  const dz = L.plaza.centre.z - c.z;
  return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? "e" : "w") : dz > 0 ? "s" : "n";
}

/** The water band of every segment as a box, and the same with the banks on both sides (the collider). */
const BANDS: AABB[] = STREAM.segments.map((s) => ({ minX: s.minX, maxX: s.maxX, ...segmentBand(STREAM, s) }));
const BANKS: AABB[] = STREAM.segments.map((s) => ({ minX: s.minX, maxX: s.maxX, ...segmentBank(STREAM, s) }));
/** The creek's bank edges at x (closed segments). */
function bankAt(x: number): { minZ: number; maxZ: number } {
  const here = BANKS.filter((b) => x >= b.minX && x <= b.maxX);
  return { minZ: Math.min(...here.map((b) => b.minZ)), maxZ: Math.max(...here.map((b) => b.maxZ)) };
}
/** Band edges of the creek at x (closed segments, so a join gives the hull of both neighbours). */
function bandAt(x: number): { minZ: number; maxZ: number } {
  const here = BANDS.filter((b) => x >= b.minX && x <= b.maxX);
  return { minZ: Math.min(...here.map((b) => b.minZ)), maxZ: Math.max(...here.map((b) => b.maxZ)) };
}
const WATER_MIN_Z = Math.min(...BANDS.map((b) => b.minZ));

/** True when the union of the closed intervals `[lo, hi]` covers `[from, to]` (no gap, not even a point). */
function covers(intervals: ReadonlyArray<[number, number]>, from: number, to: number): boolean {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let cursor = from;
  for (const [lo, hi] of sorted) {
    if (lo > cursor + EPS) return false;
    if (hi > cursor) cursor = hi;
    if (cursor >= to - EPS) return true;
  }
  return cursor >= to - EPS;
}

/** The z-intervals of the obstacles whose box contains x (closed). */
function zIntervalsAt(obstacles: readonly AABB[], x: number): Array<[number, number]> {
  return obstacles.filter((o) => x >= o.minX && x <= o.maxX).map((o): [number, number] => [o.minZ, o.maxZ]);
}

/** Village walk: the server clamps a player into the bounds, so the fill stops there too (margin 0). */
function villageFill(geo: MapGeometry, step = GRID) {
  return reachable(geo, SPAWN, step, 0);
}

/** The same obstacles, but only the `window` is walked (so a 0.1 m fill stays cheap). */
function windowed(geo: MapGeometry, window: Bounds): MapGeometry {
  return makeGeometry("village", window, [], geo.obstacles);
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
const plotBox = (id: PlotId) => boxOf(plot(id));
/** The ring road's band [inner, outer] and the sidewalk's outer radius. */
const RING_INNER = L.ringRoad.radius - L.ringRoad.width / 2;
const RING_OUTER = L.ringRoad.radius + L.ringRoad.width / 2;
const SIDEWALK_OUTER = RING_OUTER + L.ringRoad.sidewalk.width;

/** Sample a lane's centre line every `step` metres. */
function laneSamples(lane: VillageLane, step = 0.25): Point2[] {
  const out: Point2[] = [];
  for (let i = 0; i + 1 < lane.points.length; i++) {
    const a = lane.points[i];
    const b = lane.points[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 0; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

/** The shortest distance between a point of `a` and a point of `b` when it is under `cell` metres, else Infinity (exact below `cell`). */
function minDistance(a: readonly Point2[], b: readonly Point2[], cell = 5): number {
  const keyOf = (x: number, z: number) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const buckets = new Map<string, Point2[]>();
  for (const q of b) {
    const k = keyOf(q.x, q.z);
    const list = buckets.get(k);
    if (list) list.push(q);
    else buckets.set(k, [q]);
  }
  let best = Infinity;
  for (const p of a) {
    const cx = Math.floor(p.x / cell);
    const cz = Math.floor(p.z / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const q of buckets.get(`${cx + dx},${cz + dz}`) ?? []) best = Math.min(best, Math.hypot(p.x - q.x, p.z - q.z));
      }
    }
  }
  return best;
}

/** Every object reachable from `root` (arrays and plain objects), with a flag when one is reached twice. */
function walkObjects(root: unknown): { objects: Set<object>; shared: object[] } {
  const objects = new Set<object>();
  const shared: object[] = [];
  const visit = (v: unknown) => {
    if (v === null || typeof v !== "object") return;
    if (objects.has(v)) {
      shared.push(v);
      return;
    }
    objects.add(v);
    for (const child of Object.values(v)) visit(child);
  };
  visit(root);
  return { objects, shared };
}

describe("layout values (brief + rulings + owner changes)", () => {
  it("walk bounds, spawn, ring road, sidewalk", () => {
    expect(L.walkBounds).toEqual({ minX: -95, maxX: 95, minZ: -95, maxZ: 95 });
    expect(L.spawn.x).toBe(0);
    expect(L.spawn.z).toBe(14);
    expect(L.spawn.jitter).toBe(3);
    // Facing north (-z): yaw = atan2(dirX, dirZ) = atan2(0, -1) = PI (yaw 0 faces +z).
    expect(L.spawn.yaw).toBeCloseTo(Math.atan2(0, -1), 12);
    // ...which is toward the fountain: the direction from the spawn to the fountain's centre.
    const f = L.plaza.fountain.centre;
    expect(L.spawn.yaw).toBeCloseTo(Math.atan2(f.x - L.spawn.x, f.z - L.spawn.z), 12);
    expect(L.ringRoad).toEqual({ centre: { x: 0, z: 0 }, radius: 34, width: 6, sidewalk: { width: 2, side: "outer" } });
    expect([RING_INNER, RING_OUTER, SIDEWALK_OUTER]).toEqual([31, 37, 39]);
  });

  it("plaza: a big fountain plaza (owner changes 2026-11-03), not a tree", () => {
    expect(L.plaza.centre).toEqual({ x: 0, z: 0 });
    expect(L.plaza.fountain).toEqual({ centre: { x: 0, z: 0 }, basinDiameter: 16, collider: { x: 12, z: 12 } });
    expect(L.plaza.paving).toEqual({ centre: { x: 0, z: 0 }, radius: 30 });
    expect(L.plaza.zelkova.collider).toEqual({ x: 5, z: 5 });
    expect(L.plaza.zelkova.deck).toEqual({ shape: "round", diameter: 5 });
    expect(L.plaza).not.toHaveProperty("trunk");
    expect(L.plaza).not.toHaveProperty("deck");
    expect(L.plaza.benches).toHaveLength(8);
    expect(L.plaza.lamps.length).toBeGreaterThanOrEqual(4);
  });

  it("the creek: a curving stream south of the plots in contiguous segments, 6 m of water, a 4 m bridge gap", () => {
    expect(STREAM.width).toBe(6);
    expect(STREAM.segments.length).toBeGreaterThanOrEqual(4);
    expect(STREAM.segments[0].minX).toBe(L.walkBounds.minX);
    expect(STREAM.segments[STREAM.segments.length - 1].maxX).toBe(L.walkBounds.maxX);
    for (let i = 1; i < STREAM.segments.length; i++) expect(STREAM.segments[i].minX, `segment ${i}`).toBe(STREAM.segments[i - 1].maxX);
    // A curve, not a straight line: the centre line moves, gently (at most 3 m a step).
    const zs = STREAM.segments.map((s) => s.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < zs.length; i++) expect(Math.abs(zs[i] - zs[i - 1]), `step ${i}`).toBeLessThanOrEqual(3);
    // The banks: 3 m of solid ground on each side of the water, so the barrier is 12 m thick, far more than one legal step.
    expect(STREAM.bankWidth).toBe(3);
    for (const [i, b] of BANKS.entries()) expect(b.maxZ - b.minZ, `barrier ${i}`).toBeGreaterThan(MAX_STEP + 2 * PLAYER_RADIUS + 3);
    // Neighbouring bands overlap in z, so the barrier is one connected band.
    for (let i = 1; i < BANDS.length; i++) expect(BANDS[i].minZ, `join ${i}`).toBeLessThan(BANDS[i - 1].maxZ);
    for (let i = 1; i < BANKS.length; i++) expect(BANKS[i].minZ, `bank join ${i}`).toBeLessThan(BANKS[i - 1].maxZ);
    expect(GAP.maxX - GAP.minX).toBe(4);
  });

  it("the bridge spans the water exactly: the gap's x and the band of the one segment that holds the gap", () => {
    const holders = STREAM.segments.filter((s) => GAP.minX >= s.minX && GAP.maxX <= s.maxX);
    expect(holders).toHaveLength(1); // the gap does not straddle a join
    const band = segmentBand(STREAM, holders[0]);
    expect(L.bridge).toEqual({ minX: GAP.minX, maxX: GAP.maxX, minZ: band.minZ, maxZ: band.maxZ });
  });

  it("pavilion and bus stop (shelter visual, parked bus 8 x 2.5 on the outer side of the road)", () => {
    expect(L.pavilion).toEqual({ centre: { x: -16, z: 62 }, size: { x: 5, z: 5 } });
    expect(L.busStop.bus.size).toEqual({ x: 2.5, z: 8 });
    const bus = boxOf(L.busStop.bus);
    // On the road: every corner within the band, and on the outer half (beyond the road's centre line).
    for (const x of [bus.minX, bus.maxX]) {
      for (const z of [bus.minZ, bus.maxZ]) {
        const r = Math.hypot(x, z);
        expect(r, `corner (${x}, ${z})`).toBeGreaterThanOrEqual(RING_INNER);
        expect(r, `corner (${x}, ${z})`).toBeLessThanOrEqual(RING_OUTER + 0.05);
      }
    }
    expect(Math.hypot(L.busStop.bus.centre.x, L.busStop.bus.centre.z)).toBeGreaterThan(L.ringRoad.radius);
    // The shelter stands on the sidewalk.
    const shelter = boxOf(L.busStop.shelter);
    expect(distToBox({ x: 0, z: 0 }, shelter)).toBeGreaterThanOrEqual(RING_OUTER);
    const shelterR = Math.hypot(L.busStop.shelter.centre.x, L.busStop.shelter.centre.z);
    expect(shelterR).toBeGreaterThanOrEqual(RING_OUTER);
    expect(shelterR).toBeLessThanOrEqual(SIDEWALK_OUTER);
  });

  it("six 18 x 18 plots on a ring of about 58 m: ids, labels, sign text, plot_n due north, plot_w under construction", () => {
    expect(L.plots.map((p) => [p.id, p.size.x, p.size.z])).toEqual(
      ["plot_n", "plot_ne", "plot_e", "plot_w", "plot_nw", "plot_s"].map((id) => [id, 18, 18]),
    );
    expect(plot("plot_n").centre).toEqual({ x: 0, z: -58 });
    for (const p of L.plots) expect(Math.hypot(p.centre.x, p.centre.z), p.id).toBeGreaterThan(57);
    for (const p of L.plots) expect(Math.hypot(p.centre.x, p.centre.z), p.id).toBeLessThan(59);
    // plot_n holds the memorial hall (no sign); the rest are empty with an upcoming label.
    expect(plot("plot_n").sign).toBeNull();
    expect(plot("plot_n").signPost).toBeNull();
    expect(plot("plot_n").label.length).toBeGreaterThan(0);
    const upcoming: Record<string, string> = { plot_w: "도서관", plot_e: "학교", plot_ne: "성당", plot_nw: "절", plot_s: "교회" };
    for (const [id, label] of Object.entries(upcoming)) {
      expect(plot(id as PlotId).label, id).toBe(label);
      expect(plot(id as PlotId).sign, id).toBe("곧 지어져요");
    }
    expect(L.plots.filter((p) => p.underConstruction).map((p) => p.id)).toEqual(["plot_w"]);
  });

  it("memorial exterior: 14 x 12 centred on plot_n, door on the south face, pad 0.4 m outside the façade, arrival 2.2 m south", () => {
    const ex = L.memorial.exterior;
    expect(ex.centre).toEqual(plot("plot_n").centre);
    expect(ex.size).toEqual({ x: 14, z: 12 });
    expect(boxAt(ex.centre, ex.size)).toEqual({ minX: -7, maxX: 7, minZ: -64, maxZ: -52 });
    expect(ex.doorSide).toBe("s");
    expect(ex.doorPad.radius).toBe(1.6);
    expect(ex.doorPad.centre.x).toBe(0);
    expect(ex.doorPad.centre.z).toBeCloseTo(-52 + 0.4, 9); // the façade is z = -52
    expect(ex.arrival.x).toBe(0);
    expect(ex.arrival.z).toBeCloseTo(ex.doorPad.centre.z + 2.2, 9);
    expect(ex.arrival.yaw).toBe(0); // faces +z, away from the building
  });

  it("memorial interior (unchanged): origin (300, 0), 9 x 12, ceiling 3.4, pad (300, 5.2), spawn (300, 3.6)", () => {
    const inn = L.memorial.interior;
    expect(inn.origin).toEqual({ x: 300, z: 0 });
    expect(inn.size).toEqual({ x: 9, z: 12 });
    expect(inn.room).toEqual({ minX: 295.5, maxX: 304.5, minZ: -6, maxZ: 6 });
    expect(inn.ceilingHeight).toBe(3.4);
    expect(inn.doorSide).toBe("s");
    expect(inn.doorPad).toEqual({ centre: { x: 300, z: 5.2 }, radius: 1.4 });
    expect(inn.spawn.x).toBe(300);
    expect(inn.spawn.z).toBe(3.6);
    // A new arrival is not standing inside the inside door pad: 1.6 m from its centre, 0.2 m outside its edge.
    expect(Math.hypot(inn.spawn.x - inn.doorPad.centre.x, inn.spawn.z - inn.doorPad.centre.z)).toBeCloseTo(1.6, 9);
    expect(inn.spawn.yaw).toBeCloseTo(Math.PI, 12); // facing -z
  });

  it("ten small coloured houses, a café and its flower kiosk, each with a colour and a door side; none enterable", () => {
    const houses = L.sceneryHouses.filter((h) => h.kind === "house");
    const cafes = L.sceneryHouses.filter((h) => h.kind === "cafe");
    const kiosks = L.sceneryHouses.filter((h) => h.kind === "kiosk");
    expect(houses).toHaveLength(10);
    expect(cafes).toHaveLength(1);
    expect(kiosks).toHaveLength(1);
    // Every pastel twice (houses 6-10 came with the model, Task 6).
    expect(houses.map((h) => h.colour).sort()).toEqual(
      ["mint", "mint", "pink", "pink", "skyblue", "skyblue", "white", "white", "yellow", "yellow"],
    );
    expect(cafes[0].colour).toBe("wood");
    expect(kiosks[0].colour).toBe("wood");
    expect(kiosks[0].size).toEqual({ x: 4, z: 3 });
    expect(new Set(L.sceneryHouses.map((h) => h.id)).size).toBe(12);
    for (const h of L.sceneryHouses) {
      expect(h.enterable, h.id).toBe(false);
      expect(["n", "s", "e", "w"], h.id).toContain(h.doorSide);
    }
    for (const h of houses) expect(h.size, h.id).toEqual({ x: 8, z: 6 });
    expect(cafes[0].size.x * cafes[0].size.z).toBeGreaterThan(8 * 6);
  });

  it("backdrop: the waterfall back-left and the lake with a pavilion on the right, outside the walk bounds", () => {
    const { waterfall, lake } = L.backdrop;
    const wf = boxOf(waterfall);
    const lk = boxOf(lake);
    const lp = boxOf(lake.pavilion);
    for (const [name, b] of [["waterfall", wf], ["lake", lk], ["lake pavilion", lp]] as const) {
      expect(overlaps(b, L.walkBounds), name).toBe(false);
    }
    expect(waterfall.centre.x).toBeLessThan(L.walkBounds.minX); // left
    expect(waterfall.centre.z).toBeLessThan(0); // back (north)
    expect(waterfall.facing).toBe("e"); // the falls face the village
    expect(lake.centre.x).toBeGreaterThan(L.walkBounds.maxX); // right
    // The pavilion sits at the lake (inside its rectangle).
    expect(lp.minX).toBeGreaterThanOrEqual(lk.minX);
    expect(lp.maxX).toBeLessThanOrEqual(lk.maxX);
    expect(lp.minZ).toBeGreaterThanOrEqual(lk.minZ);
    expect(lp.maxZ).toBeLessThanOrEqual(lk.maxZ);
  });

  it("areas: village = walk bounds, hall = the interior rectangle", () => {
    expect(Object.keys(L.areas).sort()).toEqual(["hall", "village"]);
    expect(L.areas.village).toEqual(L.walkBounds);
    expect(L.areas.hall).toEqual(L.memorial.interior.room);
    expect(L.areas.hall).toEqual({ minX: 295.5, maxX: 304.5, minZ: -6, maxZ: 6 });
  });
});

describe("memorial hall cubby walls (Task 8)", () => {
  const inn = L.memorial.interior;
  const anchors = cubbyAnchors(L);
  const [back, east] = inn.cubbyWalls;

  it("a white-lacquer back wall of 20 x 7 and a light-oak east wall of 18 x 7, cubbies 0.40 m with 0.025 m boards", () => {
    expect(inn.cubbyWalls).toHaveLength(2);
    expect(back).toMatchObject({ wall: "n", finish: "lacquer", cols: 20, rows: 7, cell: 0.4, frame: 0.025 });
    expect(east).toMatchObject({ wall: "e", finish: "oak", cols: 18, rows: 7, cell: 0.4, frame: 0.025 });
    expect(back.yaw).toBeCloseTo(0, 12); // faces +z, into the room
    expect(east.yaw).toBeCloseTo(-Math.PI / 2, 12); // faces -x
  });

  it("one anchor per cubby (266), ids <wall>_<row>_<col> unique, nodes anchor__cubby_<id>", () => {
    expect(anchors).toHaveLength(20 * 7 + 18 * 7);
    expect(new Set(anchors.map((a) => a.id)).size).toBe(anchors.length);
    expect(anchors[0]).toMatchObject({ id: "n_0_0", wall: "n", row: 0, col: 0 });
    expect(cubbyAnchorNode("e_6_17")).toBe("anchor__cubby_e_6_17");
    expect(anchors.some((a) => a.id === "e_6_17")).toBe(true);
  });

  it("anchors sit on the opening plane, 0.425 m apart, the bottom one 0.345 m up and the top one under the ceiling", () => {
    const at = (id: string) => anchors.find((a) => a.id === id)!;
    expect(at("n_0_0").z).toBeCloseTo(-6 + 0.39, 9);
    expect(at("n_0_1").x - at("n_0_0").x).toBeCloseTo(0.425, 9);
    expect(at("n_1_0").y - at("n_0_0").y).toBeCloseTo(0.425, 9);
    expect(at("n_0_0").y).toBeCloseTo(0.12 + 0.025 + 0.2, 9);
    expect(at("n_6_0").y + 0.2 + 0.025).toBeLessThan(inn.ceilingHeight);
    expect(at("e_0_0").x).toBeCloseTo(304.5 - 0.39, 9);
    expect(at("e_0_1").z - at("e_0_0").z).toBeCloseTo(0.425, 9);
    // the back run ends where the east unit's front face is; the east run starts at the back unit's front face
    expect(at("n_0_19").x + 0.2 + 0.025).toBeCloseTo(304.5 - 0.39, 9);
    expect(at("e_0_0").z - 0.2 - 0.025).toBeCloseTo(-6 + 0.39, 9);
    for (const a of anchors) {
      expect(inside(HALL, { x: a.x, z: a.z }), a.id).toBe(true);
      expect(a.yaw).toBe(a.wall === "n" ? back.yaw : east.yaw);
    }
  });

  it("the units stand against their walls, inside the room, clear of each other, the door pad and the spawn", () => {
    const nb = cubbyWallBox(back);
    const eb = cubbyWallBox(east);
    expect(nb).toEqual({ minX: 295.585, maxX: 304.11, minZ: -6, maxZ: -5.61 });
    expect(eb).toEqual({ minX: 304.11, maxX: 304.5, minZ: -5.61, maxZ: 2.065 });
    expect(overlaps(nb, eb)).toBe(false);
    const pad = inn.doorPad;
    for (const b of [nb, eb]) {
      expect(b.minX >= HALL.minX && b.maxX <= HALL.maxX && b.minZ >= HALL.minZ && b.maxZ <= HALL.maxZ).toBe(true);
      expect(distToBox(pad.centre, b)).toBeGreaterThan(pad.radius + 1);
      expect(distToBox(HALL_SPAWN, b)).toBeGreaterThan(1);
    }
  });

  it("the colliders generated from memorial.glb hold the hall walls exactly, both units, and keep the door pad and the spawn free", () => {
    for (const w of hallWalls(L)) expect(MEMORIAL_COLLIDERS.some((c) => sameBox(c, w)), JSON.stringify(w)).toBe(true);
    const inside = MEMORIAL_COLLIDERS.filter((c) => !hallWalls(L).some((w) => sameBox(c, w)));
    expect(inside.length).toBeGreaterThanOrEqual(2);
    for (const c of inside) {
      expect(c.minX >= HALL.minX - EPS && c.maxX <= HALL.maxX + EPS && c.minZ >= HALL.minZ - EPS && c.maxZ <= HALL.maxZ + EPS).toBe(true);
      expect(distToBox(inn.doorPad.centre, c)).toBeGreaterThan(inn.doorPad.radius);
      expect(distToBox(HALL_SPAWN, c)).toBeGreaterThan(PLAYER_RADIUS);
    }
    // the cubby units are camera boxes up to the ceiling
    expect(MEMORIAL_CAMERA_BOXES.filter((b) => (b.height ?? 0) >= 3.4 - EPS).length).toBeGreaterThanOrEqual(6);
  });

  it("exports the walls with their footprints and every anchor with its node name", () => {
    const out = exportVillageLayout(L).memorial.interior;
    expect(out.cubbyWalls.map((w) => w.footprint)).toEqual([cubbyWallBox(back), cubbyWallBox(east)]);
    expect(out.cubbyAnchors).toHaveLength(anchors.length);
    for (const a of out.cubbyAnchors) expect(a.node).toBe(`anchor__cubby_${a.id}`);
  });
});

describe("the layout is deeply frozen and shares nothing between fields", () => {
  it("every object and array in it is frozen, and a write throws", () => {
    const { objects } = walkObjects(L);
    expect(objects.size).toBeGreaterThan(50);
    for (const o of objects) expect(Object.isFrozen(o), JSON.stringify(o).slice(0, 60)).toBe(true);
    expect(() => {
      (L.spawn as { x: number }).x = 1;
    }).toThrow(TypeError);
    expect(() => {
      (L.plots as unknown as unknown[]).push({});
    }).toThrow(TypeError);
    expect(() => {
      (L.areas.village as { minX: number }).minX = 0;
    }).toThrow(TypeError);
  });

  it("no object is reachable twice (areas.village is not walkBounds, areas.hall is not interior.room, plots do not share a size)", () => {
    expect(walkObjects(L).shared).toEqual([]);
    expect(L.areas.village).not.toBe(L.walkBounds);
    expect(L.areas.hall).not.toBe(L.memorial.interior.room);
    expect(L.plots[0].size).not.toBe(L.plots[1].size);
    expect(L.sceneryHouses[0].size).not.toBe(L.sceneryHouses[1].size);
  });
});

describe("layout sanity (nothing is built on the water, the road or each other)", () => {
  const plotBoxes = L.plots.map((p): [string, AABB] => [p.id, boxOf(p)]);
  const houseBoxes = L.sceneryHouses.map((h): [string, AABB] => [h.id, boxOf(h)]);
  const footprints: Array<[string, AABB]> = [...plotBoxes, ...houseBoxes, ["pavilion", boxOf(L.pavilion)]];

  it("every footprint and every collider is inside the walk bounds", () => {
    for (const [name, b] of footprints) {
      expect(b.minX, name).toBeGreaterThanOrEqual(L.walkBounds.minX);
      expect(b.maxX, name).toBeLessThanOrEqual(L.walkBounds.maxX);
      expect(b.minZ, name).toBeGreaterThanOrEqual(L.walkBounds.minZ);
      expect(b.maxZ, name).toBeLessThanOrEqual(L.walkBounds.maxZ);
    }
    for (const c of greyboxColliders(L)) {
      expect(c.box.minX, c.id).toBeGreaterThanOrEqual(L.walkBounds.minX);
      expect(c.box.maxX, c.id).toBeLessThanOrEqual(L.walkBounds.maxX);
      expect(c.box.minZ, c.id).toBeGreaterThanOrEqual(L.walkBounds.minZ);
      expect(c.box.maxZ, c.id).toBeLessThanOrEqual(L.walkBounds.maxZ);
    }
  });

  it("no plot, house or pavilion overlaps the creek, the bridge, another footprint, or reaches the ring road's sidewalk", () => {
    for (const [name, b] of footprints) {
      for (const bank of BANKS) expect(overlaps(b, bank), `${name} in the creek`).toBe(false);
      expect(overlaps(b, L.bridge), `${name} on the bridge`).toBe(false);
      if (name !== "pavilion") expect(distToBox({ x: 0, z: 0 }, b), `${name} on the sidewalk`).toBeGreaterThanOrEqual(SIDEWALK_OUTER);
    }
    for (let i = 0; i < footprints.length; i++) {
      for (let j = i + 1; j < footprints.length; j++) {
        expect(overlaps(footprints[i][1], footprints[j][1]), `${footprints[i][0]} / ${footprints[j][0]}`).toBe(false);
      }
    }
  });

  it("houses and the café sit between the ring road and the plots, their doors toward the road", () => {
    for (const h of L.sceneryHouses) {
      const b = boxOf(h);
      expect(distToBox({ x: 0, z: 0 }, b), `${h.id} nearest`).toBeGreaterThanOrEqual(SIDEWALK_OUTER);
      expect(h.doorSide, h.id).toBe(sideTowardPlaza(h.centre));
      for (const [pid, pb] of plotBoxes) expect(overlaps(b, pb), `${h.id} / ${pid}`).toBe(false);
      // Its near side closer to the plaza than the plot ring's middle: between the road and the plots.
      expect(distToBox({ x: 0, z: 0 }, b), h.id).toBeLessThan(plot("plot_n").centre.z * -1);
      expect(h.size, h.id).toEqual(SCENERY_SIZES[h.kind]);
    }
  });

  it("the creek lies south of every plot", () => {
    for (const p of L.plots) expect(plotBox(p.id).maxZ, p.id).toBeLessThanOrEqual(WATER_MIN_Z);
    // The pavilion is on the north bank, a few metres from the creek's solid bank.
    const gapToBank = bankAt(L.pavilion.centre.x).minZ - boxOf(L.pavilion).maxZ;
    expect(gapToBank).toBeGreaterThan(2);
    expect(gapToBank).toBeLessThan(10);
  });

  it("the originally planned house position (52, 30) was in the old stream; the new layout has no house near the creek", () => {
    for (const h of L.sceneryHouses) expect(distToBox({ x: h.centre.x, z: WATER_MIN_Z }, boxOf(h)), h.id).toBeGreaterThan(20);
  });

  it("memorial footprint sits inside plot_n with the arrival and the door pad", () => {
    const fp = boxAt(L.memorial.exterior.centre, L.memorial.exterior.size);
    const pn = plotBox("plot_n");
    expect(fp.minX).toBeGreaterThanOrEqual(pn.minX);
    expect(fp.maxX).toBeLessThanOrEqual(pn.maxX);
    expect(fp.minZ).toBeGreaterThanOrEqual(pn.minZ);
    expect(fp.maxZ).toBeLessThanOrEqual(pn.maxZ);
    for (const p of [PAD.centre, L.memorial.exterior.arrival]) expect(inside(pn, p)).toBe(true);
  });

  it("plaza: paving inside the ring road, basin inside the paving, benches and lamps on the paving, zelkova deck on the paving's edge", () => {
    const f = L.plaza.fountain;
    const z = L.plaza.zelkova;
    expect(L.plaza.paving.radius).toBeLessThanOrEqual(RING_INNER - 1);
    expect(f.basinDiameter / 2).toBeLessThan(L.plaza.paving.radius);
    expect(f.collider.x / 2).toBeLessThanOrEqual(f.basinDiameter / 2); // the box's sides are inside the round basin
    expect(L.plaza.paving.centre).toEqual(L.ringRoad.centre);
    // Round deck: diameter = collider size; its whole box is inside the paving and at least 1 m from the ring road's inner edge.
    expect(z.deck.diameter).toBe(z.collider.x);
    expect(z.deck.diameter).toBe(z.collider.z);
    const deck = boxOf({ centre: z.centre, size: z.collider });
    expect(farCorner(deck)).toBeLessThanOrEqual(L.plaza.paving.radius);
    expect(RING_INNER - farCorner(deck)).toBeGreaterThanOrEqual(1);
    // ...clear of the fountain's collider and its basin.
    expect(overlaps(boxOf({ centre: f.centre, size: f.collider }), deck)).toBe(false);
    expect(Math.hypot(z.centre.x, z.centre.z) - z.deck.diameter / 2).toBeGreaterThan(f.basinDiameter / 2);
    // Visual props stand on the paving, never inside a collider; benches face the fountain.
    const solids = greyboxColliders(L).map((c) => c.box);
    for (const p of [...L.plaza.benches, ...L.plaza.lamps]) {
      expect(Math.hypot(p.x, p.z), JSON.stringify(p)).toBeLessThan(L.plaza.paving.radius);
      for (const s of solids) expect(distToBox(p, s), JSON.stringify(p)).toBeGreaterThan(0.5);
    }
    for (const b of L.plaza.benches) expect(b.yaw).toBeCloseTo(Math.atan2(-b.x, -b.z), 3);
  });

  it("sign posts: only for built-or-not plots as planned, inside the plot at the edge facing the plaza", () => {
    for (const p of L.plots) {
      expect(p.signPost === null, p.id).toBe(p.sign === null);
      if (p.signPost === null) continue;
      const b = boxOf(p);
      expect(inside(b, p.signPost), p.id).toBe(true);
      expect(p.signPost.facing, p.id).toBe(sideTowardPlaza(p.centre));
      const edge = { n: b.minZ, s: b.maxZ, e: b.maxX, w: b.minX }[p.signPost.facing];
      const along = p.signPost.facing === "n" || p.signPost.facing === "s" ? p.signPost.z : p.signPost.x;
      expect(Math.abs(along - edge), p.id).toBeLessThanOrEqual(1.5); // on that edge
    }
  });

  it("lanes: plot lanes run from the paving's edge to the plot's sign post (or the memorial door), the bridge lane to the bridge", () => {
    const lane = (id: string) => L.lanes.find((l) => l.id === id)!;
    expect(new Set(L.lanes.map((l) => l.id)).size).toBe(L.lanes.length);
    for (const p of L.plots) {
      const l = lane(`lane_${p.id}`);
      expect(l, p.id).toBeDefined();
      const start = l.points[0];
      const end = l.points[l.points.length - 1];
      expect(Math.hypot(start.x, start.z), `${p.id} start`).toBeCloseTo(L.plaza.paving.radius, 1);
      const target = p.signPost ?? PAD.centre;
      expect(Math.hypot(end.x - target.x, end.z - target.z), `${p.id} end`).toBeLessThanOrEqual(1.6);
    }
    const bridge = lane("lane_bridge");
    const bEnd = bridge.points[bridge.points.length - 1];
    expect(bEnd.x).toBeGreaterThanOrEqual(GAP.minX);
    expect(bEnd.x).toBeLessThanOrEqual(GAP.maxX);
    expect(bEnd.z).toBeCloseTo(L.bridge.minZ, 9);
    const bus = lane("lane_bus");
    expect(distToBox(bus.points[bus.points.length - 1], boxOf(L.busStop.shelter))).toBeLessThanOrEqual(1);
  });

  it("every lane is clear of every collider by at least its half width (a body can walk its whole length)", () => {
    const solids = greyboxColliders(L);
    for (const l of L.lanes) {
      for (const p of laneSamples(l)) {
        for (const s of solids) expect(distToBox(p, s.box), `${l.id} / ${s.id} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBeGreaterThanOrEqual(l.width / 2 - EPS);
      }
    }
  });
});

describe("village colliders are built from the layout", () => {
  const colliders = greyboxColliders(L);
  const box = (id: string) => colliders.find((c) => c.id === id)!.box;

  it("greybox list: unique ids for plaza, creek, pavilion, bus, memorial pieces, houses and café", () => {
    const ids = colliders.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // unique, so Task 7's col__<id> names can match
    for (const id of ["plaza_fountain", "plaza_zelkova", "pavilion", "bus", "cafe"]) expect(ids).toContain(id);
    expect(ids).not.toContain("plaza_trunk");
    expect(ids).not.toContain("plaza_deck");
    expect(ids.filter((i) => i.startsWith("memorial_"))).toHaveLength(3);
    expect(ids.filter((i) => i.startsWith("house_"))).toHaveLength(10);
    expect(ids).toContain("kiosk");
    // One box per creek segment, the gap segment in two.
    expect(ids.filter((i) => i.startsWith("stream_bank_"))).toHaveLength(STREAM.segments.length + 1);
    for (const c of colliders) expect(colliderNode(c.id)).toBe(`col__${c.id}`);
  });

  it("plaza colliders: 12 x 12 fountain centred on the plaza, 5 x 5 zelkova deck at the plaza edge", () => {
    expect(box("plaza_fountain")).toEqual({ minX: -6, maxX: 6, minZ: -6, maxZ: 6 });
    expect(box("plaza_zelkova")).toEqual(boxOf({ centre: L.plaza.zelkova.centre, size: L.plaza.zelkova.collider }));
  });

  it("parked bus 8 x 2.5, scenery colliders match the layout footprints", () => {
    expect(box("bus")).toEqual(boxOf(L.busStop.bus));
    expect(box("cafe")).toEqual(boxOf(L.sceneryHouses.find((h) => h.kind === "cafe")!));
    expect(box("house_3")).toEqual({ minX: 25, maxX: 33, minZ: 34, maxZ: 40 });
  });

  it("the creek is walled off over its whole length except the bridge gap: boxes follow the curve, water plus 3 m of bank each side", () => {
    const banks = colliders.filter((c) => c.id.startsWith("stream_bank_"));
    for (const seg of STREAM.segments) {
      const band = segmentBank(STREAM, seg);
      const pieces = banks.filter((b) => b.box.minX >= seg.minX && b.box.maxX <= seg.maxX);
      expect(pieces.length, `segment at z ${seg.z}`).toBeGreaterThan(0);
      for (const p of pieces) {
        expect(p.box.minZ).toBe(band.minZ);
        expect(p.box.maxZ).toBe(band.maxZ);
      }
    }
    const west = banks.find((b) => b.box.maxX === GAP.minX)!;
    const east = banks.find((b) => b.box.minX === GAP.maxX)!;
    expect(west).toBeDefined();
    expect(east).toBeDefined();
  });

  it("changing a layout value moves its collider (values and collider list are separate)", () => {
    const moved = greyboxColliders({ ...L, pavilion: { ...L.pavilion, centre: { x: -16, z: 66 } } });
    expect(moved.find((c) => c.id === "pavilion")!.box).toEqual({ minX: -18.5, maxX: -13.5, minZ: 63.5, maxZ: 68.5 });
    expect(box("pavilion")).toEqual({ minX: -18.5, maxX: -13.5, minZ: 59.5, maxZ: 64.5 });
  });

  it("buildVillageGeometry takes a named collider list or the extractor's { obstacles, cameraBoxes }", () => {
    const fixed = hallWalls(L).length + areaGapBlockers(L).length + hallSurroundBlockers(L).length;
    const bare = buildVillageGeometry(L, []);
    expect(bare.obstacles).toHaveLength(fixed);
    expect(bare.cameraBoxes).toEqual(hallWalls(L));
    const box = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
    const one = buildVillageGeometry(L, [{ id: "x", box, camera: false }]);
    expect(one.obstacles).toHaveLength(fixed + 1);
    expect(one.cameraBoxes).toHaveLength(hallWalls(L).length);
    const tall = { ...box, height: 3 };
    const generated = buildVillageGeometry(L, { obstacles: [box], cameraBoxes: [tall] });
    expect(generated.obstacles).toHaveLength(fixed + 1);
    expect(generated.obstacles.at(-1)).toEqual(box);
    expect(generated.cameraBoxes).toEqual([...hallWalls(L), tall]); // the height is kept
    expect(generated.bounds).toEqual(bare.bounds);
  });

  it("the greybox build: the colliders flagged camera are the buildings (houses, café, kiosk, bus, memorial)", () => {
    const geo = buildVillageGeometry(L, colliders);
    for (const c of colliders) {
      expect(geo.obstacles, c.id).toContainEqual(c.box);
      expect(geo.cameraBoxes.some((b) => sameBox(b, c.box)), c.id).toBe(c.camera);
    }
    expect(colliders.filter((c) => c.camera).map((c) => c.id.split("_")[0]).sort()).toEqual(
      ["bus", "cafe", "kiosk", ...Array<string>(10).fill("house"), "memorial", "memorial", "memorial"].sort(),
    );
  });
});

describe("villageGeometry plays on the colliders generated from village.glb (Task 7)", () => {
  const colliders = greyboxColliders(L);

  it("id 'village', bounds spanning both areas, the hall's walls as camera boxes, then the generated boxes", () => {
    expect(villageGeometry.id).toBe("village");
    expect(villageGeometry.bounds).toEqual(villageBounds(L));
    expect(villageGeometry.bounds).toEqual({ minX: -95, maxX: 310, minZ: -95, maxZ: 95 }); // the hall's walls plus a 5 m apron
    for (const w of hallWalls(L)) expect(villageGeometry.cameraBoxes).toContainEqual(w);
    expect(villageGeometry).toEqual(buildVillageGeometry(L, VILLAGE_MODEL_COLLIDERS, HALL_MODEL_COLLIDERS, guideColliders())); // + the guides (Task 9A)
    expect(VILLAGE_MODEL_COLLIDERS.obstacles).toBe(VILLAGE_COLLIDERS);
    expect(VILLAGE_MODEL_COLLIDERS.cameraBoxes).toBe(VILLAGE_CAMERA_BOXES);
    for (const b of VILLAGE_COLLIDERS) expect(villageGeometry.obstacles).toContainEqual(b);
    for (const b of VILLAGE_CAMERA_BOXES) expect(villageGeometry.cameraBoxes).toContainEqual(b);
  });

  it("the model holds every layout box at its exact rectangle, a camera box exactly where the layout says camera", () => {
    for (const c of colliders) {
      expect(VILLAGE_COLLIDERS.some((b) => sameBox(b, c.box)), c.id).toBe(true);
      expect(VILLAGE_CAMERA_BOXES.some((b) => sameBox(b, c.box)), c.id).toBe(c.camera);
    }
  });

  it("the generated list is the model's: far more boxes than the layout's, every camera box among them and taller than 1.6 m", () => {
    expect(VILLAGE_COLLIDERS.length).toBeGreaterThan(colliders.length + 100); // benches, planters, walls, gardens, trunks...
    for (const b of VILLAGE_CAMERA_BOXES) {
      expect(VILLAGE_COLLIDERS.some((o) => sameBox(o, b)), JSON.stringify(b)).toBe(true);
      expect(b.height ?? 0).toBeGreaterThanOrEqual(1.6);
    }
    for (const b of VILLAGE_COLLIDERS) {
      expect(b.minX).toBeLessThan(b.maxX);
      expect(b.minZ).toBeLessThan(b.maxZ);
      expect(b.minX).toBeGreaterThanOrEqual(L.walkBounds.minX);
      expect(b.maxX).toBeLessThanOrEqual(L.walkBounds.maxX);
      expect(b.minZ).toBeGreaterThanOrEqual(L.walkBounds.minZ);
      expect(b.maxZ).toBeLessThanOrEqual(L.walkBounds.maxZ);
    }
  });
});

describe("the hall's interior plays on the colliders generated from memorial.glb (Task 9)", () => {
  const isHallWall = (b: AABB) => hallWalls(L).some((w) => sameBox(w, b));

  it("every generated box is an obstacle of the walk geometry (the four walls once, as the geometry's walls)", () => {
    for (const b of MEMORIAL_COLLIDERS) expect(villageGeometry.obstacles).toContainEqual(b);
    const inside = MEMORIAL_COLLIDERS.filter((b) => !isHallWall(b));
    expect(HALL_MODEL_COLLIDERS.obstacles).toEqual(inside);
    for (const w of hallWalls(L)) expect(villageGeometry.obstacles.filter((o) => sameBox(o, w))).toHaveLength(1);
    // the furniture really is there: the sofa, the bench, the memorial table, both cubby units
    expect(inside.length).toBe(MEMORIAL_COLLIDERS.length - 4);
    expect(isBlocked(300.6, -1.6, PLAYER_RADIUS, villageGeometry.obstacles)).toBe(true); // the bench
    expect(isBlocked(304.3, 0, PLAYER_RADIUS, villageGeometry.obstacles)).toBe(true); // the east cubby unit
  });

  it("every generated camera box is a camera box of the geometry, plus the ceiling slab", () => {
    // the walls are the geometry's own walls (camera boxes as tall as a wall); everything else comes as generated
    for (const b of MEMORIAL_CAMERA_BOXES.filter((c) => !isHallWall(c))) expect(villageGeometry.cameraBoxes).toContainEqual(b);
    for (const w of hallWalls(L)) expect(villageGeometry.cameraBoxes).toContainEqual(w);
    expect(villageGeometry.cameraBoxes).toContainEqual(hallCeilingSlab(L));
    expect(hallInteriorColliders(L).cameraBoxes.at(-1)).toEqual(hallCeilingSlab(L));
  });

  it("the ceiling slab is derived from ceilingHeight: underside 3.3 (brief), over the room and its walls", () => {
    const slab = hallCeilingSlab(L);
    const { ceilingHeight, room } = L.memorial.interior;
    expect(slab.minY).toBeCloseTo(ceilingHeight - HALL_CEILING_DROP, 9);
    expect(slab.minY).toBe(3.3);
    expect(slab.height).toBeCloseTo(ceilingHeight + HALL_CEILING_DROP, 9);
    for (const w of hallWalls(L)) {
      expect(slab.minX).toBeLessThanOrEqual(w.minX);
      expect(slab.maxX).toBeGreaterThanOrEqual(w.maxX);
      expect(slab.minZ).toBeLessThanOrEqual(w.minZ);
      expect(slab.maxZ).toBeGreaterThanOrEqual(w.maxZ);
    }
    expect(slab.minX).toBeLessThan(room.minX);
    // a lower ceiling moves the slab with it
    const low = { ...L, memorial: { ...L.memorial, interior: { ...L.memorial.interior, ceilingHeight: 3 } } };
    expect(hallCeilingSlab(low).minY).toBeCloseTo(2.9, 9);
  });

  it("the slab is a camera box only: a body under it is not blocked", () => {
    expect(villageGeometry.obstacles.some((o) => sameBox(o, hallCeilingSlab(L)))).toBe(false);
    expect(isBlocked(L.memorial.interior.spawn.x, L.memorial.interior.spawn.z, PLAYER_RADIUS, villageGeometry.obstacles)).toBe(false);
  });

  it("without a hall list the room is empty (the greybox): the furniture comes only from the model", () => {
    const grey = buildVillageGeometry(L, greyboxColliders(L));
    expect(grey.obstacles.some((o) => inside(HALL, centre(o)))).toBe(false);
    expect(villageGeometry.obstacles.some((o) => inside(HALL, centre(o)))).toBe(true);
  });
});

/** The layout's own list built into a map (the greybox the game played on before the model). */
const GREYBOX_GEOMETRY: MapGeometry = buildVillageGeometry(L, greyboxColliders(L));

/** Every geometry the village invariants must hold for: the layout's greybox, and the one generated from the model. */
const GEOMETRIES: Array<[string, MapGeometry]> = [
  ["greybox", GREYBOX_GEOMETRY],
  ["generated from village.glb", villageGeometry],
];

describe.each(GEOMETRIES)("village geometry invariants: %s", (_name, geo) => {
  const obstacles = geo.obstacles;

  it("bounds span the village and the hall, and the camera boxes include the hall walls", () => {
    for (const a of [L.areas.village, L.areas.hall]) {
      expect(geo.bounds.minX).toBeLessThanOrEqual(a.minX);
      expect(geo.bounds.maxX).toBeGreaterThanOrEqual(a.maxX);
      expect(geo.bounds.minZ).toBeLessThanOrEqual(a.minZ);
      expect(geo.bounds.maxZ).toBeGreaterThanOrEqual(a.maxZ);
    }
    expect(geo.id).toBe("village");
  });

  describe("spawn", () => {
    it("is at least 1.4 m from every collider, and the whole spawn disk (jitter + body) is clear", () => {
      for (const o of obstacles) expect(distToBox(SPAWN, o), JSON.stringify(o)).toBeGreaterThanOrEqual(1.4);
      expect(isBlocked(SPAWN.x, SPAWN.z, L.spawn.jitter + PLAYER_RADIUS, obstacles, 0)).toBe(false);
    });

    it("the clearance check is not vacuous: a crate 1 m from the spawn fails it", () => {
      const bad = withExtra(geo, { minX: 1, maxX: 2, minZ: SPAWN.z - 0.5, maxZ: SPAWN.z + 0.5 });
      expect(bad.obstacles.some((o) => distToBox(SPAWN, o) < 1.4)).toBe(true);
      expect(isBlocked(SPAWN.x, SPAWN.z, L.spawn.jitter + PLAYER_RADIUS, bad.obstacles, 0)).toBe(true); // the crate is inside the 3.4 m disk
    });

    it("lies on the paving, south of the fountain, inside the village area", () => {
      const f = L.plaza.fountain.centre;
      expect(Math.hypot(SPAWN.x - f.x, SPAWN.z - f.z)).toBeLessThan(L.plaza.paving.radius);
      expect(SPAWN.z).toBeGreaterThan(f.z + L.plaza.fountain.collider.z / 2);
      expect(inside(L.areas.village, SPAWN)).toBe(true);
    });
  });

  it("no collider overlaps the bridge walkway (banks and bridge only touch at the gap's x)", () => {
    for (const o of obstacles) expect(overlaps(o, L.bridge), JSON.stringify(o)).toBe(false);
    // Not vacuous: a plank across the bridge does overlap it.
    expect(overlaps({ minX: GAP.minX + 1, maxX: GAP.maxX - 1, minZ: L.bridge.minZ + 2, maxZ: L.bridge.maxZ - 2 }, L.bridge)).toBe(true);
  });

  describe("reachability (0.5 m grid flood fill over isBlocked)", () => {
    const r = villageFill(geo);
    /** The creek's bridge walkway blocked: the creek then has no crossing at all. */
    const bridgeBlocked = withExtra(geo, L.bridge);
    const cut = villageFill(bridgeBlocked);
    /** Some cell of `cells` stands within 1 m of the box (it can be walked up to). */
    const walkUpTo = (cells: readonly Point2[], b: AABB) => cells.some((p) => distToBox(p, b) <= 1);
    /** A cell in the creek's band or on the south bank (the far side of the water). */
    const pastTheWater = (p: Point2) => p.z >= bandAt(p.x).minZ;

    it("the village really was walked", () => {
      expect(r.length).toBeGreaterThan(100000);
      expect(r.every((p) => inside(L.areas.village, p))).toBe(true);
    });

    it("every plot, house, the café, the pavilion and the bus stop can be reached from the spawn, without the bridge", () => {
      for (const p of L.plots) {
        expect(cut.some((q) => inside(boxOf(p), q)), p.id).toBe(true);
        if (p.sign !== null) {
          // The empty plots can be walked onto: their centres are free and reached (plot markers are not colliders).
          expect(hasNear(cut, p.centre, GRID), p.id).toBe(true);
          expect(isBlocked(p.centre.x, p.centre.z, PLAYER_RADIUS, obstacles), p.id).toBe(false);
        }
      }
      for (const h of L.sceneryHouses) expect(walkUpTo(cut, boxOf(h)), h.id).toBe(true);
      expect(walkUpTo(cut, boxOf(L.pavilion))).toBe(true);
      expect(walkUpTo(cut, boxOf(L.busStop.shelter))).toBe(true);
      expect(walkUpTo(cut, boxOf(L.busStop.bus))).toBe(true);
      expect(cut.length).toBeGreaterThan(90000);
    });

    it("the memorial door pad and the arrival spot are reachable, without the bridge", () => {
      expect(hasNear(cut, PAD.centre, GRID)).toBe(true);
      expect(isBlocked(PAD.centre.x, PAD.centre.z, PLAYER_RADIUS, obstacles)).toBe(false);
      const arrival = L.memorial.exterior.arrival;
      expect(hasNear(cut, arrival, GRID)).toBe(true);
      expect(isBlocked(arrival.x, arrival.z, PLAYER_RADIUS, obstacles)).toBe(false);
    });

    it("the plaza can be walked: round the fountain, round the zelkova's deck, and the whole ring road's inner lane", () => {
      const f = L.plaza.fountain.collider;
      for (const q of [{ x: 0, z: f.z / 2 + 2 }, { x: 0, z: -f.z / 2 - 2 }, { x: f.x / 2 + 2, z: 0 }, { x: -f.x / 2 - 2, z: 0 }]) {
        expect(hasNear(r, q, GRID), `fountain side ${JSON.stringify(q)}`).toBe(true);
      }
      expect(r.some((p) => inside(boxAt(L.plaza.fountain.centre, f), p))).toBe(false);
      const z = boxOf({ centre: L.plaza.zelkova.centre, size: L.plaza.zelkova.collider });
      for (const q of [
        { x: z.minX - 1, z: L.plaza.zelkova.centre.z },
        { x: z.maxX + 1, z: L.plaza.zelkova.centre.z },
        { x: L.plaza.zelkova.centre.x, z: z.minZ - 1 },
        { x: L.plaza.zelkova.centre.x, z: z.maxZ + 1 },
      ]) {
        expect(hasNear(r, q, GRID), JSON.stringify(q)).toBe(true);
      }
      expect(r.some((p) => inside(z, p))).toBe(false);
      // The road's inner lane (1 m inside the band; the parked bus takes only the outer lane).
      const c = L.ringRoad.centre;
      const lane = RING_INNER + 1;
      for (let deg = 0; deg < 360; deg += 5) {
        const a = (deg * Math.PI) / 180;
        const q = { x: c.x + lane * Math.cos(a), z: c.z + lane * Math.sin(a) };
        expect(isBlocked(q.x, q.z, PLAYER_RADIUS, obstacles), `${deg} deg`).toBe(false);
        expect(hasNear(r, q, GRID), `${deg} deg`).toBe(true);
      }
    });

    it("every lane can be walked along its whole length", () => {
      for (const l of L.lanes) {
        for (const p of laneSamples(l, 0.5)) {
          expect(isBlocked(p.x, p.z, PLAYER_RADIUS, obstacles), `${l.id} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBe(false);
        }
      }
    });

    it("the creek is crossed only by the bridge: every cell in the water band lies on the bridge, and both banks are reached", () => {
      const inBand = r.filter((p) => p.z >= bandAt(p.x).minZ && p.z <= bandAt(p.x).maxZ);
      expect(inBand.length).toBeGreaterThan(10); // the bridge itself was walked
      expect(inBand.every((p) => p.x >= GAP.minX && p.x <= GAP.maxX)).toBe(true);
      expect(r.some((p) => p.z < WATER_MIN_Z - 3)).toBe(true);
      expect(r.some((p) => p.z > bandAt(p.x).maxZ + 3)).toBe(true); // the south bank, over the bridge
    });

    it("with the bridge blocked no path to the south bank exists: not one cell in the band or beyond", () => {
      expect(cut.some(pastTheWater)).toBe(false);
      // Not vacuous: with the bridge the south bank is walked, up to the map edge and in the corners.
      expect(hasNear(r, { x: GAP.minX + 2, z: L.walkBounds.maxZ - 2 }, GRID)).toBe(true);
      expect(hasNear(r, { x: L.walkBounds.maxX - 2, z: L.walkBounds.maxZ - 2 }, GRID)).toBe(true);
      expect(hasNear(cut, { x: GAP.minX + 2, z: L.walkBounds.maxZ - 2 }, GRID)).toBe(false);
      expect(hasNear(cut, { x: L.walkBounds.maxX - 2, z: L.walkBounds.maxZ - 2 }, GRID)).toBe(false);
    });

    it("a plank across only half of the bridge does not cut the village (the cut above needs the whole walkway)", () => {
      const half = villageFill(withExtra(geo, { minX: GAP.minX, maxX: (GAP.minX + GAP.maxX) / 2, minZ: L.bridge.minZ, maxZ: L.bridge.maxZ }));
      expect(half.some(pastTheWater)).toBe(true); // squeezing past on the other half
    });
  });

  describe("fine grid (0.1 m): a gap that a body fits through but the 0.5 m grid can miss", () => {
    /** The creek and a little land on both sides; one fill covers its whole length (not the whole village). */
    const creekWindow: Bounds = { minX: L.walkBounds.minX, maxX: L.walkBounds.maxX, minZ: Math.min(...BANKS.map((b) => b.minZ)) - 4, maxZ: L.walkBounds.maxZ };
    /** A free spot on the north bank of every segment (the gap's segment: just west of the gap), 1.5 m from the bank. */
    const seeds: Point2[] = STREAM.segments.map((s) => {
      const holdsGap = GAP.minX >= s.minX && GAP.maxX <= s.maxX;
      return { x: holdsGap ? GAP.minX - 3 : (s.minX + s.maxX) / 2, z: segmentBank(STREAM, s).minZ - 1.5 };
    });
    const fillFrom = (g: MapGeometry): Point2[] => seeds.flatMap((s) => reachable(windowed(g, creekWindow), s, FINE_GRID, 0));
    const inBand = (p: Point2) => p.z >= bandAt(p.x).minZ && p.z <= bandAt(p.x).maxZ;
    const inGap = (p: Point2) => p.x >= GAP.minX && p.x <= GAP.maxX;

    it("with the bridge blocked the north bank cannot reach one cell of the water or the south bank", () => {
      const cells = fillFrom(withExtra(geo, L.bridge));
      expect(cells.length).toBeGreaterThan(100000); // the north bank really was walked, from every segment
      expect(cells.filter((p) => p.z >= bandAt(p.x).minZ)).toEqual([]);
    });

    it("with the bridge open every cell in the water lies on the bridge, and the south bank is reached over it", () => {
      const cells = fillFrom(geo);
      expect(cells.filter((p) => inBand(p) && !inGap(p))).toEqual([]);
      expect(cells.some((p) => inBand(p) && inGap(p))).toBe(true);
      expect(cells.some((p) => p.z > bandAt(p.x).maxZ + 3)).toBe(true);
    });

    it("a 0.95 m hole through a bank (a body of 0.8 m fits) is found at 0.1 m, though the 0.5 m grid misses it", () => {
      // The hole x 10.12..11.07: the free centres are x 10.51..10.68, between the 0.5 m grid's nodes (10.5 and 11.0).
      const bank = geo.obstacles.find((o) => o.minX <= 10 && o.maxX >= 11.07 && o.minZ < 80 && o.maxZ > 80 && o.maxX - o.minX > 5)!;
      expect(bank).toBeDefined();
      const holed = makeGeometry(
        "village",
        geo.bounds,
        [],
        [...geo.obstacles.filter((o) => o !== bank), { ...bank, maxX: 10.12 }, { ...bank, minX: 11.07 }],
      );
      const plugged = withExtra(holed, L.bridge);
      expect(fillFrom(plugged).filter((p) => p.z >= bandAt(p.x).minZ).length).toBeGreaterThan(0); // fine grid: leak found
      expect(villageFill(plugged).some((p) => p.z >= bandAt(p.x).minZ)).toBe(false); // coarse grid: blind to it
    });

    it("the hall is sealed at 0.1 m too: nothing outside the room within 1.5 m, and without the south wall the fill leaves it", () => {
      const room: Bounds = { minX: HALL.minX - 1.5, maxX: HALL.maxX + 1.5, minZ: HALL.minZ - 1.5, maxZ: HALL.maxZ + 1.5 };
      const cells = reachable(windowed(geo, room), HALL_SPAWN, FINE_GRID, 0);
      expect(cells.length).toBeGreaterThan(5000);
      expect(cells.every((p) => inside(HALL, p))).toBe(true);
      // Not vacuous: the south wall and everything beyond it removed.
      const noSouth = without(geo, (o) => o.minZ >= HALL.maxZ && o.minX < HALL.minX + 1 && o.maxX > HALL.maxX - 1);
      expect(reachable(windowed(noSouth, room), HALL_SPAWN, FINE_GRID, 0).some((p) => !inside(HALL, p))).toBe(true);
    });
  });

  describe("legal steps (the server judges only where a Move lands, and one Move can be up to 4.8 m)", () => {
    const window: Bounds = { minX: L.walkBounds.minX, maxX: L.walkBounds.maxX, minZ: Math.min(...BANKS.map((b) => b.minZ)) - 4, maxZ: L.walkBounds.maxZ };
    const northSeed = { x: -80, z: bankAt(-80).minZ - 1.5 };
    const southSeed = { x: 10, z: bankAt(10).maxZ + 1.5 };
    const sidesOf = (g: MapGeometry) => {
      const plugged = windowed(withExtra(g, L.bridge), window);
      return { north: reachable(plugged, northSeed, 0.25, 0), south: reachable(plugged, southSeed, 0.25, 0) };
    };

    it("the maximum step is 4.8 m", () => {
      expect(MAX_STEP).toBeCloseTo(4.8, 9);
    });

    it("no single legal step hops the creek: the free ground north and south of it (bridge blocked) is more than one step apart", () => {
      const { north, south } = sidesOf(geo);
      expect(north.length).toBeGreaterThan(5000);
      expect(south.length).toBeGreaterThan(5000);
      expect(hasNear(north, southSeed, 0.5)).toBe(false); // really two sides
      expect(minDistance(north, south)).toBeGreaterThan(MAX_STEP);
    });

    it("the step check is not vacuous: with only the water band solid (no banks) a step hops across the corner where two segments meet", () => {
      const thinLayout = { ...L, stream: { ...STREAM, bankWidth: 0 } };
      const thin = buildVillageGeometry(thinLayout, greyboxColliders(thinLayout));
      const { north, south } = sidesOf(thin);
      expect(minDistance(north, south)).toBeLessThanOrEqual(MAX_STEP);
    });
  });

  describe("grid-free coverage (exact interval checks)", () => {
    /** x values worth testing: every box and segment edge, and the middle of every slab between them. */
    const xs = (() => {
      const edges = new Set<number>([L.walkBounds.minX, L.walkBounds.maxX, GAP.minX, GAP.maxX]);
      for (const s of STREAM.segments) {
        edges.add(s.minX);
        edges.add(s.maxX);
      }
      for (const o of obstacles) {
        if (o.maxZ > WATER_MIN_Z && o.minZ < L.walkBounds.maxZ) {
          for (const x of [o.minX, o.maxX]) if (x >= L.walkBounds.minX && x <= L.walkBounds.maxX) edges.add(x);
        }
      }
      const sorted = [...edges].sort((a, b) => a - b);
      const mids = sorted.slice(1).map((x, i) => (x + sorted[i]) / 2);
      return [...sorted, ...mids];
    })();

    it("the obstacles cover the creek's whole band at every x, except exactly the bridge gap", () => {
      for (const x of xs) {
        const band = bandAt(x);
        const intervals = zIntervalsAt(obstacles, x);
        if (x > GAP.minX && x < GAP.maxX) {
          // The bridge: nothing of the band is covered.
          expect(intervals.filter(([lo, hi]) => hi > band.minZ + EPS && lo < band.maxZ - EPS), `bridge at x=${x}`).toEqual([]);
        } else {
          expect(covers(intervals, band.minZ, band.maxZ), `band at x=${x}`).toBe(true);
        }
      }
      // The gap is exactly as wide as the bridge: just beyond its edges the band is covered again.
      for (const x of [GAP.minX - 0.01, GAP.maxX + 0.01]) {
        expect(covers(zIntervalsAt(obstacles, x), bandAt(x).minZ, bandAt(x).maxZ), `x=${x}`).toBe(true);
      }
      for (const x of [GAP.minX + 0.01, GAP.maxX - 0.01]) {
        expect(covers(zIntervalsAt(obstacles, x), bandAt(x).minZ, bandAt(x).maxZ), `x=${x}`).toBe(false);
      }
    });

    it("the check is not vacuous: a 0.3 m hole in a bank, anywhere, fails it", () => {
      const holed = geo.obstacles.flatMap((o) => (o.minX <= -60 && o.maxX >= -59.7 && o.maxZ - o.minZ === STREAM.width + 2 * STREAM.bankWidth ? [{ ...o, maxX: -60 }, { ...o, minX: -59.7 }] : [o]));
      expect(holed.length).toBe(geo.obstacles.length + 1);
      expect(covers(zIntervalsAt(holed, -59.85), bandAt(-59.85).minZ, bandAt(-59.85).maxZ)).toBe(false);
    });

    it("the hall's walls form a closed ring: the union of the obstacles covers every edge of the room, corners included", () => {
      const edges: Array<[string, (o: AABB) => boolean, (o: AABB) => [number, number], number, number]> = [
        ["north", (o) => o.minZ <= HALL.minZ && o.maxZ >= HALL.minZ, (o) => [o.minX, o.maxX], HALL.minX, HALL.maxX],
        ["south", (o) => o.minZ <= HALL.maxZ && o.maxZ >= HALL.maxZ, (o) => [o.minX, o.maxX], HALL.minX, HALL.maxX],
        ["west", (o) => o.minX <= HALL.minX && o.maxX >= HALL.minX, (o) => [o.minZ, o.maxZ], HALL.minZ, HALL.maxZ],
        ["east", (o) => o.minX <= HALL.maxX && o.maxX >= HALL.maxX, (o) => [o.minZ, o.maxZ], HALL.minZ, HALL.maxZ],
      ];
      for (const [side, touches, interval, from, to] of edges) {
        // The room's own boundary line: the walls are attached outside it, so they touch (share) the line.
        expect(covers(obstacles.filter(touches).map(interval), from, to), `${side} edge`).toBe(true);
      }
      // Not vacuous: a 0.3 m gap in the south wall breaks it.
      const gapped = obstacles.flatMap((o) =>
        o.minZ === HALL.maxZ && o.minX < HALL.minX && o.maxX > HALL.maxX ? [{ ...o, maxX: 299.8 }, { ...o, minX: 300.1 }] : [o],
      );
      const south = gapped.filter((o) => o.minZ <= HALL.maxZ && o.maxZ >= HALL.maxZ).map((o): [number, number] => [o.minX, o.maxX]);
      expect(covers(south, HALL.minX, HALL.maxX)).toBe(false);
    });
  });

  describe("the two areas", () => {
    it("the village's east edge is sealed from the hall: from the spawn nothing past x = 95 and nothing in the hall is reachable", () => {
      const r = villageFill(geo);
      expect(r.some((p) => p.x > L.walkBounds.maxX)).toBe(false);
      expect(r.some((p) => p.x >= HALL.minX - 1)).toBe(false);
      expect(r.some((p) => inside(HALL, p))).toBe(false);
    });

    it("the sealing check is not vacuous: without the gap blocker the village walks all the way to the hall", () => {
      const blockers = areaGapBlockers(L);
      expect(blockers.length).toBeGreaterThan(0);
      const open = without(geo, (o) => blockers.some((b) => sameBox(b, o)));
      expect(villageFill(open).some((p) => p.x > 250)).toBe(true);
    });

    it("the gap blocker spans the full z range of the bounds and runs from the village edge to the hall wall", () => {
      for (const b of areaGapBlockers(L)) {
        expect(b.minX).toBe(L.walkBounds.maxX);
        expect(b.minZ).toBeLessThanOrEqual(geo.bounds.minZ);
        expect(b.maxZ).toBeGreaterThanOrEqual(geo.bounds.maxZ);
        expect(b.maxX).toBe(L.areas.hall.minX - 0.5); // the hall's outer west wall face
      }
    });

    it("interior: the inside spawn and the inside door pad are reachable, and the hall is a sealed room", () => {
      const r = reachable(geo, HALL_SPAWN, GRID, 1.5);
      expect(r.length).toBeGreaterThan(250); // the room really was walked (Task 9: around the furniture)
      expect(r.every((p) => inside(HALL, p))).toBe(true); // sealed: not a single cell outside the room, even with a 1.5 m margin
      const doorPad = L.memorial.interior.doorPad;
      expect(hasNear(r, doorPad.centre, GRID)).toBe(true);
      expect(isBlocked(doorPad.centre.x, doorPad.centre.z, PLAYER_RADIUS, obstacles)).toBe(false);
      expect(hasNear(r, { x: HALL.minX + 1, z: HALL.minZ + 1 }, GRID)).toBe(true); // the far corner too
      expect(inside(HALL, HALL_SPAWN)).toBe(true);
      expect(isBlocked(HALL_SPAWN.x, HALL_SPAWN.z, PLAYER_RADIUS, obstacles)).toBe(false);
    });

    it("the sealed-room check is not vacuous: with the south wall gone the fill leaves the room", () => {
      const noSouth = without(geo, (o) => o.minZ >= HALL.maxZ && o.minX < HALL.minX + 1 && o.maxX > HALL.maxX - 1);
      expect(reachable(noSouth, HALL_SPAWN, GRID, 1.5).some((p) => !inside(HALL, p))).toBe(true);
    });

    it("from the hall nothing of the village is reachable", () => {
      expect(reachable(geo, HALL_SPAWN, GRID, 1.5).some((p) => p.x < HALL.minX)).toBe(false);
    });

    it("the hall walls are outside the room (a body fits right into the room's free south-west corner)", () => {
      for (const w of hallWalls(L)) expect(overlaps(w, HALL), JSON.stringify(w)).toBe(false);
      expect(isBlocked(HALL.minX + 0.4, HALL.maxZ - 0.4, PLAYER_RADIUS, obstacles)).toBe(false);
    });

    it("a hop over a wall lands in a blocker: every spot outside the room, around it and across the gap, is blocked", () => {
      // The server judges where a move LANDS (it does not sweep): (300, 5.5) -> (300, 7.2) clears the 0.5 m south wall.
      expect(isBlocked(300, 7.2, PLAYER_RADIUS, obstacles)).toBe(true);
      expect(isBlocked(300, -7.2, PLAYER_RADIUS, obstacles)).toBe(true);
      expect(isBlocked(293, 0, PLAYER_RADIUS, obstacles)).toBe(true);
      expect(isBlocked(304.6, 0, PLAYER_RADIUS, obstacles)).toBe(true); // the east wall, where the clamp puts an outward step
      // ...and a lattice over everything between the village and the hall's far side, outside the room, is blocked.
      let free = 0;
      for (let x = L.walkBounds.maxX + 0.5; x <= geo.bounds.maxX; x += 0.5) {
        for (let z = geo.bounds.minZ; z <= geo.bounds.maxZ; z += 0.5) {
          if (isBlocked(x, z, PLAYER_RADIUS, obstacles)) continue;
          if (!inside(HALL, { x, z })) free++;
        }
      }
      expect(free).toBe(0);
    });

    it("all ground within 5 m of the hall's walls is solid (a step of up to 4.8 m cannot end on free ground), corners included", () => {
      expect(HALL_APRON).toBeGreaterThanOrEqual(5);
      const t = 0.5;
      const w = { minX: HALL.minX - t, maxX: HALL.maxX + t, minZ: HALL.minZ - t, maxZ: HALL.maxZ + t };
      const inBounds = (p: Point2) => inside(geo.bounds, p);
      let probed = 0;
      for (let d = 0.1; d <= 5.001; d += 0.1) {
        for (let u = -5; u <= 5; u += 0.25) {
          const points: Point2[] = [
            { x: w.minX + u + (w.maxX - w.minX) / 2, z: w.minZ - d }, // north of the wall
            { x: w.minX + u + (w.maxX - w.minX) / 2, z: w.maxZ + d }, // south
            { x: w.minX - d, z: w.minZ + u + (w.maxZ - w.minZ) / 2 }, // west
            { x: w.maxX + d, z: w.minZ + u + (w.maxZ - w.minZ) / 2 }, // east
          ];
          for (const q of points) {
            if (!inBounds(q)) continue;
            probed++;
            expect(isBlocked(q.x, q.z, PLAYER_RADIUS, obstacles), `(${q.x.toFixed(2)}, ${q.z.toFixed(2)})`).toBe(true);
          }
        }
      }
      expect(probed).toBeGreaterThan(3000);
      // Every box around the hall is at least 5 m thick in its short direction.
      for (const b of hallSurroundBlockers(L)) expect(Math.min(b.maxX - b.minX, b.maxZ - b.minZ)).toBeGreaterThanOrEqual(5);
    });

    it("the hop check is not vacuous: without the blockers around the hall the strip beside its wall is open", () => {
      const surround = [...hallSurroundBlockers(L), ...areaGapBlockers(L)];
      const bare = without(geo, (o) => surround.some((b) => sameBox(b, o)));
      expect(isBlocked(300, 7.2, PLAYER_RADIUS, bare.obstacles)).toBe(false);
    });
  });

  describe("the memorial door", () => {
    const pieces = greyboxColliders(L).filter((c) => c.id.startsWith("memorial_"));
    const fp = boxAt(L.memorial.exterior.centre, L.memorial.exterior.size);
    const area = (b: AABB) => (b.maxX - b.minX) * (b.maxZ - b.minZ);

    it("the whole door pad disc is free of colliders, and its centre is a legal place to stand", () => {
      for (const o of obstacles) expect(distToBox(PAD.centre, o), JSON.stringify(o)).toBeGreaterThanOrEqual(PAD.radius - EPS);
      expect(isBlocked(PAD.centre.x, PAD.centre.z, PLAYER_RADIUS, obstacles)).toBe(false);
    });

    it("the pad check is not vacuous: the solid footprint (no recess) would put a collider inside the pad", () => {
      expect(distToBox(PAD.centre, fp)).toBeLessThan(PAD.radius);
    });

    it("the pieces tile the footprint apart from a pad-wide recess at the door (greybox)", () => {
      if (geo !== GREYBOX_GEOMETRY) return; // the layout's pieces (the generated list holds the same three boxes, see above)
      for (const p of pieces) {
        expect(p.box.minX, p.id).toBeGreaterThanOrEqual(fp.minX - EPS);
        expect(p.box.maxX, p.id).toBeLessThanOrEqual(fp.maxX + EPS);
        expect(p.box.minZ, p.id).toBeGreaterThanOrEqual(fp.minZ - EPS);
        expect(p.box.maxZ, p.id).toBeLessThanOrEqual(fp.maxZ + EPS);
      }
      for (let i = 0; i < pieces.length; i++) {
        for (let j = i + 1; j < pieces.length; j++) expect(overlaps(pieces[i].box, pieces[j].box)).toBe(false);
      }
      const recess = 2 * PAD.radius * (fp.maxZ - (PAD.centre.z - PAD.radius));
      expect(pieces.reduce((s, p) => s + area(p.box), 0)).toBeCloseTo(area(fp) - recess, 9);
      // The rest of the footprint is solid: the back, both sides and the front corners.
      for (const q of [{ x: 0, z: -62 }, { x: -5, z: -58 }, { x: 5, z: -58 }, { x: -4, z: -52.5 }, { x: 4, z: -52.5 }]) {
        expect(isBlocked(q.x, q.z, 0.05, pieces.map((c) => c.box), 0), JSON.stringify(q)).toBe(true);
      }
    });
  });
});

describe("export for the Blender scripts", () => {
  const out = exportVillageLayout(L);

  it("is plain JSON: it survives a stringify/parse round trip unchanged", () => {
    expect(JSON.parse(JSON.stringify(out))).toStrictEqual(out);
  });

  it("carries every section a Blender script needs", () => {
    for (const key of [
      "walkBounds", "spawn", "plaza", "ringRoad", "busStop", "stream", "bridge", "pavilion", "lanes", "plots", "memorial", "sceneryHouses",
      "backdrop", "areas", "colliders", "areaGapBlockers",
    ]) {
      expect(out, key).toHaveProperty(key);
    }
    expect(out.memorial).toHaveProperty("exterior");
    expect(out.memorial).toHaveProperty("interior");
    expect(out.plots).toHaveLength(6);
    expect(out.sceneryHouses).toHaveLength(12);
    expect(out.areas).toEqual({ village: L.areas.village, hall: L.areas.hall });
  });

  it("every collider has its col__<id> node name, and so do the pieces listed under stream, memorial, bus and houses", () => {
    for (const c of out.colliders) expect(c.node).toBe(`col__${c.id}`);
    expect(out.colliders.map((c) => c.id)).toEqual(greyboxColliders(L).map((c) => c.id));
    for (const b of out.stream.banks) expect(b.node).toBe(`col__${b.id}`);
    for (const m of out.memorial.exterior.colliders) expect(m.node).toBe(`col__${m.id}`);
    expect(out.busStop.bus.node).toBe("col__bus");
    expect(out.pavilion.node).toBe("col__pavilion");
    expect(out.plaza.fountain.collider.node).toBe("col__plaza_fountain");
    expect(out.plaza.zelkova.collider.node).toBe("col__plaza_zelkova");
    for (const h of out.sceneryHouses) expect(h.node).toBe(`col__${h.id}`);
  });

  it("plots keep id, centre, size, label, sign, the sign post (position and facing), under-construction and a ready-made rectangle", () => {
    const n = out.plots.find((p) => p.id === "plot_n")!;
    expect(n).toMatchObject({ label: "추모관", sign: null, signPost: null, underConstruction: false, centre: { x: 0, z: -58 }, size: { x: 18, z: 18 }, bounds: { minX: -9, maxX: 9, minZ: -67, maxZ: -49 } });
    const w = out.plots.find((p) => p.id === "plot_w")!;
    expect(w).toMatchObject({ label: "도서관", sign: "곧 지어져요", underConstruction: true, signPost: { x: -48, z: 15, facing: "e" }, bounds: { minX: -65, maxX: -47, minZ: 6, maxZ: 24 } });
  });

  it("houses and the café export colour, door side, kind and rectangle", () => {
    const pink = out.sceneryHouses.find((h) => h.id === "house_1")!;
    expect(pink).toMatchObject({ kind: "house", colour: "pink", doorSide: "s", bounds: { minX: 17, maxX: 25, minZ: -45, maxZ: -39 } });
    const cafe = out.sceneryHouses.find((h) => h.kind === "cafe")!;
    expect(cafe).toMatchObject({ id: "cafe", doorSide: "w", colour: "wood", size: { x: 12, z: 9 } });
  });

  it("memorial exterior has footprint, door pad, arrival and collider pieces; interior has room, ceiling, door side, pad, spawn, walls and blockers", () => {
    expect(out.memorial.exterior.footprint).toEqual({ minX: -7, maxX: 7, minZ: -64, maxZ: -52 });
    expect(out.memorial.exterior.doorPad).toEqual(L.memorial.exterior.doorPad);
    expect(out.memorial.exterior.arrival).toEqual(L.memorial.exterior.arrival);
    expect(out.memorial.exterior.colliders).toHaveLength(3);
    expect(out.memorial.interior.room).toEqual(L.areas.hall);
    expect(out.memorial.interior.ceilingHeight).toBe(3.4);
    expect(out.memorial.interior.doorSide).toBe("s");
    expect(out.memorial.interior.doorPad).toEqual(L.memorial.interior.doorPad);
    expect(out.memorial.interior.spawn).toEqual(L.memorial.interior.spawn);
    expect(out.memorial.interior.walls).toHaveLength(4);
    expect(out.memorial.interior.blockers).toEqual(hallSurroundBlockers(L));
  });

  it("plaza, zelkova deck shape, bus stop, creek segments, lanes and backdrop are all there", () => {
    expect(out.plaza.fountain).toMatchObject({ centre: { x: 0, z: 0 }, basinDiameter: 16, collider: { size: { x: 12, z: 12 }, bounds: { minX: -6, maxX: 6, minZ: -6, maxZ: 6 } } });
    expect(out.plaza.paving).toEqual({ centre: { x: 0, z: 0 }, radius: 30 });
    expect(out.plaza.zelkova.deck).toEqual({ shape: "round", diameter: 5 });
    expect(out.plaza.benches).toHaveLength(8);
    expect(out.plaza.lamps.length).toBeGreaterThanOrEqual(4);
    expect(out.ringRoad.sidewalk).toEqual({ width: 2, side: "outer" });
    expect(out.busStop.bus.size).toEqual({ x: 2.5, z: 8 });
    expect(out.busStop.shelter).toHaveProperty("bounds");
    expect(out.stream.segments).toHaveLength(STREAM.segments.length);
    expect(out.stream.segments[0].water).toEqual({ minX: -95, maxX: -70, minZ: 67, maxZ: 73 });
    expect(out.stream.segments[0].bank).toEqual({ minX: -95, maxX: -70, minZ: 64, maxZ: 76 });
    expect(out.stream.bankWidth).toBe(3);
    expect(out.stream.bridgeGap).toEqual(GAP);
    expect(out.lanes.map((l) => l.id)).toEqual(L.lanes.map((l) => l.id));
    for (const p of L.plots) expect(out.lanes.some((l) => l.id === `lane_${p.id}`), p.id).toBe(true);
    expect(out.lanes.some((l) => l.id === "lane_bridge")).toBe(true);
    expect(out.lanes.some((l) => l.id === "lane_bus")).toBe(true);
    expect(out.backdrop.waterfall).toMatchObject({ height: 36, facing: "e", bounds: { minX: -132, maxX: -104, minZ: -85, maxZ: -71 } });
    expect(out.backdrop.lake.pavilion).toHaveProperty("bounds");
    expect(centre(out.plaza.fountain.collider.bounds)).toEqual({ x: 0, z: 0 });
  });
});
