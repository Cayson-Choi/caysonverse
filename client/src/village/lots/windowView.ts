import type { LotRoom, LotRect } from "@caysonverse/shared/village/villageLots";
import type { Side } from "@caysonverse/shared/village/villageLayout";

/**
 * The real village behind a walk-in room's windows (owner 2026-11-20: "교실에서 창문으로 내다보면 실제 케이슨마을의 외부와 똑같이
 * 보여야"). A room is a separate scene far from the village (LOT_ROOM_AT), so its glass cannot see through: instead each room
 * carries panoramas baked FROM THE RUNNING VILLAGE (e2e/window-view-bake.mjs) at the spot the room really is — the middle of
 * its building's ground floor, at eye height, with the building itself clipped away — one for the day, the evening's golden
 * hour and the night. The window shader (gardenWindow.ts) turns the eye ray from the room's frame into the village's, finds
 * where it meets a simple proxy of the surroundings (the ground plane out to WINDOW_VIEW_RADIUS, a cylinder beyond), and reads
 * the panorama in the direction of that point from the bake's eye, so the yard right outside shifts as you walk past a window.
 *
 * The frames: room frame (the interior spec: door on the z = 0 wall, +z into the room) → the lot's local frame (the same
 * building seen from outside: the door on the body's front, local +z out of the door) → the village (`lotLocalToWorld`). The
 * room is the building's ground floor turned to face its door: room x runs against local x (both from the door, the room
 * walking in, the local frame walking out), room z against local z.
 */

/** The bake's eye above the room's floor (m): a standing visitor's eye. */
export const WINDOW_VIEW_EYE = 1.6;
/** Where the proxy's ground plane ends and its cylinder stands (m from the bake's eye, flat): the yard, the lane, the next houses. */
export const WINDOW_VIEW_RADIUS = 22;

export interface WindowViewFrame {
  unit: string;
  /** Room frame (x, z) → village world (x, z): village = [a b; c d] · room + t. */
  m: [number, number, number, number];
  t: [number, number];
  /** The bake's eye in the room frame (x, y, z) and in the village (x, y, z). */
  eyeRoom: [number, number, number];
  eyeVillage: [number, number, number];
  /** The building's walls and roof as a village box (min/max x, y, z): clipped away while baking. */
  clip: { min: [number, number, number]; max: [number, number, number] };
}

function localToWorld(centre: { x: number; z: number }, side: Side, lx: number, lz: number): [number, number] {
  switch (side) {
    case "s": return [centre.x + lx, centre.z + lz];
    case "n": return [centre.x - lx, centre.z - lz];
    case "e": return [centre.x + lz, centre.z - lx];
    case "w": return [centre.x - lz, centre.z + lx];
  }
}

/** The room's frame in the village and the bake's eye: shared by the bake script and the window shader. */
export function windowViewFrame(room: LotRoom): WindowViewFrame {
  const lot = room.lot;
  if (room.door.wall !== "front") throw new Error(`window view: ${room.unit.id}'s door is not on the front wall`);
  const doorX = room.spec.doorX;
  const front = lot.body.z1;
  const toVillage = (x: number, z: number) => localToWorld(lot.centre, lot.doorSide, room.door.at + (doorX - x), front - z);
  const o = toVillage(0, 0), ex = toVillage(1, 0), ez = toVillage(0, 1);
  const m: [number, number, number, number] = [ex[0] - o[0], ez[0] - o[0], ex[1] - o[1], ez[1] - o[1]];
  const size = room.unit.interior.size;
  const eyeRoom: [number, number, number] = [size.x / 2, WINDOW_VIEW_EYE, size.z / 2];
  const ev = toVillage(eyeRoom[0], eyeRoom[2]);
  // the body and its bay windows, 0.35 m out for the sills and frames on the face (not the benches and porches before it)
  const rects: LotRect[] = [lot.body, ...lot.colliders.filter((c) => c.suffix.startsWith("bay")).map((c) => c.rect)];
  const xs: number[] = [], zs: number[] = [];
  for (const r of rects)
    for (const [lx, lz] of [[r.x0, r.z0], [r.x1, r.z1]] as const) {
      const p = localToWorld(lot.centre, lot.doorSide, lx, lz);
      xs.push(p[0]);
      zs.push(p[1]);
    }
  const pad = 0.35;
  return {
    unit: room.unit.id,
    m,
    t: [o[0], o[1]],
    eyeRoom,
    eyeVillage: [ev[0], WINDOW_VIEW_EYE, ev[1]],
    clip: { min: [Math.min(...xs) - pad, 0.12, Math.min(...zs) - pad], max: [Math.max(...xs) + pad, lot.height + 2, Math.max(...zs) + pad] },
  };
}

/** The rooms whose windows show the village (their glass is `M_garden`), with the lot each stands in. */
export const WINDOW_VIEW_UNITS = ["lot_school_class", "lot_library_reading"] as const;

