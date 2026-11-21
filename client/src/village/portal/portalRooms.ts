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
}

/** Room frame → village: the inverse of `frame` (the rotation is orthonormal). */
export function toVillage(fr: PortalFrame, X: number, Y: number, Z: number): [number, number, number] {
  const x0 = X - fr.e, z0 = Z - fr.f;
  return [fr.a * x0 + fr.c * z0, Y + fr.lift, fr.b * x0 + fr.d * z0];
}
export function toRoom(fr: PortalFrame, x: number, y: number, z: number): [number, number, number] {
  return [fr.a * x + fr.b * z + fr.e, y - fr.lift, fr.c * x + fr.d * z + fr.f];
}

// ─────────────────────────────────────────── lots ───────────────────────────────────────────

/** The lots' ground-floor heights in the village (m): the floor just inside the door, measured by the bake (lifts.json). */
export const LOT_FLOOR_LIFT: Readonly<Record<string, number>> = Object.freeze({
  lot_school_class: 0.45,
  lot_library_reading: 0.3,
  lot_chapel_nave: 0.3,
  lot_church_nave: 0.3,
  lot_temple_hall: 0.96,
});

/** The rooms seen through the lots' glass and doors (the café's room is the café agent's). */
export const PORTAL_LOT_UNITS = ["lot_school_class", "lot_library_reading", "lot_chapel_nave", "lot_church_nave", "lot_temple_hall"] as const;

export function lotPortalRoom(room: LotRoom, lift = LOT_FLOOR_LIFT[room.unit.id] ?? 0.3): PortalRoom {
  const w = windowViewFrame(room);
  const [ma, mb, mc, md] = w.m; // room (x, z) → village: v = M · r + t
  const o = room.origin;
  // room = Mᵀ (v − t); frame = origin + room
  const frame: PortalFrame = {
    a: ma,
    b: mc,
    c: mb,
    d: md,
    e: o.x - (ma * w.t[0] + mc * w.t[1]),
    f: o.z - (mb * w.t[0] + md * w.t[1]),
    lift,
  };
  const s = room.unit.interior.size;
  return {
    id: room.unit.id,
    frame,
    min: [o.x, 0, o.z],
    max: [o.x + s.x, room.ceiling, o.z + s.z],
    eye: [o.x + s.x / 2, PORTAL_EYE_Y, o.z + s.z / 2],
  };
}

// ─────────────────────────────────────────── the memorial hall ───────────────────────────────────────────

/** The memorial's porch: its back wall (the shop front the hall's door is in) and its stone floor (autoDoorParts ENTRANCE). */
export const MEMORIAL_PORCH = { backZ: -53.68, floorY: 0.15 } as const;

export function memorialPortalRoom(): PortalRoom {
  const hall = VILLAGE_LAYOUT.memorial.interior;
  const r = hall.room;
  // the hall's door wall (z = r.maxZ, the south) stands where the porch's back wall is; x: the door's centre on the porch's
  const frame: PortalFrame = { a: 1, b: 0, c: 0, d: 1, e: hall.doorPad.centre.x, f: r.maxZ - MEMORIAL_PORCH.backZ, lift: MEMORIAL_PORCH.floorY };
  return {
    id: "memorial_hall",
    frame,
    min: [r.minX, 0, r.minZ],
    max: [r.maxX, hall.ceilingHeight, r.maxZ],
    eye: [(r.minX + r.maxX) / 2, PORTAL_EYE_Y, (r.minZ + r.maxZ) / 2],
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
    const pr = lotPortalRoom(room, 0);
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
