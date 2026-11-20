import { describe, expect, it } from "vitest";
import { coasterTrack } from "../land/coaster";
import { coasterSupports } from "../land/coasterSupports";
import type { AABB } from "../collision";
import {
  PARK_WALL_PLAN,
  PARK_WALL_RECT,
  PARK_WALL_SOLIDS,
  VILLAGE_GATE_PASSAGE,
  VILLAGE_WALL_PLAN,
  VILLAGE_WALL_SOLIDS,
  WALL,
  distanceToWall,
} from "./parkWall";
import {
  CAROUSEL_PAD,
  COASTER_PAD,
  DROP_PAD,
  MOON_BOAT_PAD,
  PARK_ARRIVAL,
  PARK_BOUNDS,
  PARK_EXIT_PAD,
  PARK_PLAZA,
  PARK_SOLIDS,
  PARK_TREES,
  WHEEL_PAD,
  parkGateDoor,
  parkGeometry,
} from "./parkArea";
import { VILLAGE_LAYOUT, villageGeometry } from "./villageLayout";
import { villageLot } from "./villageLots";

const overlaps = (a: AABB, b: AABB) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;

describe("the castle wall in the park", () => {
  it("encloses the walk bounds: the bounds' edge is behind stone everywhere but the gate arch", () => {
    const B = PARK_BOUNDS;
    const R = PARK_WALL_RECT;
    expect(R.minX + WALL.halfThickness).toBeLessThanOrEqual(B.minX + 0.05);
    expect(R.maxX - WALL.halfThickness).toBeGreaterThanOrEqual(B.maxX - 0.05);
    // the north side: the runs reach into the arch's towers (x 29.5 .. 33, 47 .. 50.5)
    const north = PARK_WALL_PLAN.runs.filter((r) => r.out[1] < 0);
    expect(north).toHaveLength(2);
    expect(Math.max(north[0]!.ax, north[0]!.bx)).toBeGreaterThan(29.5);
    expect(Math.min(north[1]!.ax, north[1]!.bx)).toBeLessThan(50.5);
    // the coaster's circuit (south of the walk bounds) is inside the ring too
    expect(R.maxZ).toBeGreaterThan(70);
  });

  it("keeps the coaster's track and every support foot clear of the stone", () => {
    const t = coasterTrack();
    for (let i = 0; i < t.n; i += 3) expect(distanceToWall(PARK_WALL_PLAN, t.pos[3 * i]!, t.pos[3 * i + 2]!)).toBeGreaterThan(8);
    for (const sp of coasterSupports(t, "full")) for (const l of sp.legs) expect(distanceToWall(PARK_WALL_PLAN, l.foot[0], l.foot[2])).toBeGreaterThan(8);
  });

  it("keeps the rides' pads, the plaza, the arrival spot and the way out clear", () => {
    for (const p of [COASTER_PAD, CAROUSEL_PAD, WHEEL_PAD, MOON_BOAT_PAD, DROP_PAD, PARK_EXIT_PAD]) {
      for (const s of PARK_WALL_SOLIDS.obstacles) expect(overlaps(s, { minX: p.x - p.radius, maxX: p.x + p.radius, minZ: p.z - p.radius, maxZ: p.z + p.radius })).toBe(false);
    }
    expect(distanceToWall(PARK_WALL_PLAN, PARK_PLAZA.x, PARK_PLAZA.z)).toBeGreaterThan(60);
    expect(distanceToWall(PARK_WALL_PLAN, PARK_ARRIVAL.x, PARK_ARRIVAL.z)).toBeGreaterThan(10);
  });

  it("leaves the arch's passage open and seals the strip outside the wall", () => {
    const passage: AABB = { minX: 33.2, maxX: 46.8, minZ: -190, maxZ: -183 };
    for (const s of PARK_WALL_SOLIDS.obstacles) expect(overlaps(s, passage)).toBe(false);
    // west and east of the arch, nothing can be walked between the bounds' north edge and the wall
    for (const x of [-100, 0, 25, 55, 200, 370]) expect(PARK_WALL_SOLIDS.obstacles.some((s) => s.minX <= x && s.maxX >= x && s.minZ <= PARK_BOUNDS.minZ && s.maxZ > -185)).toBe(true);
  });

  it("is in the park's geometry (obstacles and camera boxes) and no tree stands in it", () => {
    for (const s of PARK_WALL_SOLIDS.obstacles) expect(PARK_SOLIDS).toContainEqual(s);
    for (const c of PARK_WALL_SOLIDS.cameraBoxes) expect(parkGeometry.cameraBoxes).toContainEqual(c);
    for (const t of PARK_TREES) expect(distanceToWall(PARK_WALL_PLAN, t.x, t.z)).toBeGreaterThan(3);
  });

  it("puts a tower at each corner and one at least every 55 m", () => {
    for (const r of PARK_WALL_PLAN.runs) {
      const len = Math.hypot(r.bx - r.ax, r.bz - r.az);
      const on = PARK_WALL_PLAN.towers.filter((t) => Math.abs((t.x - r.ax) * (r.bz - r.az) - (t.z - r.az) * (r.bx - r.ax)) / len < 0.01);
      expect(on.length).toBeGreaterThanOrEqual(Math.floor(len / 56));
    }
    expect(PARK_WALL_PLAN.towers.length).toBeGreaterThan(20);
  });
});

