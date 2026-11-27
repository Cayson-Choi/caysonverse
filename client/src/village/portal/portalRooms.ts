import { LOT_ROOMS, lotDoorPoint, lotRoomDoor, type LotRoom } from "@caysonverse/shared/village/villageLots";
import { VILLAGE_LAYOUT, type SceneryHouse } from "@caysonverse/shared/village/villageLayout";
import { HOUSE_NUMBERS, HOUSE_PLACES, HOUSE_ROOM, houseOrigin, type HouseFloor, type HouseNumber } from "@caysonverse/shared/village/houseAreas";
import { HOUSE_A8 } from "@caysonverse/shared/village/houseExterior";
import { EXTERIOR_BODY_A8 } from "@caysonverse/shared/village/exteriorWindows";
import { keypadEntries } from "@caysonverse/shared/village/buildingAccess";
import { windowViewFrame } from "../lots/windowView";

/**
 * Where each REAL room sits behind the village's walls (clear glass, owner 2026-11-21: "건물 밖에서도 유리창을 통해서 안이 보이게").
 *
 * The rooms are separate scenes far from the village: the lots' rooms at LOT_ROOM_AT, the houses' floors at x 360+ (houseOrigin),
 * the memorial hall round (300, 0). A portal room maps a village point into that room's own world (its "room frame": the area's
 * coordinates, where the bake's cube camera stood): a rotation in the ground plane, an offset, and a floor height. The window and
 * doorway shader (interiorPortal.ts) casts the eye's ray into the room's box in that frame and reads the baked cube there, so what
 * one sees through a window is the room that is really behind it, in perspective, moving as one walks past.
 */

/** The bake's eye above the room's floor (m): a standing visitor's eye. */
export const PORTAL_EYE_Y = 1.6;

export interface PortalFrame {
  /** Village (x, z) → room frame: X = a·x + b·z + e, Z = c·x + d·z + f; Y = village y − lift. */
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  lift: number;
  /**
   * Depth squeeze (≤ 1, default 1): a room deeper than its building's inside is drawn this much shallower along room Z, about the door
   * wall's Z `kz` — the 성당's nave (13.4 m) behind its 9.9 m deep shell, the 대웅전's hall behind its recessed front — so its back wall
   * stays inside the shell's (a squeeze nobody sees through a door, where a room poking out of the back wall would be seen).
   */
  k?: number;
  kz?: number;
}

export interface PortalRoom {
  /** Bake id: a lot room's unit id, `memorial_hall`, `house_<n>_<floor>`. */
  id: string;
  frame: PortalFrame;
  /** The room's box in the room frame (the inside faces of its walls, floor to ceiling). */
  min: [number, number, number];
  max: [number, number, number];
  /** The bake's eye in the room frame. */
  eye: [number, number, number];
  /**
   * Room-frame boxes left out when the room is seen from outside: its own door, shut, in the building's open doorway (the room was built
   * as a closed room: its door leaves stand where the building's open ones swing back).
   */
  cut?: Array<{ min: [number, number, number]; max: [number, number, number] }>;
}

/** Room frame → village: the inverse of `frame` (the rotation is orthonormal). */
export function toVillage(fr: PortalFrame, X: number, Y: number, Z: number): [number, number, number] {
  const k = fr.k ?? 1, kz = fr.kz ?? 0;
  Z = kz + (Z - kz) * k;
  const x0 = X - fr.e, z0 = Z - fr.f;
  return [fr.a * x0 + fr.c * z0, Y + fr.lift, fr.b * x0 + fr.d * z0];
}
export function toRoom(fr: PortalFrame, x: number, y: number, z: number): [number, number, number] {
  const k = fr.k ?? 1, kz = fr.kz ?? 0;
  const Z = fr.c * x + fr.d * z + fr.f;
  return [fr.a * x + fr.b * z + fr.e, y - fr.lift, kz + (Z - kz) / k];
}

// ─────────────────────────────────────────── lots ───────────────────────────────────────────

/**
 * The lots' rooms in their buildings, measured on the lots' own door leaves (village, 2026-11-22: the closed leaves' inner faces and
 * their sills): `lift` the room's floor above the lawn (the 대웅전 stands on its 기단), `wallIn` how far behind the body's front edge the
 * door wall's inner face is (the 대웅전's lattice front stands 1.96 m back, behind its open 툇마루 porch).
 */
