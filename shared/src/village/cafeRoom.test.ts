import { describe, expect, it } from "vitest";
import {
  CAFE_ALL_TABLES,
  CAFE_BACK_BAR,
  CAFE_BANQUETTE,
  CAFE_CENTRE_XZ,
  CAFE_COUNTER,
  CAFE_IN,
  CAFE_ROOM_LOCAL,
  CAFE_ROOM_SIZE,
  CAFE_STOOLS,
  cafeFromRoom,
  cafeRectToRoom,
  cafeTableChairs,
  cafeToRoom,
} from "./cafeRoom";
import { CAFE_LOT, LOT_ROOMS, lotDoorPoint, lotInteriorDoor, lotInteriorSeatBoxes, lotRoomDoor, lotRoomOf, lotRoomOfDoor, lotRoomStair, useLotDoor, useLotStair, villageLot } from "./villageLots";
import { VILLAGE_LAYOUT, villageGeometry } from "./villageLayout";
import { VILLAGE_SEATS } from "./benchSeats";
import { PLAYER_RADIUS } from "../worldMap";
import { isBlocked } from "../collision";

type R = { x0: number; x1: number; z0: number; z1: number };
const ov = (a: R, b: R) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

describe("the café's walk-in room (owner 2026-11-20: 들어갈 수 있게 해)", () => {
  it("stands where the layout's café is, door on the west front, a room of the lots' kind", () => {
    const cafe = VILLAGE_LAYOUT.sceneryHouses.find((h) => h.id === "cafe")!;
    expect(CAFE_CENTRE_XZ).toEqual({ x: cafe.centre.x, z: cafe.centre.z });
    expect(cafe.doorSide).toBe(CAFE_LOT.doorSide);
    expect(CAFE_LOT.centre).toEqual(cafe.centre);
    expect(villageLot("lot_cafe")).toBe(CAFE_LOT);
    const r = lotRoomOf("lot:lot_cafe_room")!;
    expect(r).toBeTruthy();
    // the café's rooms are the last two (the hall, then its salon upstairs, 2026-11-21): their seats come last, so no earlier seat index moves
    expect(LOT_ROOMS[LOT_ROOMS.length - 2]).toBe(r);
    expect(LOT_ROOMS[LOT_ROOMS.length - 1]).toBe(lotRoomOf("lot:lot_cafe_upstairs"));
    expect(r.unit.interior.size).toEqual({ x: CAFE_ROOM_SIZE.x, z: CAFE_ROOM_SIZE.z });
    expect(r.ceiling).toBe(CAFE_ROOM_LOCAL.ceil);
  });

  it("the door pad is on the stone landing in front of the door; the village door rule goes in and out", () => {
    const p = lotDoorPoint(CAFE_LOT, CAFE_LOT.doors[0]!);
    expect(p.pad.z).toBeCloseTo(CAFE_CENTRE_XZ.z, 6);
    expect(p.pad.x).toBeLessThan(46.6);
    expect(p.pad.x).toBeGreaterThan(44);
    expect(isBlocked(p.pad.x, p.pad.z, PLAYER_RADIUS, villageGeometry.obstacles, 0)).toBe(false);
    expect(isBlocked(p.arrival.x, p.arrival.z, PLAYER_RADIUS, villageGeometry.obstacles, 0)).toBe(false);
    const go = useLotDoor("village", p.pad.x, p.pad.z)!;
    expect(go.area).toBe("lot:lot_cafe_room");
    expect(useLotDoor("village", p.pad.x - 8, p.pad.z)).toBeNull();
    const back = useLotDoor("lot:lot_cafe_room", go.x, go.z);
    expect(back?.area).toBe("village");
  });

  it("the local frame turns into the room frame by a half turn and back", () => {
    for (const [x, z] of [[0, 0], [-6.8, 3.7], [6.8, -4.1], [2.3, -1.1]] as const) {
      const r = cafeToRoom(x, z);
      const b = cafeFromRoom(r.x, r.z);
      expect(b.x).toBeCloseTo(x, 9);
      expect(b.z).toBeCloseTo(z, 9);
    }
    // the door (local x 0, the front wall z 3.7) is the room's z = 0 wall at the door's x
    expect(cafeToRoom(0, CAFE_ROOM_LOCAL.zFront)).toEqual({ x: CAFE_IN.doorX, z: 0 });
    // the partition (local z -4.1, x -6.8) is the room's far corner
    expect(cafeToRoom(CAFE_ROOM_LOCAL.x0, CAFE_ROOM_LOCAL.zBack)).toEqual({ x: CAFE_ROOM_SIZE.x, z: CAFE_ROOM_SIZE.z });
  });

  it("every solid and seat is inside the room and none overlap", () => {
    const size = CAFE_ROOM_SIZE;
    const inRoom = (r: R) => r.x0 >= 0 && r.z0 >= 0 && r.x1 <= size.x && r.z1 <= size.z;
    for (const s of CAFE_IN.solids) expect(inRoom(s.rect), s.name).toBe(true);
    for (const s of CAFE_IN.seats) expect(inRoom(lotInteriorSeatBoxes(s).seat), s.id).toBe(true);
    for (const a of CAFE_IN.solids) for (const b of CAFE_IN.solids) if (a !== b) expect(ov(a.rect, b.rect), `${a.name} / ${b.name}`).toBe(false);
    // a chair's box is no solid, but it must not overlap a solid either (a bench's own box excepted)
    for (const s of CAFE_IN.seats)
      for (const so of CAFE_IN.solids) if (!so.name.startsWith("seatfurn_")) expect(ov(lotInteriorSeatBoxes(s).seat, so.rect), `${s.id} / ${so.name}`).toBe(false);
  });

  it("the arrival and the exit pad are clear, and the way in from the door reaches every seat (a body is 0.4 m)", () => {
    const r = lotRoomOf("lot:lot_cafe_room")!;
    const d = lotRoomDoor(r);
    for (const p of [d.exitPad, d.arrival]) expect(isBlocked(p.x, p.z, PLAYER_RADIUS, villageGeometry.obstacles, 0), "door spot").toBe(false);
    expect(lotInteriorDoor(CAFE_IN).exitPad.z).toBe(0.8);
    // a coarse flood fill over the room's floor at the body's radius: the arrival reaches every seat's stand point
    const step = 0.1;
    const key = (x: number, z: number) => `${Math.round(x / step)},${Math.round(z / step)}`;
    const seen = new Set<string>([key(d.arrival.x, d.arrival.z)]);
    const queue: [number, number][] = [[d.arrival.x, d.arrival.z]];
    while (queue.length) {
      const [x, z] = queue.pop()!;
      for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]] as const) {
        const nx = x + dx;
        const nz = z + dz;
        const k = key(nx, nz);
        if (seen.has(k) || nx < r.bounds.minX || nx > r.bounds.maxX || nz < r.bounds.minZ || nz > r.bounds.maxZ) continue;
        if (isBlocked(nx, nz, PLAYER_RADIUS, villageGeometry.obstacles, 0)) continue;
        seen.add(k);
        queue.push([nx, nz]);
      }
    }
    const near = (x: number, z: number) => [-2, -1, 0, 1, 2].some((i) => seen.has(key(x + i * step, z)) || seen.has(key(x, z + i * step)));
    for (const s of VILLAGE_SEATS.filter((q) => q.area === r.area)) expect(near(s.standX, s.standZ), `${s.id} stand point is reachable from the door`).toBe(true);
    // the counter's customer side, in front of every stool
    for (const st of CAFE_STOOLS) {
      const p = cafeToRoom(st.x, st.z + 0.5);
      expect(near(r.origin.x + p.x, r.origin.z + p.z), "in front of a stool").toBe(true);
    }
  });

  it("seats: a marker per chair at its table, the banquette's three places in front of their seat, the stools' room-side facing", () => {
    const chairs = CAFE_ALL_TABLES.flatMap((t) => cafeTableChairs(t));
    expect(CAFE_IN.seats.filter((s) => s.id.startsWith("lot_cafe_chair_"))).toHaveLength(chairs.length);
    const mine = VILLAGE_SEATS.filter((s) => s.area === "lot:lot_cafe_room");
    expect(mine.filter((s) => s.bench.startsWith("lotin:lot_cafe_chair_"))).toHaveLength(chairs.length);
    expect(mine.filter((s) => s.bench === "lotin:lot_cafe_banquette")).toHaveLength(3);
    expect(mine.filter((s) => s.bench.startsWith("lotin:lot_cafe_stool_")).length).toBeGreaterThanOrEqual(3);
    for (const s of mine) expect(s.seatY, s.id).toBeGreaterThan(0.4);
    // the banquette is a backed bench: stood up from in front of it (the room side), never behind
    for (const s of mine.filter((q) => q.bench === "lotin:lot_cafe_banquette")) {
      const ahead = (s.standX - s.x) * Math.sin(s.yaw) + (s.standZ - s.z) * Math.cos(s.yaw);
      expect(ahead, s.id).toBeGreaterThan(0);
    }
  });

  it("the banquette's front strip and the counter's customer side are open floor", () => {
    const f = cafeRectToRoom({ x0: CAFE_BANQUETTE.x1, x1: CAFE_BANQUETTE.x1 + 0.6, z0: CAFE_BANQUETTE.z0, z1: CAFE_BANQUETTE.z1 });
    for (const s of CAFE_IN.solids) expect(ov(f, s.rect), `banquette front / ${s.name}`).toBe(false);
    const g = cafeRectToRoom({ x0: CAFE_COUNTER.x0, x1: CAFE_COUNTER.x1, z0: CAFE_COUNTER.z1, z1: CAFE_COUNTER.z1 + 0.5 });
    for (const s of CAFE_IN.solids) expect(ov(g, s.rect), `counter front / ${s.name}`).toBe(false);
    expect(CAFE_BACK_BAR.z0).toBe(CAFE_ROOM_LOCAL.zBack);
  });

  it("the stair (owner 2026-11-21: 2층까지 만들어서 계단도): the café's pad takes one up, the salon's down; the salon has no way out of its own", () => {
    const g = lotRoomOf("lot:lot_cafe_room")!;
    const u = lotRoomOf("lot:lot_cafe_upstairs")!;
    const sg = lotRoomStair(g)!;
    const su = lotRoomStair(u)!;
    expect(sg.dir).toBe("up");
    expect(su.dir).toBe("down");
    const up = useLotStair(g.area, sg.pad.x, sg.pad.z - 0.6)!;
    expect(up.area).toBe(u.area);
    // it lands at the top of the stair, outside the stairwell, clear of every solid
    expect(up.z - u.origin.z).toBeLessThan(3.85);
    for (const s of u.spec.solids) expect(up.x > u.origin.x + s.rect.x0 && up.x < u.origin.x + s.rect.x1 && up.z > u.origin.z + s.rect.z0 && up.z < u.origin.z + s.rect.z1, s.name).toBe(false);
    const down = useLotStair(u.area, su.pad.x, su.pad.z - 0.6)!;
    expect(down.area).toBe(g.area);
    expect(isBlocked(down.x, down.z, PLAYER_RADIUS, villageGeometry.obstacles, 0)).toBe(false);
    expect(isBlocked(up.x, up.z, PLAYER_RADIUS, villageGeometry.obstacles, 0)).toBe(false);
    // the arrival is within the other pad's reach (the button is there) but a use needs a press: the server's rule alone never moves anyone
    expect(useLotStair(g.area, g.origin.x + 6.8, g.origin.z + 1.6)).toBeNull(); // the door's arrival: far from the stair
    expect(useLotStair(g.area, sg.pad.x, sg.pad.z + 1.0)).toBeNull(); // past the pad, on the stair: no
    expect(useLotStair("village", sg.pad.x, sg.pad.z)).toBeNull();
    // the salon: no exit pad, the café's door is the hall's
    expect(useLotDoor(u.area, u.origin.x + u.spec.doorX, u.origin.z + 0.8)).toBeNull();
    expect(lotRoomOfDoor("lot_cafe_main")).toBe(g);
    const d = lotDoorPoint(CAFE_LOT, CAFE_LOT.doors[0]!);
    expect(useLotDoor("village", d.pad.x, d.pad.z)?.area).toBe(g.area);
  });
});