describe("the castle wall in the village", () => {
  const walk = VILLAGE_LAYOUT.walkBounds;

  it("takes no walkable ground: every solid lies beyond the walk bounds", () => {
    for (const s of VILLAGE_WALL_SOLIDS.obstacles) expect(overlaps(s, { minX: walk.minX, maxX: walk.maxX, minZ: walk.minZ, maxZ: walk.maxZ + 0.4 })).toBe(false);
  });

  it("runs into the gatehouse and leaves its passage open", () => {
    const gate = villageLot("lot_gate");
    expect(gate.centre.x).toBe(-24);
    const north = VILLAGE_WALL_PLAN.runs.filter((r) => r.out[1] < 0);
    expect(Math.max(north[0]!.ax, north[0]!.bx)).toBe(VILLAGE_GATE_PASSAGE.minX);
    expect(Math.min(north[1]!.ax, north[1]!.bx)).toBe(VILLAGE_GATE_PASSAGE.maxX);
    const passage: AABB = { minX: VILLAGE_GATE_PASSAGE.minX + 0.01, maxX: VILLAGE_GATE_PASSAGE.maxX - 0.01, minZ: 90, maxZ: 110 };
    for (const s of VILLAGE_WALL_SOLIDS.obstacles) expect(overlaps(s, passage)).toBe(false);
    // the gate's door pad still offers the way in
    const pad = parkGateDoor().pad;
    for (const s of VILLAGE_WALL_SOLIDS.obstacles) expect(overlaps(s, { minX: pad.x - pad.radius, maxX: pad.x + pad.radius, minZ: pad.z - pad.radius, maxZ: pad.z + pad.radius })).toBe(false);
  });

  it("encloses the park's skyline footprint (world x -94 .. 104, z 102 .. 209) and stays inside the outer ground", () => {
    const xs = VILLAGE_WALL_PLAN.runs.flatMap((r) => [r.ax, r.bx]);
    const zs = VILLAGE_WALL_PLAN.runs.flatMap((r) => [r.az, r.bz]);
    expect(Math.min(...xs)).toBeLessThan(-94 - 5);
    expect(Math.max(...xs)).toBeGreaterThan(104 + 3);
    expect(Math.min(...zs)).toBeLessThan(102);
    expect(Math.max(...zs)).toBeGreaterThan(205);
    for (const t of VILLAGE_WALL_PLAN.towers) expect(Math.hypot(t.x, t.z)).toBeLessThan(236);
  });

  it("is appended to the village geometry (obstacles and camera boxes), after everything else", () => {
    const n = VILLAGE_WALL_SOLIDS.obstacles.length;
    expect(villageGeometry.obstacles.slice(-n)).toEqual(VILLAGE_WALL_SOLIDS.obstacles);
    expect(villageGeometry.cameraBoxes.slice(-n)).toEqual(VILLAGE_WALL_SOLIDS.cameraBoxes);
  });
});
