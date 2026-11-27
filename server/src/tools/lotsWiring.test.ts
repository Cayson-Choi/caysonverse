/**
 * Lots v2 in the game (L5v2, 2026-11-17: 학교 · 성당 · 도서관 · 절 · 교회 and 케이슨랜드's gate, the five walk-in rooms). The server plays on
 * the same geometry as the client (villageGeometry is shared): the lots' boxes go in only for lots whose committed model holds every
 * `col__` box (no invisible wall), each room is a walled hole in the houses' solid ground with its fixed furniture, the doors take a
 * visitor in and out (useLotDoor, the server's UseDoor), the 52 room seats come after every seat main has (never renumbering).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractColliders, parseGlb, type Gltf } from "../../../scripts/lib/schoolGlb";
import { isBlocked } from "@caysonverse/shared/collision";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";
import { VILLAGE_SEATS, isLotSeat } from "@caysonverse/shared/village/benchSeats";
import { HOUSES_BLOCK, allHouseWalls } from "@caysonverse/shared/village/housesGeometry";
import { VILLAGE_LAYOUT, villageBounds, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { spreadArrival } from "@caysonverse/shared/village/arrivalSpot";
import {
  LOTS_WITH_MODEL,
  LOT_INTERIORS,
  LOT_PEW_KNEE,
  LOT_INTERIOR_SEAT_ORDER,
  LOT_REPLACED_MODEL_BOXES,
  LOT_ROOF_SLABS,
  LOT_ROOMS,
  LOT_SEAT_ORDER,
  VILLAGE_LOTS,
  carveBlockers,
  lotBox,
  lotColliders,
  lotDoorPoint,
  lotDoorPoints,
  lotGeometryColliders,
  lotRoomColliders,
  lotRoomDoor,
  lotRoomOuter,
  lotRoomPoint,
  lotRoomSolids,
  lotsForLayoutJson,
  replacedByLot,
  useLotDoor,
} from "@caysonverse/shared/village/villageLots";
import { main as exportLayout } from "../../../scripts/export-village-layout";

const REPO = path.resolve(__dirname, "..", "..", "..");
const LOTS = path.join(REPO, "client", "public", "models", "village", "lots");
const same = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: typeof a, eps = 0.011) =>
  Math.abs(a.minX - b.minX) < eps && Math.abs(a.maxX - b.maxX) < eps && Math.abs(a.minZ - b.minZ) < eps && Math.abs(a.maxZ - b.maxZ) < eps;
const glb = (name: string) => parseGlb(new Uint8Array(fs.readFileSync(path.join(LOTS, `${name}.glb`)))) as { gltf: Gltf };

describe("lots v2 outside (L5v2)", () => {
  it("all six are wired, each committed GLB holding every contract col__ box (no invisible wall)", () => {
    expect([...LOTS_WITH_MODEL].sort()).toEqual(VILLAGE_LOTS.map((l) => l.id).sort());
    for (const id of LOTS_WITH_MODEL) {
      const { colliders, problems } = extractColliders(glb(id).gltf);
      expect(problems, id).toEqual([]);
      for (const c of lotColliders(VILLAGE_LOTS.find((l) => l.id === id)!)) {
        const node = colliders.find((m) => m.name === `col__${c.id}`);
        expect(node, `col__${c.id}`).toBeDefined();
        expect(same(node!.box, c.box), `col__${c.id}`).toBe(true);
      }
    }
  });

  it("the shared geometry has every lot box and every room's furniture (the rooms' last)", () => {
    const lots = lotGeometryColliders();
    for (const b of lots.obstacles) expect(villageGeometry.obstacles).toContainEqual(b);
    for (const b of lots.cameraBoxes) expect(villageGeometry.cameraBoxes).toContainEqual(b);
    const rooms = lotRoomColliders();
    const n = villageGeometry.obstacles.length;
    expect(villageGeometry.obstacles.slice(n - rooms.obstacles.length)).toEqual(rooms.obstacles);
    for (const b of rooms.cameraBoxes) expect(villageGeometry.cameraBoxes).toContainEqual(b);
  });

  it("plot_w's scaffold box is gone (the crane and scaffold come out of the clone too)", () => {
    const r = LOT_REPLACED_MODEL_BOXES[0]!;
    expect(replacedByLot(r.box)).toBe(true);
    expect(villageGeometry.obstacles.some((b) => same(b, r.box))).toBe(false);
  });

  it("every door's pad and arrival stand clear", () => {
    for (const l of VILLAGE_LOTS)
      for (const p of lotDoorPoints(l)) {
        expect(isBlocked(p.pad.x, p.pad.z, PLAYER_RADIUS, villageGeometry.obstacles, 0), `${p.door} pad`).toBe(false);
        expect(isBlocked(p.arrival.x, p.arrival.z, PLAYER_RADIUS, villageGeometry.obstacles, 0), `${p.door} arrival`).toBe(false);
      }
  });

  it("the roof slabs float over walkable ground, inside their lot; the temple's at or under B3's measured undersides", () => {
    for (const l of VILLAGE_LOTS)
      for (const s of LOT_ROOF_SLABS[l.id]) {
        expect(s.minY).toBeGreaterThan(2.5);
        expect(s.height).toBeGreaterThan(s.minY);
        expect(lotBox(l, s.rect).maxX).toBeGreaterThan(lotBox(l, s.rect).minX);
      }
    const [iljumun, eaves, bell] = LOT_ROOF_SLABS.lot_temple;
    expect(iljumun!.minY).toBeLessThanOrEqual(3.72); // under the 일주문's 창방
    expect(eaves!.minY).toBeLessThanOrEqual(4.9);
    expect(bell!.minY).toBeLessThanOrEqual(3.5);
  });
});

describe("the five walk-in rooms (contract 11)", () => {
  it("each stands on its own floor, clear of the houses' twenty rooms and of each other, inside the village's bounds", () => {
    const b = villageBounds(VILLAGE_LAYOUT);
    const houseWalls = allHouseWalls();
    const outers = LOT_ROOMS.map((r) => lotRoomOuter(r));
    outers.forEach((o, i) => {
      expect(o.minX >= b.minX && o.maxX <= b.maxX && o.minZ >= b.minZ && o.maxZ <= b.maxZ, LOT_ROOMS[i]!.unit.id).toBe(true);
      expect(o.minZ).toBeGreaterThan(HOUSES_BLOCK.maxZ + 5); // past the houses' apron
      for (const w of houseWalls) expect(w.maxX <= o.minX || w.minX >= o.maxX || w.maxZ <= o.minZ || w.minZ >= o.maxZ).toBe(true);
      outers.forEach((p, j) => {
        if (j !== i) expect(o.maxX + 4 <= p.minX || p.maxX + 4 <= o.minX || o.maxZ + 4 <= p.minZ || p.maxZ + 4 <= o.minZ).toBe(true);
      });
    });
  });

  it("inside a room nothing but its walls and furniture blocks (the houses' solid ground is carved out), outside it everything does", () => {
    for (const r of LOT_ROOMS) {
      const solids = lotRoomSolids(r);
      const free: Array<[number, number]> = [];
      for (let x = r.bounds.minX + 0.45; x <= r.bounds.maxX - 0.45; x += 0.5)
        for (let z = r.bounds.minZ + 0.45; z <= r.bounds.maxZ - 0.45; z += 0.5)
          if (!solids.some((s) => x > s.minX - 0.45 && x < s.maxX + 0.45 && z > s.minZ - 0.45 && z < s.maxZ + 0.45)) free.push([x, z]);
      expect(free.length, r.unit.id).toBeGreaterThan(10);
      for (const [x, z] of free) expect(isBlocked(x, z, PLAYER_RADIUS, villageGeometry.obstacles, 0), `${r.unit.id} (${x}, ${z})`).toBe(false);
      // a step past the walls lands in solid ground (one legal step is 4.8 m)
      const o = lotRoomOuter(r);
      for (const [x, z] of [[o.minX - 0.3, (o.minZ + o.maxZ) / 2], [o.maxX + 0.3, (o.minZ + o.maxZ) / 2], [(o.minX + o.maxX) / 2, o.maxZ + 0.3], [(o.minX + o.maxX) / 2, o.minZ - 0.3], [o.maxX + 4.5, o.maxZ + 4.5]] as const)
        expect(isBlocked(x, z, PLAYER_RADIUS, villageGeometry.obstacles, 0), `${r.unit.id} outside (${x}, ${z})`).toBe(true);
    }
  });

  it("carveBlockers cuts a hole and keeps everything else", () => {
    const out = carveBlockers([{ minX: 0, maxX: 10, minZ: 0, maxZ: 10 }], [{ minX: 3, maxX: 5, minZ: 4, maxZ: 6 }]);
    const area = out.reduce((s, b) => s + (b.maxX - b.minX) * (b.maxZ - b.minZ), 0);
    expect(area).toBeCloseTo(100 - 4, 6);
    expect(out.some((b) => 4 > b.minX && 4 < b.maxX && 5 > b.minZ && 5 < b.maxZ)).toBe(false);
  });

  it("the doors (server rule): the village pad → the room's arrival; the way out → the door's arrival; nothing from too far or the side", () => {
    // (the café's salon upstairs has no door of its own: its stair is the way, cafeRoom.test.ts)
    for (const r of LOT_ROOMS.filter((q) => !q.spec.noExit)) {
      const pad = lotDoorPoint(r.lot, r.door).pad;
      const inside = useLotDoor("village", pad.x, pad.z);
      expect(inside).toEqual({ area: r.area, ...lotRoomDoor(r).arrival });
      expect(useLotDoor("village", pad.x + 4, pad.z + 4)).toBeNull();
      const exit = lotRoomDoor(r).exitPad;
      expect(useLotDoor(r.area, exit.x, exit.z)).toEqual({ area: "village", ...lotDoorPoint(r.lot, r.door).arrival });
      // the arrival spot inside is itself in reach (a visitor can turn straight back out)
      expect(useLotDoor(r.area, inside!.x, inside!.z)).not.toBeNull();
      expect(useLotDoor(r.area, exit.x + 2.2, exit.z + 0.5)).toBeNull();
      expect(useLotDoor(r.area, exit.x, exit.z + 3)).toBeNull();
      expect(useLotDoor(r.area, Number.NaN, 0)).toBeNull();
      // the arrival spot is free, and two visitors at once are spread apart, inside the room
      expect(isBlocked(inside!.x, inside!.z, PLAYER_RADIUS, villageGeometry.obstacles, 0)).toBe(false);
      const a = spreadArrival(r.area, inside!, [{ x: inside!.x, z: inside!.z }]);
      expect(Math.hypot(a.x - inside!.x, a.z - inside!.z)).toBeGreaterThan(0.5);
      expect(a.x > r.bounds.minX && a.x < r.bounds.maxX && a.z > r.bounds.minZ && a.z < r.bounds.maxZ).toBe(true);
    }
    // 케이슨랜드's gate stays shut
    const gate = VILLAGE_LOTS.find((l) => l.id === "lot_gate")!;
    const gp = lotDoorPoint(gate, gate.doors[0]!).pad;
    expect(useLotDoor("village", gp.x, gp.z)).toBeNull();
  });

  it("the models' own col__ boxes are the contract's solids, in the room frame (the three moved rooms by their shift)", () => {
    for (const r of LOT_ROOMS) {
      const { colliders } = extractColliders(glb(r.unit.id).gltf);
      for (const s of lotRoomSolids(r)) {
        const node = colliders.find((m) => m.name === `col__${r.unit.id}_${s.name}`);
        expect(node, `col__${r.unit.id}_${s.name}`).toBeDefined();
        const moved = { minX: node!.box.minX + r.shift.x, maxX: node!.box.maxX + r.shift.x, minZ: node!.box.minZ + r.shift.z, maxZ: node!.box.maxZ + r.shift.z };
        expect(same(moved, s), `col__${r.unit.id}_${s.name}`).toBe(true);
      }
    }
  });
});

describe("seats: outside 12, inside 81, after every seat main has", () => {
  it("the lot seats come after main's last seat, in LOT_SEAT_ORDER then LOT_INTERIOR_SEAT_ORDER, never renumbering earlier ones", () => {
    const first = VILLAGE_SEATS.findIndex((s) => isLotSeat(s));
    // main's last seat: release 4's added house seats (houses-real, ADDED_HOUSE_SEATS) end at index 269 — the lots' start at 270
    expect(first).toBe(270);
    expect(VILLAGE_SEATS.findIndex((s) => s.id.startsWith("lotin:"))).toBe(302);
    // (케이슨랜드 benches follow the lot seats, 2026-11-22)
    const lot = VILLAGE_SEATS.slice(first).filter((s) => s.area !== "park");
    expect(VILLAGE_SEATS.slice(first + lot.length).every((s) => s.area === "park")).toBe(true);
    expect(lot.every((s) => isLotSeat(s))).toBe(true);
    const outside = lot.filter((s) => s.area === "village");
    const inside = lot.filter((s) => s.area !== "village");
    expect(lot.indexOf(inside[0]!)).toBe(outside.length); // every outside seat first
    expect([...new Set(outside.map((s) => s.bench.slice("lot:".length)))]).toEqual([...LOT_SEAT_ORDER]);
    expect([...new Set(inside.map((s) => s.bench.slice("lotin:".length)))]).toEqual([...LOT_INTERIOR_SEAT_ORDER]);
    expect(LOT_INTERIOR_SEAT_ORDER.length).toBe(81);
    // one seat per place: school 12, library 8 + 2×2, chapel 10×3, church 8×3, temple 12, café 10 chairs + 3 stools (the room side: the counter blocks the other) + 3 banquette places
    const by = (u: string) => inside.filter((s) => s.area === `lot:${u}`).length;
    // the café's salon upstairs (2026-11-21): 12 chairs, the sofa's 3 places, 2 wing chairs
    expect([by("lot_school_class"), by("lot_library_reading"), by("lot_chapel_nave"), by("lot_church_nave"), by("lot_temple_hall"), by("lot_cafe_room"), by("lot_cafe_upstairs")]).toEqual([12, 12, 30, 24, 12, 16, 17]);
    // (케이슨랜드 benches come after every lot seat: 17 benches, two places each)
    expect(VILLAGE_SEATS.length).toBe(first + 32 + 90 + 16 + 17 + 34);
  });

  it("every room seat: in its room, stood up from a free spot in it, a backed one in FRONT of the seat (never behind its back)", () => {
    for (const r of LOT_ROOMS) {
      for (const s of VILLAGE_SEATS.filter((q) => q.area === r.area)) {
        expect(s.standX > r.bounds.minX && s.standX < r.bounds.maxX && s.standZ > r.bounds.minZ && s.standZ < r.bounds.maxZ, s.id).toBe(true);
        expect(isBlocked(s.standX, s.standZ, PLAYER_RADIUS, villageGeometry.obstacles, 0), `${s.id} stand`).toBe(false);
        const spec = r.spec.seats.find((q) => q.id === s.id.split(":")[1])!;
        const c = lotRoomPoint(r, spec.x, spec.z);
        const ahead = (s.standX - c.x) * Math.sin(s.yaw) + (s.standZ - c.z) * Math.cos(s.yaw);
        if (spec.kind !== "floor") expect(ahead, `${s.id} stands in front`).toBeGreaterThan(0);
        expect(s.seatY).toBe(spec.seatTop);
      }
    }
  });

  it("the pews' walk boxes leave the front strip a body stands in (knees over the seat's lip)", () => {
    const r = LOT_ROOMS.find((x) => x.unit.id === "lot_chapel_nave")!;
    const pew = lotRoomSolids(r).find((s) => s.name === "pew_l1")!;
    const walk = lotRoomColliders().obstacles.find((b) => b.minX === pew.minX && b.minZ === pew.minZ && b.maxX === pew.maxX)!;
    expect(walk.maxZ).toBeCloseTo(pew.maxZ - LOT_PEW_KNEE, 6);
    expect(LOT_INTERIORS.find((i) => i.unit === "lot_chapel_nave")!.seats.length).toBe(10);
  });
});

describe("layout.json", () => {
  it("carries the lots (the export script's lots line)", () => {
    const out = path.join(REPO, "node_modules", ".cache", "l5v2-layout-test.json");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    expect(exportLayout([out])).toBe(0);
    const json = JSON.parse(fs.readFileSync(out, "utf8")) as { lots: unknown[] };
    expect(json.lots).toEqual(JSON.parse(JSON.stringify(lotsForLayoutJson())));
    expect(json.lots.length).toBe(6);
  });
});
