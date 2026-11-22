import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENTRY_SPAWN,
  EXIT_PAD,
  HOUSE_BUDGET,
  HOUSE_FLOORS,
  HOUSE_FLOOR_AREAS,
  HOUSE_NODE,
  HOUSE_NODE_PATTERNS,
  HOUSE_NUMBERS,
  HOUSE_PAD_RADIUS,
  HOUSE_PLACES,
  HOUSE_POLICY,
  HOUSE_ROOM,
  HOUSE_SEAT_FURN,
  HOUSE_SEAT_FURN_KIND,
  HOUSE_SEAT_PLAN,
  HOUSE_SEAT_TOTAL,
  HOUSE_STAIR,
  HOUSE_STAIR_TYPE,
  SEAT_INDEX_SCHEMA,
  STAIR_PLANS,
  exteriorToLocal,
  houseBuildingId,
  houseContractJson,
  houseFiles,
  houseFloorArea,
  houseFloorBounds,
  houseFloorLabel,
  houseKeepClear,
  houseNumberOf,
  housePlacements,
  houseRequiredNodes,
  localToWorld,
  localYawToWorld,
  padUsableFrom,
  parseHouseFloorArea,
  seatApproach,
  seatCount,
  seatMarkerProblems,
  worldToLocal,
  worldYawToLocal,
  type HouseSeatMarker,
} from "./houseAreas";
import { VILLAGE_LAYOUT } from "./villageLayout";
import type { AABB } from "../collision";

const overlaps = (a: AABB, b: AABB) => a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
const inside = (p: { x: number; z: number }, b: AABB, margin = 0) =>
  p.x >= b.minX + margin && p.x <= b.maxX - margin && p.z >= b.minZ + margin && p.z <= b.maxZ - margin;
const ROOM: AABB = { minX: 0, maxX: HOUSE_ROOM.width, minZ: 0, maxZ: HOUSE_ROOM.depth };
const BODY = 0.4; // PLAYER_RADIUS

describe("houses and areas", () => {
  it("numbers the ten private houses of the village layout", () => {
    const ids = VILLAGE_LAYOUT.sceneryHouses.filter((h) => h.kind === "house").map((h) => h.id);
    expect([...ids].sort()).toEqual(HOUSE_NUMBERS.map(houseBuildingId).sort());
    expect(houseNumberOf("house_10")).toBe(10);
    expect(houseNumberOf("house_11")).toBeNull();
    expect(houseNumberOf("cafe")).toBeNull();
  });

  it("names every floor area house:<id>:<floor> and parses only those", () => {
    expect(houseFloorArea(3, 2)).toBe("house:house_3:2");
    expect(HOUSE_FLOOR_AREAS).toHaveLength(20);
    expect(new Set(HOUSE_FLOOR_AREAS).size).toBe(20);
    for (const a of HOUSE_FLOOR_AREAS) {
      const p = parseHouseFloorArea(a)!;
      expect(houseFloorArea(p.n, p.floor)).toBe(a);
    }
    for (const bad of ["house:house_1", "house:house_1:3", "house:house_11:1", "house:cafe:1", "hall", "village", "house:house_1:1:x"]) {
      expect(parseHouseFloorArea(bad)).toBeNull();
    }
    expect(houseFloorLabel(4, 1)).toBe("4번 집 · 1층");
  });

  it("keeps the owner's 2026-11-16 decisions", () => {
    expect(HOUSE_POLICY).toMatchObject({
      maxOccupants: 8,
      guideTellsCode: true,
      chatScope: "house",
      bedSit: "edge",
      cushionFacing: "table",
      windowView: "panorama",
      bathroom: "door-only",
      rememberCode: false,
      tinyFurnitureSittable: false,
    });
  });
});

