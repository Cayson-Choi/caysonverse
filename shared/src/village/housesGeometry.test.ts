import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isBlocked } from "../collision";
import type { AABB } from "../collision";
import { Encoder, Decoder } from "@colyseus/schema";
import { Player, WorldState } from "../schema";
import { reachable, hasNear, inside } from "../school/reachTestUtil";
import type { Bounds } from "../school/geometry";
import { PLAYER_RADIUS } from "../worldMap";
import {
  HOUSE_FLOORS,
  HOUSE_NUMBERS,
  HOUSE_PLACES,
  SEAT_INDEX_SCHEMA,
  HOUSE_STAIR_TYPE,
  STAIR_PLANS,
  houseFloorBounds,
  localToWorld,
  type HouseFloor,
  type HouseNumber,
} from "./houseAreas";
import { isRemovedHouseSeat } from "./houseFixes";
import { GENERATED_HOUSES, GENERATED_HOUSE_NUMBERS } from "./generated/houses";
import { HOUSES_APRON, HOUSES_BLOCK, HOUSES_ZONE, allHouseWalls, houseCeilingSlab, houseFloorGeometry, houseFloorOuter, houseIsReady, housesBlockers } from "./housesGeometry";
import { VILLAGE_LAYOUT, houseArea, isHouseArea, buildingIdFromArea, villageBounds, villageGeometry } from "./villageLayout";
import { LATE_HOUSE_SEATS, VILLAGE_SEATS, isLotSeat } from "./benchSeats";
import { LOT_ROOMS } from "./villageLots";
import { keypadEntries } from "./buildingAccess";
import { generatedHouseNumbers, renderIndex } from "../../../scripts/gen-houses-index";

const L = VILLAGE_LAYOUT;
const geo = villageGeometry;
const blockedAt = (x: number, z: number) => isBlocked(x, z, PLAYER_RADIUS, geo.obstacles, 0);

describe("house areas (floor-suffixed)", () => {
  it("houseArea / isHouseArea / buildingIdFromArea speak house:house_N:1|2 only", () => {
    expect(houseArea("house_3", 2)).toBe("house:house_3:2");
    expect(houseArea("house_3")).toBe("house:house_3:1");
    expect(isHouseArea("house:house_10:2")).toBe(true);
    for (const bad of ["house:house_1", "house:house_11:1", "house:house_0:1", "house:house_1:3", "house:x:1", "hall", "village", "house:", "house:house_1:1 "]) {
      expect(isHouseArea(bad), bad).toBe(false);
    }
    expect(buildingIdFromArea("house:house_7:2")).toBe("house_7");
    expect(buildingIdFromArea("house:house_7")).toBeNull();
  });
});