export const LOT_ROOM_PLACE: Readonly<Record<string, { lift: number; wallIn: number; doorHalf: number; doorTop: number }>> = Object.freeze({
  lot_school_class: { lift: 0.03, wallIn: 0.38, doorHalf: 1.11, doorTop: 3.2 },
  lot_library_reading: { lift: 0.03, wallIn: 0.4, doorHalf: 1.11, doorTop: 3.4 },
  lot_chapel_nave: { lift: 0.03, wallIn: 0.8, doorHalf: 1.2, doorTop: 3.6 },
  lot_church_nave: { lift: 0.03, wallIn: 0.21, doorHalf: 1.11, doorTop: 3.4 },
  lot_temple_hall: { lift: 0.96, wallIn: 1.96, doorHalf: 1.5, doorTop: 3.05 },
});

/** The rooms seen through the lots' glass and doors (the café's room is the café agent's). */
export const PORTAL_LOT_UNITS = ["lot_school_class", "lot_library_reading", "lot_chapel_nave", "lot_church_nave", "lot_temple_hall"] as const;

export function lotPortalRoom(room: LotRoom, place = LOT_ROOM_PLACE[room.unit.id] ?? { lift: 0.03, wallIn: 0.3, doorHalf: 1.1, doorTop: 3.2 }): PortalRoom {
  const w = windowViewFrame(room);
  const [ma, mb, mc, md] = w.m; // room (x, z) → village: v = M · r + t
  const lift = place.lift;
  // the door wall's inner face `wallIn` into the building (room +z is into it: M · (0, 1))
  const t: [number, number] = [w.t[0] + place.wallIn * mb, w.t[1] + place.wallIn * md];
  const o = room.origin;
  // room = Mᵀ (v − t); frame = origin + room
  const frame: PortalFrame = {
    a: ma,
    b: mc,
    c: mb,
    d: md,
    e: o.x - (ma * t[0] + mc * t[1]),
    f: o.z - (mb * t[0] + md * t[1]),
    lift,
  };
  const s = room.unit.interior.size;
  // the building's inside behind the door wall: the body's depth less the door wall's set-back and the back wall (0.3 m)
  const inside = room.lot.body.z1 - room.lot.body.z0 - place.wallIn - 0.3;
  if (inside < s.z) {
    frame.k = inside / s.z;
    frame.kz = o.z;
  }
  return {
    id: room.unit.id,
    frame,
    min: [o.x, 0, o.z],
    max: [o.x + s.x, room.ceiling, o.z + s.z],
    eye: [o.x + s.x / 2, PORTAL_EYE_Y, o.z + s.z / 2],
    cut: [{ min: [o.x + room.spec.doorX - place.doorHalf - 0.08, -0.1, o.z - 0.6], max: [o.x + room.spec.doorX + place.doorHalf + 0.08, place.doorTop + 0.4, o.z + 0.45] }],
  };
}

// ─────────────────────────────────────────── the memorial hall ───────────────────────────────────────────

/** The memorial's porch: its back wall (the shop front the hall's door is in) and its stone floor (autoDoorParts ENTRANCE). */
export const MEMORIAL_PORCH = { backZ: -53.68, floorY: 0.15 } as const;

export function memorialPortalRoom(): PortalRoom {
  const hall = VILLAGE_LAYOUT.memorial.interior;
  const r = hall.room;
  // the hall's door wall stands just behind the porch's back wall: its outer face and the door leaves hung on it (autoDoorParts
  // HALL_REVEAL_OUTER_Z 6.14, the leaves to 6.26) behind the shop front's plane; x: the door's centre on the porch's
  const behind = 0.3;
  const frame: PortalFrame = { a: 1, b: 0, c: 0, d: 1, e: hall.doorPad.centre.x, f: r.maxZ + behind - MEMORIAL_PORCH.backZ, lift: MEMORIAL_PORCH.floorY };
  return {
    id: "memorial_hall",
    frame,
    min: [r.minX, 0, r.minZ],
    max: [r.maxX, hall.ceilingHeight, r.maxZ],
    eye: [(r.minX + r.maxX) / 2, PORTAL_EYE_Y, (r.minZ + r.maxZ) / 2],
    // the hall's whole door wall (its inner face, its door and its white outer surround): seen from the porch the village's shop front IS
    // that wall — its glass looks straight into the hall (the wall's back would otherwise stand 30 cm behind the glass as a blank sheet)
    cut: [{ min: [r.minX - 5, -1, r.maxZ - 0.35], max: [r.maxX + 5, hall.ceilingHeight + 2, r.maxZ + 5] }],
  };
}