describe("coordinates", () => {
  it("places floor 1 at (360 + 24 (N − 1), 0) and floor 2 at z 30, the visitor's right = world +x", () => {
    expect(localToWorld(1, 1, 0, 0)).toEqual({ x: 360, z: 0 });
    expect(localToWorld(10, 2, 0, 0)).toEqual({ x: 576, z: 30 });
    expect(localToWorld(2, 1, 10.6, 7.8)).toEqual({ x: 394.6, z: -7.8 });
    // coming in faces world −z (yaw π); local +x (the visitor's right) is world +x (yaw π/2)
    expect(localYawToWorld(0)).toBeCloseTo(Math.PI, 6);
    expect(localYawToWorld(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 6);
    expect(localYawToWorld(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 6);
    expect(Math.abs(localYawToWorld(Math.PI))).toBeCloseTo(0, 6);
  });

  it("round-trips points and yaws", () => {
    for (const n of HOUSE_NUMBERS) {
      for (const f of HOUSE_FLOORS) {
        for (const [lx, lz] of [[0, 0], [3.21, 6.5], [10.6, 7.8]] as const) {
          const w = localToWorld(n, f, lx, lz);
          expect(worldToLocal(n, f, w.x, w.z)).toEqual({ x: lx, z: lz });
        }
      }
    }
    for (const a of [0, 0.3, 1.2, -2.5, Math.PI / 2, 3]) {
      const back = worldYawToLocal(localYawToWorld(a));
      expect(Math.cos(back)).toBeCloseTo(Math.cos(a), 5);
      expect(Math.sin(back)).toBeCloseTo(Math.sin(a), 5);
    }
  });

  it("keeps the 20 floors apart from each other, the village and the hall (≥ 13 m between rooms)", () => {
    const grow = (b: AABB, d: number): AABB => ({ minX: b.minX - d, maxX: b.maxX + d, minZ: b.minZ - d, maxZ: b.maxZ + d });
    const floors = HOUSE_NUMBERS.flatMap((n) => HOUSE_FLOORS.map((f) => houseFloorBounds(n, f)));
    for (const b of floors) {
      expect(b.maxX - b.minX).toBeCloseTo(10.6, 6);
      expect(b.maxZ - b.minZ).toBeCloseTo(7.8, 6);
    }
    const gap = 13 / 2; // interior to interior (24 − 10.6 = 13.4 m in x, 30 − 7.8 = 22.2 m in z)
    for (let i = 0; i < floors.length; i++) {
      for (let j = i + 1; j < floors.length; j++) expect(overlaps(grow(floors[i]!, gap), grow(floors[j]!, gap))).toBe(false);
      expect(overlaps(grow(floors[i]!, 13), VILLAGE_LAYOUT.areas.village)).toBe(false);
      expect(overlaps(grow(floors[i]!, 13), VILLAGE_LAYOUT.areas.hall)).toBe(false);
    }
  });

  it("maps the exterior body onto the interior walls (door centre → front wall middle)", () => {
    expect(exteriorToLocal(0, 2.7)).toEqual({ x: 5.3, z: 0 });
    expect(exteriorToLocal(-5.15, -4.05)).toEqual({ x: 0, z: 7.8 });
    expect(exteriorToLocal(5.15, 2.7)).toEqual({ x: 10.6, z: 0 });
  });
});

describe("stairs and pads", () => {
  it("uses the design's stair types per house and its stair size", () => {
    expect(HOUSE_STAIR_TYPE).toEqual({ 1: "A", 2: "B", 3: "C", 4: "D", 5: "A", 6: "C", 7: "B", 8: "D", 9: "A", 10: "C" });
    expect(HOUSE_STAIR.risers * HOUSE_STAIR.riser).toBeCloseTo(HOUSE_ROOM.storey, 1);
    expect(HOUSE_STAIR.treads * HOUSE_STAIR.tread).toBeCloseTo(HOUSE_STAIR.run, 6);
    expect(HOUSE_STAIR.treads).toBe(HOUSE_STAIR.risers - 1);
  });

  it("matches design 3.1's footprints", () => {
    const fp = (t: "A" | "B" | "C" | "D") => STAIR_PLANS[t].footprint;
    expect(fp("A")).toEqual({ minX: 5.06, maxX: 10.5, minZ: 6.4, maxZ: 7.7 });
    expect(fp("B")).toEqual({ minX: 0.1, maxX: 5.54, minZ: 6.4, maxZ: 7.7 });
    expect(fp("C")).toEqual({ minX: 9.2, maxX: 10.5, minZ: 1.9, maxZ: 7.34 });
    expect(fp("D")).toEqual({ minX: 0.1, maxX: 1.4, minZ: 1.9, maxZ: 7.34 });
  });

  for (const t of ["A", "B", "C", "D"] as const) {
    it(`stair ${t}: footprint, landing, pads and arrivals fit the room and keep clear of each other`, () => {
      const s = STAIR_PLANS[t];
      const f = s.footprint;
      expect(Math.max(f.maxX - f.minX, f.maxZ - f.minZ)).toBeCloseTo(HOUSE_STAIR.run, 6);
      expect(Math.min(f.maxX - f.minX, f.maxZ - f.minZ)).toBeCloseTo(HOUSE_STAIR.width, 6);
      for (const b of [f, s.landing]) expect(inside({ x: b.minX, z: b.minZ }, ROOM) && inside({ x: b.maxX, z: b.maxZ }, ROOM)).toBe(true);
      // the landing touches the stair at its top end, and does not overlap it
      expect(overlaps(s.landing, f)).toBe(false);
      expect(Math.min(Math.abs(s.landing.maxX - f.minX), Math.abs(s.landing.minX - f.maxX))).toBeLessThan(1e-6);
      expect(inside(s.top, { minX: f.minX - 1e-6, maxX: f.maxX + 1e-6, minZ: f.minZ - 1e-6, maxZ: f.maxZ + 1e-6 })).toBe(true);
      // pads and arrival spots: in the room with a body's room, outside the stair, a body's room off it
      for (const p of [s.upPad, s.downPad, s.arriveUp, s.arriveDown]) expect(inside(p, ROOM, BODY)).toBe(true);
      const grown = { minX: f.minX - BODY, maxX: f.maxX + BODY, minZ: f.minZ - BODY, maxZ: f.maxZ + BODY };
      expect(inside(s.upPad, grown)).toBe(false);
      expect(inside(s.arriveDown, grown)).toBe(false);
      expect(inside(s.downPad, s.landing)).toBe(true);
      expect(inside(s.arriveUp, s.landing)).toBe(true);
      // the pads face the stair, the arrivals are usable at once (like the hall's door) and face the room
      expect(padUsableFrom(s.upPad, s.arriveDown.x, s.arriveDown.z)).toBe(true);
      expect(padUsableFrom(s.downPad, s.arriveUp.x, s.arriveUp.z)).toBe(true);
      const toCentre = (p: { x: number; z: number; yaw: number }) => Math.sin(p.yaw) * (5.3 - p.x) + Math.cos(p.yaw) * (3.9 - p.z);
      expect(toCentre(s.arriveUp)).toBeGreaterThan(0);
      expect(toCentre(s.arriveDown)).toBeGreaterThan(0);
      // up pads stay out of the entrance and away from the front door's way in
      expect(overlaps({ minX: s.upPad.x - HOUSE_PAD_RADIUS, maxX: s.upPad.x + HOUSE_PAD_RADIUS, minZ: s.upPad.z - HOUSE_PAD_RADIUS, maxZ: s.upPad.z + HOUSE_PAD_RADIUS }, HOUSE_ROOM.entrance)).toBe(false);
    });
  }

  it("offers a pad from its front band only, never from behind it or 2 m away", () => {
    const pad = STAIR_PLANS.C.upPad; // (9.85, 1.3) facing local +z, the stair's foot at z 1.9
    expect(padUsableFrom(pad, pad.x, pad.z)).toBe(true);
    expect(padUsableFrom(pad, pad.x, pad.z - 1.7)).toBe(true); // straight in front, 1.7 m
    expect(padUsableFrom(pad, pad.x - 0.75, pad.z - 1.0)).toBe(true); // 45°, in the band
    expect(padUsableFrom(pad, pad.x - 1.2, pad.z - 0.9)).toBe(false); // too far aside
    expect(padUsableFrom(pad, pad.x, pad.z + 0.9)).toBe(false); // past it: on the stair
    expect(padUsableFrom(pad, pad.x, pad.z - 2.0)).toBe(false); // 2 m away
    expect(padUsableFrom(pad, Number.NaN, 0)).toBe(false);
  });

  it("puts the entrance arrival in front of the inner door, facing the room, out of the exit's reach", () => {
    expect(ENTRY_SPAWN).toEqual({ x: 5.3, z: 3.1, yaw: 0 });
    expect(inside(EXIT_PAD, HOUSE_ROOM.entrance)).toBe(true);
    expect(padUsableFrom(EXIT_PAD, ENTRY_SPAWN.x, ENTRY_SPAWN.z)).toBe(false);
    expect(padUsableFrom(EXIT_PAD, 5.3, 2.0)).toBe(true);
    expect(padUsableFrom(EXIT_PAD, 5.3, 0.3)).toBe(true);
  });

  it("keeps every floor's clear zones apart from the stair", () => {
    for (const n of HOUSE_NUMBERS) {
      const f = STAIR_PLANS[HOUSE_STAIR_TYPE[n]].footprint;
      for (const floor of HOUSE_FLOORS) {
        for (const z of houseKeepClear(n, floor)) {
          expect(overlaps(z.box, f), `${n}:${floor}:${z.name}`).toBe(false);
          expect(inside({ x: z.box.minX, z: z.box.minZ }, ROOM) && inside({ x: z.box.maxX, z: z.box.maxZ }, ROOM)).toBe(true);
        }
      }
    }
  });

  it("gives every house its places in world coordinates on the right floor", () => {
    for (const n of HOUSE_NUMBERS) {
      const p = HOUSE_PLACES[n];
      expect(p.spawnIn.area).toBe(houseFloorArea(n, 1));
      expect(p.spawnDown.area).toBe(houseFloorArea(n, 1));
      expect(p.upPad.area).toBe(houseFloorArea(n, 1));
      expect(p.exitPad.area).toBe(houseFloorArea(n, 1));
      expect(p.spawnUp.area).toBe(houseFloorArea(n, 2));
      expect(p.downPad.area).toBe(houseFloorArea(n, 2));
      for (const s of [p.spawnIn, p.spawnDown, p.upPad, p.exitPad]) expect(inside(s, houseFloorBounds(n, 1), BODY)).toBe(true);
      for (const s of [p.spawnUp, p.downPad]) expect(inside(s, houseFloorBounds(n, 2), BODY)).toBe(true);
      expect(p.spawnIn.yaw).toBeCloseTo(Math.PI, 6); // coming in faces world −z
    }
    expect(HOUSE_PLACES[1].spawnIn).toMatchObject({ x: 365.3, z: -3.1 });
  });
});

describe("node names", () => {
  it("builds names that match the patterns and are unique per house", () => {
    const all = new Set<string>();
    for (const n of HOUSE_NUMBERS) {
      const req = houseRequiredNodes(n);
      expect(new Set(req).size).toBe(req.length);
      for (const r of req) {
        expect(all.has(r)).toBe(false);
        all.add(r);
      }
      for (const f of HOUSE_FLOORS) {
        expect(HOUSE_NODE_PATTERNS.floor.test(HOUSE_NODE.floor(n, f))).toBe(true);
        expect(HOUSE_NODE_PATTERNS.collider.test(HOUSE_NODE.collider(n, f, "wall_n"))).toBe(true);
        expect(HOUSE_NODE_PATTERNS.seat.test(HOUSE_NODE.seat(n, f, 0))).toBe(true);
        expect(HOUSE_NODE_PATTERNS.seat.test(HOUSE_NODE.seat(n, f, 12))).toBe(true);
      }
      expect(housePlacements(n).map((p) => p.node).every((node) => req.includes(node))).toBe(true);
    }
    expect(HOUSE_NODE.stairUp(7)).toBe("stair__h7_up");
    expect(HOUSE_NODE.stairDown(7)).toBe("stair__h7_down");
    expect(HOUSE_NODE.exit(7)).toBe("door__h7_exit");
    expect([HOUSE_NODE.spawnIn(7), HOUSE_NODE.spawnUp(7), HOUSE_NODE.spawnDown(7)]).toEqual(["spawn__h7_in", "spawn__h7_2", "spawn__h7_1s"]);
    for (const bad of ["seat__h0_1_0", "seat__h11_1_0", "seat__h1_3_0", "seat__h1_1_01", "seat__h1_1_a"]) {
      expect(HOUSE_NODE_PATTERNS.seat.test(bad)).toBe(false);
    }
    expect(HOUSE_NODE_PATTERNS.collider.test("col__h1_1_Wall")).toBe(false);
  });

  it("names the files of every house", () => {
    expect(houseFiles(4)).toEqual({
      glb: "/models/village/houses/house_4.glb",
      lightmapDay: "/models/village/houses/house_4_lm.webp",
      lightmapDay1k: "/models/village/houses/house_4_lm_1k.webp",
      lightmapNight: "/models/village/houses/house_4_lm_night.webp",
      lightmapNight1k: "/models/village/houses/house_4_lm_night_1k.webp",
      view: "/models/village/houses/house_4_view.webp",
    });
    expect(HOUSE_BUDGET.glb).toEqual({ maxBytes: 1024 * 1024, maxTriangles: 54_000, maxMaterials: 56, maxTextureSide: 2048 });
    expect(HOUSE_BUDGET.lightmap).toEqual({ side: 2048, maxBytes: 450 * 1024, side1k: 1024, maxBytes1k: 230 * 1024 });
  });
});

describe("seats", () => {
  it("plans 118 seats: floor 1 77, floor 2 41, per house as in design ch. 4", () => {
    expect(HOUSE_SEAT_TOTAL).toBe(118);
    expect(HOUSE_NUMBERS.reduce((t, n) => t + seatCount(n, 1), 0)).toBe(77);
    expect(HOUSE_NUMBERS.reduce((t, n) => t + seatCount(n, 2), 0)).toBe(41);
    expect(HOUSE_NUMBERS.map((n) => seatCount(n, 1) + seatCount(n, 2))).toEqual([12, 15, 12, 10, 13, 11, 10, 10, 15, 10]);
    const kinds = { backed: 0, backless: 0, floor: 0 };
    for (const n of HOUSE_NUMBERS) for (const f of HOUSE_FLOORS) for (const [k, v] of Object.entries(HOUSE_SEAT_PLAN[n][f])) kinds[k as keyof typeof kinds] += v!;
    expect(kinds).toEqual({ backed: 62, backless: 33, floor: 23 });
  });

  it("needs int16 for Player.seatIndex", () => {
    // design 6.3: 37 non-house seats + the houses' already pass int8's 127
    expect(37 + HOUSE_SEAT_TOTAL).toBeGreaterThan(SEAT_INDEX_SCHEMA.wasMax);
    expect(SEAT_INDEX_SCHEMA).toMatchObject({ type: "int16", standing: -1, max: 32767 });
  });

  it("maps every furniture to one kind and derives the approach", () => {
    for (const f of HOUSE_SEAT_FURN) expect(["backed", "backless", "floor"]).toContain(HOUSE_SEAT_FURN_KIND[f]);
    expect(seatApproach("backed", 0.2, false)).toBe("front");
    expect(seatApproach("backless", 0, true)).toBe("any");
    expect(seatApproach("backless", 0, false)).toBe("front");
    expect(seatApproach("floor", 0, false)).toBe("any"); // cushion: any side, faces the table
    expect(seatApproach("floor", 0.25, false)).toBe("front"); // 보료, floor sofa
  });

  const sofa: HouseSeatMarker = {
    id: "h1_1_0", n: 1, floor: 1, k: 0, furn: "sofa", kind: "backed", pose: "chair", approach: "front",
    x: 362, z: -5.5, y: 0.43, yaw: 0, edge: 0.35, back: 0.25, width: 0.7, group: "h1_1_0", both: false, exitTurn: 0, lean: 0.26,
  };
  it("accepts a well-formed marker and names what is wrong with bad ones", () => {
    expect(seatMarkerProblems(sofa)).toEqual([]);
    const bed: HouseSeatMarker = { ...sofa, id: "h1_2_0", floor: 2, z: 25, furn: "bed", kind: "backless", y: 0.5, back: 0, lean: 0, approach: "front" };
    expect(seatMarkerProblems(bed)).toEqual([]);
    expect(seatMarkerProblems({ ...bed, both: true, approach: "any" }).join()).toMatch(/침대/);
    const cushion: HouseSeatMarker = { ...sofa, furn: "cushion", kind: "floor", pose: "floor", y: 0.08, back: 0, lean: 0, approach: "any" };
    expect(seatMarkerProblems(cushion)).toEqual([]);
    expect(seatMarkerProblems({ ...cushion, pose: "chair" }).join()).toMatch(/floor/);
    expect(seatMarkerProblems({ ...sofa, width: 0.3 }).join()).toMatch(/너무 작/);
    expect(seatMarkerProblems({ ...sofa, approach: "any" }).join()).toMatch(/approach/);
    expect(seatMarkerProblems({ ...sofa, kind: "backless" }).join()).toMatch(/sofa/);
    expect(seatMarkerProblems({ ...sofa, back: 0 }).join()).toMatch(/back/);
    expect(seatMarkerProblems({ ...sofa, x: 300 }).join()).toMatch(/방 밖/);
    expect(seatMarkerProblems({ ...sofa, y: 0.7 }).join()).toMatch(/높이/);
    expect(seatMarkerProblems({ ...sofa, id: "h1_1_1" }).join()).toMatch(/id/);
  });
});

describe("contract.json", () => {
  it("is the committed copy of houseContractJson() (re-run scripts/export-house-contract.ts after a change)", () => {
    const file = path.resolve(process.cwd(), "../docs/designs/houses-interior/contract.json");
    const committed = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(houseContractJson())));
  });
});