describe("the houses' ground: bounds, walls, blockers", () => {
  it("the block is x 359.7 .. 586.9, z -8.1 .. 30.3 and the village's bounds span it with a 5 m apron", () => {
    expect(HOUSES_BLOCK).toEqual({ minX: 359.7, maxX: 586.9, minZ: -8.1, maxZ: 30.3 });
    const b = villageBounds(L);
    expect(b.minX).toBe(-106); // the waterfall rest area on the west (B1 W5, release 2)
    expect(b.maxX).toBeCloseTo(586.9 + HOUSES_APRON, 6);
    expect(b.minZ).toBeLessThanOrEqual(-8.1 - HOUSES_APRON + 1e-9);
    expect(b.maxZ).toBeGreaterThanOrEqual(30.3 + HOUSES_APRON - 1e-9);
    expect(geo.bounds).toEqual(b);
    expect(HOUSES_ZONE.minX).toBeCloseTo(359.7 - HOUSES_APRON, 6);
  });

  it("every floor of every house is a sealed room: walls on all sides, the rooms 10.6 x 7.8 at their contract places", () => {
    expect(allHouseWalls()).toHaveLength(20 * 4);
    for (const n of HOUSE_NUMBERS) {
      for (const f of HOUSE_FLOORS) {
        const r = houseFloorBounds(n, f);
        expect(r.maxX - r.minX).toBeCloseTo(10.6, 6);
        expect(r.maxZ - r.minZ).toBeCloseTo(7.8, 6);
        expect(r.minX).toBeCloseTo(360 + 24 * (n - 1), 6);
        const o = houseFloorOuter(n, f);
        expect(o.minX).toBeCloseTo(r.minX - 0.3, 6);
      }
    }
  });

  it("every spot of the geometry's bounds outside the village, the hall and the 20 rooms is solid ground (a hop over a wall lands in a blocker)", () => {
    const rooms: Bounds[] = HOUSE_NUMBERS.flatMap((n) => HOUSE_FLOORS.map((f) => houseFloorBounds(n, f)));
    const bounds = geo.bounds;
    let free = 0;
    let probed = 0;
    // (from the village area's east edge: since release 1 it reaches the fishing lake, x 186)
    for (let x = L.areas.village.maxX + 0.5; x <= bounds.maxX; x += 0.5) {
      for (let z = bounds.minZ; z <= bounds.maxZ; z += 0.5) {
        probed++;
        // (and the lot buildings' five rooms, L5v2: walled holes in this ground)
        const inRoom = rooms.some((r) => inside(r, { x, z })) || inside(L.areas.hall, { x, z }) || LOT_ROOMS.some((r) => inside(r.bounds, { x, z }));
        if (!inRoom && !blockedAt(x, z)) free++;
      }
    }
    expect(probed).toBeGreaterThan(100_000);
    expect(free).toBe(0);
  });

  it("all ground within 5 m of the block's walls is solid, corners included (a legal step of up to 4.8 m cannot land on free ground)", () => {
    const w = HOUSES_BLOCK;
    const bad: string[] = [];
    for (let d = 0.1; d <= 5; d += 0.25) {
      for (let u = -5; u <= w.maxX - w.minX + 5; u += 0.5) {
        for (const [x, z] of [[w.minX + u, w.minZ - d], [w.minX + u, w.maxZ + d], [w.minX - d, w.minZ + u * 0.1], [w.maxX + d, w.minZ + u * 0.1]] as const) {
          if (x < geo.bounds.minX || x > geo.bounds.maxX || z < geo.bounds.minZ || z > geo.bounds.maxZ) continue;
          if (!blockedAt(x, z)) bad.push(`${x.toFixed(1)},${z.toFixed(1)}`);
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("the sealing check is not vacuous: without the blockers the gap between two houses is open ground", () => {
    const blockers = housesBlockers(geo.bounds);
    expect(blockers.length).toBeGreaterThan(20);
    const gapX = (houseFloorOuter(1, 1).maxX + houseFloorOuter(2, 1).minX) / 2;
    const without = geo.obstacles.filter((o) => !blockers.some((b) => b.minX === o.minX && b.maxX === o.maxX && b.minZ === o.minZ && b.maxZ === o.maxZ));
    expect(isBlocked(gapX, -3, PLAYER_RADIUS, without, 0)).toBe(false);
    expect(blockedAt(gapX, -3)).toBe(true);
    expect(blockedAt(gapX, 26)).toBe(true);
  });

  it("each floor: from its arrival spot the walkable area stays inside the room (sealed, 1.5 m margin) and reaches the pads", () => {
    for (const n of GENERATED_HOUSE_NUMBERS) {
      for (const f of HOUSE_FLOORS) {
        const room = houseFloorBounds(n, f);
        const p = HOUSE_PLACES[n];
        const start = f === 1 ? p.spawnIn : p.spawnUp;
        const r = reachable({ ...geo, bounds: room }, { x: start.x, z: start.z }, 0.1, 1.5);
        expect(r.length, `house ${n} floor ${f}`).toBeGreaterThan(1500);
        expect(r.every((q) => inside(room, q)), `house ${n} floor ${f} sealed`).toBe(true);
        const spots = f === 1 ? [p.exitPad, p.upPad, p.spawnDown] : [p.downPad, p.spawnUp];
        for (const s of spots) expect(hasNear(r, { x: s.x, z: s.z }, 0.2), `house ${n} floor ${f} reaches (${s.x}, ${s.z})`).toBe(true);
      }
    }
  });

  it("the arrival and pad spots are on free ground in the real geometry, for every house", () => {
    for (const n of HOUSE_NUMBERS) {
      const p = HOUSE_PLACES[n];
      for (const s of [p.spawnIn, p.spawnUp, p.spawnDown, p.exitPad, p.upPad, p.downPad]) {
        if (!houseIsReady(n)) continue; // a house with no model has no furniture to check against: its walls only
        expect(blockedAt(s.x, s.z), `house ${n} (${s.x}, ${s.z})`).toBe(false);
      }
    }
    // every house's porch arrival (the way out) is free ground in the village, 1.2 m from its wall
    for (const e of keypadEntries()) expect(blockedAt(e.exit.x, e.exit.z), e.buildingId).toBe(false);
  });

  it("the ceiling slab of each floor is a camera box over the room and its walls, underside 3.6 m", () => {
    const s = houseCeilingSlab(2, 2);
    expect(s).toMatchObject({ minY: 3.6, height: 3.8 });
    expect(s.minX).toBeCloseTo(384 - 0.3, 6);
    for (const n of HOUSE_NUMBERS) for (const f of HOUSE_FLOORS) expect(geo.cameraBoxes).toContainEqual(houseCeilingSlab(n, f));
  });
});

describe("one floor's map (what the client plays on)", () => {
  it("has the floor's walls, only that floor's furniture, its ceiling slab and the room's rectangle as bounds", () => {
    for (const n of GENERATED_HOUSE_NUMBERS) {
      for (const f of HOUSE_FLOORS as readonly HouseFloor[]) {
        const m = houseFloorGeometry(n, f);
        expect(m.id).toBe("house");
        expect(m.bounds).toEqual(houseFloorBounds(n, f));
        expect(m.cameraBoxes).toContainEqual(houseCeilingSlab(n, f));
        const other = houseFloorOuter(n, f === 1 ? 2 : 1);
        for (const o of m.obstacles) {
          const cx = (o.minX + o.maxX) / 2;
          const cz = (o.minZ + o.maxZ) / 2;
          expect(cx > other.minX && cx < other.maxX && cz > other.minZ && cz < other.maxZ, `${n}/${f}`).toBe(false);
        }
        expect(houseFloorGeometry(n, f)).toBe(m); // cached
      }
    }
  });
});

describe("the generated houses' index", () => {
  const dir = path.resolve(__dirname, "generated/houses");
  it("lists every house whose seat and collider files are in the folder (so HA / HB only run scripts/gen-houses-index.ts)", () => {
    const onDisk = generatedHouseNumbers(dir);
    expect(GENERATED_HOUSE_NUMBERS).toEqual(onDisk);
    expect(Object.keys(GENERATED_HOUSES).map(Number)).toEqual(onDisk);
    const text = fs.readFileSync(path.join(dir, "index.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(text).toBe(renderIndex(onDisk));
  });

  it("a house is ready exactly when it is in the index", () => {
    for (const n of HOUSE_NUMBERS as readonly HouseNumber[]) expect(houseIsReady(n)).toBe(GENERATED_HOUSE_NUMBERS.includes(n));
  });
});

describe("seatIndex is int16 on the wire", () => {
  it("a seat index past int8's 127 survives encode / decode; -1 is standing", () => {
    expect(SEAT_INDEX_SCHEMA.type).toBe("int16");
    const state = new WorldState();
    const p = new Player();
    state.players.set("a", p);
    p.seatIndex = 300;
    const decoded = new WorldState();
    new Decoder(decoded).decode(new Encoder(state).encodeAll());
    expect(decoded.players.get("a")!.seatIndex).toBe(300);
    const standing = new WorldState();
    standing.players.set("b", new Player()); // never set: stays at the default, -1
    const again = new WorldState();
    new Decoder(again).decode(new Encoder(standing).encodeAll());
    expect(again.players.get("b")!.seatIndex).toBe(-1);
  });
});

describe("the house seats in the one global list", () => {
  const houseSeats = VILLAGE_SEATS.filter((s) => isHouseArea(s.area));

  it("come in one run after every village bench and hall seat (main's later seats after them), in house, floor, marker order", () => {
    const firstHouse = VILLAGE_SEATS.findIndex((s) => isHouseArea(s.area));
    expect(firstHouse).toBe(51); // after the 20 village bench places and the hall's 31 (25 places since release 3.1, the 6 removed chairs retired in place)
    // seat ids are append-only: the seats a later release restored (LATE_HOUSE_SEATS) are at the very end of the list instead
    const inRun = houseSeats.filter((s) => !LATE_HOUSE_SEATS.includes(s.bench));
    const end = firstHouse + inRun.length;
    expect(VILLAGE_SEATS.slice(firstHouse, end).every((s) => isHouseArea(s.area))).toBe(true);
    // (lots v2's seats come after main's last, L5v2)
    const lotFirst = VILLAGE_SEATS.findIndex((s) => isLotSeat(s));
    const mainEnd = lotFirst >= 0 ? lotFirst : VILLAGE_SEATS.length;
    expect(VILLAGE_SEATS.slice(end, mainEnd - LATE_HOUSE_SEATS.length).some((s) => isHouseArea(s.area))).toBe(false);
    expect(VILLAGE_SEATS.slice(mainEnd - LATE_HOUSE_SEATS.length, mainEnd).map((s) => s.bench)).toEqual([...LATE_HOUSE_SEATS]);
    const keys = inRun.map((s) => {
      const m = /^house:house_(\d+):([12])$/.exec(s.area)!;
      const k = Number(/^h\d+_[12]_(\d+)/.exec(s.bench)![1]);
      return [Number(m[1]), Number(m[2]), k] as const;
    });
    const sorted = [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    expect(keys).toEqual(sorted);
  });

  /**
   * Markers the art leaves with no place to stand (listed for the art round, docs/designs/houses-interior/review): house 9's dining chair
   * in the middle of the row on the stair's side — the table in front, a chair on each side, the stair 1 m behind its backrest.
   */
  const KNOWN_UNSITTABLE = new Set(["h9_1_6"]);

  it("every marker of every finished house has at least one seat; only a backless 'both' marker may lose a facing", () => {
    for (const n of GENERATED_HOUSE_NUMBERS) {
      for (const m of GENERATED_HOUSES[n]!.seats) {
        if (isRemovedHouseSeat(m.id)) continue; // its piece is taken out (houseFixes.ts)
        if (KNOWN_UNSITTABLE.has(m.id)) {
          expect(houseSeats.filter((s) => s.bench === m.id), `${m.id} became sittable: drop it from KNOWN_UNSITTABLE`).toEqual([]);
          continue;
        }
        const mine = houseSeats.filter((s) => s.bench === m.id);
        expect(mine.length, m.id).toBeGreaterThanOrEqual(1);
        if (!(m.kind === "backless" && m.both)) expect(mine, m.id).toHaveLength(1);
        for (const s of mine) {
          expect(s.area).toBe(houseArea(`house_${m.n}`, m.floor));
          expect(s.seatY).toBe(m.y);
          expect(s.pose).toBe(m.pose);
          expect(s.kind).toBe(m.kind);
        }
      }
    }
  });

  it("a house seat's dismount spot is clear in the real geometry and inside its own floor", () => {
    for (const s of houseSeats) {
      const m = /^house:house_(\d+):([12])$/.exec(s.area)!;
      const room = houseFloorBounds(Number(m[1]) as HouseNumber, Number(m[2]) as HouseFloor);
      expect(blockedAt(s.standX, s.standZ), s.id).toBe(false);
      expect(inside(room, { x: s.standX, z: s.standZ }), s.id).toBe(true);
    }
  });

  it("a cushion is offered from every side (no front edge), a backed seat from the front only", () => {
    for (const n of GENERATED_HOUSE_NUMBERS) {
      for (const m of GENERATED_HOUSES[n]!.seats) {
        const seats = houseSeats.filter((s) => s.bench === m.id);
        for (const s of seats) {
          if (m.kind === "floor" && m.back === 0) expect(s.frontEdge, m.id).toBeUndefined();
          else expect(s.frontEdge, m.id).toBeDefined();
        }
      }
    }
  });
});

describe("stair plans are what the geometry needs", () => {
  it("each stair type's footprint is inside the room (a collider covers it on floor 1 for a finished house)", () => {
    for (const n of GENERATED_HOUSE_NUMBERS) {
      const plan = STAIR_PLANS[HOUSE_STAIR_TYPE[n]];
      const a = localToWorld(n, 1, plan.footprint.minX, plan.footprint.minZ);
      const b = localToWorld(n, 1, plan.footprint.maxX, plan.footprint.maxZ);
      const box: AABB = { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      expect(isBlocked(cx, cz, 0.05, houseFloorGeometry(n, 1).obstacles, 0), `house ${n}: no stair collider on floor 1`).toBe(true);
    }
  });
});