// ─────────────────────────────────────────── houses ───────────────────────────────────────────

/** The A8 houses (the ten with interiors), by number. */
export function a8House(n: HouseNumber): SceneryHouse {
  return VILLAGE_LAYOUT.sceneryHouses.find((h) => h.id === `house_${n}`)!;
}

/**
 * A house floor: village → the house's exterior local frame (houseWorldToLocal: lx = p·dx + q·dz, lz = −q·dx + p·dz) → the
 * interior frame (x = lx + 5.3, z = 2.825 − lz; exteriorWindows.ts) → the floor's room frame (houseOrigin: X = o.x + x, Z = o.z − z).
 */
export function housePortalRoom(n: HouseNumber, floor: HouseFloor): PortalRoom {
  const h = a8House(n);
  const [p, q] = { s: [1, 0], n: [-1, 0], e: [0, -1], w: [0, 1] }[h.doorSide] as [number, number];
  const o = houseOrigin(n, floor);
  const cx = h.centre.x, cz = h.centre.z;
  // X = o.x + 5.3 + p·dx + q·dz ; Z = o.z − 2.825 − q·dx + p·dz   (dx = x − cx, dz = z − cz)
  const frame: PortalFrame = {
    a: p,
    b: q,
    c: -q,
    d: p,
    e: o.x + EXTERIOR_BODY_A8.halfWidth - p * cx - q * cz,
    f: o.z - EXTERIOR_BODY_A8.front + q * cx - p * cz,
    lift: HOUSE_A8.floorLift + (floor - 1) * HOUSE_ROOM.storey,
  };
  return {
    id: `house_${n}_${floor}`,
    frame,
    min: [o.x, 0, o.z - HOUSE_ROOM.depth],
    max: [o.x + HOUSE_ROOM.width, HOUSE_ROOM.ceiling, o.z],
    eye: [o.x + HOUSE_ROOM.width / 2, PORTAL_EYE_Y, o.z - HOUSE_ROOM.depth / 2],
  };
}

/** Every portal room. */
export function allPortalRooms(): PortalRoom[] {
  const lots = PORTAL_LOT_UNITS.map((u) => lotPortalRoom(LOT_ROOMS.find((r) => r.unit.id === u)!));
  const houses = HOUSE_NUMBERS.flatMap((n) => [housePortalRoom(n, 1), housePortalRoom(n, 2)]);
  return [...lots, memorialPortalRoom(), ...houses];
}

// ─────────────────────────────────────────── the bake's route (e2e/interior-portal-bake.mjs) ───────────────────────────────────────────

export type BakeTarget =
  | { kind: "lot"; id: string; lot: string; area: string; arrival: { x: number; z: number }; pad: { x: number; z: number }; exit: { x: number; z: number }; eye: number[]; sill: number[] }
  | { kind: "hall"; id: string; exit: { x: number; z: number }; eye: number[] }
  | { kind: "house"; id: string; pad: { x: number; z: number }; upPad: { x: number; z: number }; exit: { x: number; z: number }; eyes: number[][] };

export function bakeTargets(): BakeTarget[] {
  const out: BakeTarget[] = [];
  for (const u of PORTAL_LOT_UNITS) {
    const room = LOT_ROOMS.find((r) => r.unit.id === u)!;
    const pr = lotPortalRoom(room);
    const dp = lotDoorPoint(room.lot, room.door);
    // just inside the door, in the village: the floor's height there is the room's lift
    const sill = toVillage(pr.frame, room.origin.x + room.spec.doorX, 0, room.origin.z + 0.8);
    out.push({ kind: "lot", id: u, lot: room.lot.id, area: room.area, arrival: dp.arrival, pad: dp.pad, exit: lotRoomDoor(room).exitPad, eye: pr.eye, sill: [sill[0], sill[2]] });
  }
  const hall = VILLAGE_LAYOUT.memorial.interior;
  out.push({ kind: "hall", id: "memorial_hall", exit: hall.doorPad.centre, eye: memorialPortalRoom().eye });
  const keypads = keypadEntries();
  for (const n of HOUSE_NUMBERS) {
    const P = HOUSE_PLACES[n];
    out.push({
      kind: "house",
      id: `house_${n}`,
      pad: keypads.find((k) => k.buildingId === `house_${n}`)!.pad,
      upPad: P.upPad,
      exit: P.exitPad,
      eyes: [housePortalRoom(n, 1).eye, housePortalRoom(n, 2).eye],
    });
  }
  return out;
}
