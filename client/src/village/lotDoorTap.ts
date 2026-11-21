import { LOT_ROOMS, lotDoorPoint, lotRoomDoor, lotRoomOf, lotRoomStair } from "@caysonverse/shared/village/villageLots";
import { HOUSE_STAIR_DOWN_TARGET_ID, HOUSE_STAIR_UP_TARGET_ID } from "@caysonverse/shared/village/houseTargets";
import { LOT_ENTER_TARGET_PREFIX, LOT_EXIT_TARGET_PREFIX } from "./lots/lotTargets";

/**
 * Tapping a lot building's door (owner 2026-11-20, the café: "문을 누르면 들어가기, 안에서도 문을 누르면 나가기"; the houses' stair and door taps,
 * houseTap.ts, the same way): a tap on the door's face walks to the door's pad and uses it there — the village's pad "<건물> 들어가기", the
 * room's own "밖으로 나가기" — armed with `armHouseUse` and fired by the village scene's frame loop once the button for that pad is
 * offered. The tap region is the door's own opening, a little wider, from a hand's breadth behind the wall to just in front of it.
 */

/** How much wider (m) than the door the tap region is, each side. */
const TAP_SIDE_M = 0.3;
/** How far (m) in front of and behind the door's wall line a tap still counts. */
const TAP_OUT_M = 0.9;
const TAP_IN_M = 0.8;
/** How far above the door (m) a tap still counts (its transom). */
const TAP_ABOVE_M = 0.25;

export interface LotDoorTap {
  /** The target id the pad offers (lotTargets.ts). */
  id: string;
  /** The pad's centre (world): where the avatar walks to. */
  x: number;
  z: number;
}

/** What the picked world point (x, y, z) of `area` is: a lot door (the village) or a room's way out, or nothing. */
export function lotDoorTapTarget(area: string, x: number, y: number, z: number): LotDoorTap | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || y < 0) return null;
  if (area === "village") {
    for (const r of LOT_ROOMS) {
      if (r.spec.noExit) continue;
      const p = lotDoorPoint(r.lot, r.door);
      const out = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
      const along = { x: Math.cos(p.yaw), z: -Math.sin(p.yaw) };
      const dx = x - p.centre.x;
      const dz = z - p.centre.z;
      const o = dx * out.x + dz * out.z;
      const a = dx * along.x + dz * along.z;
      if (o < -TAP_IN_M || o > TAP_OUT_M || Math.abs(a) > r.door.width / 2 + TAP_SIDE_M || y > r.door.height + TAP_ABOVE_M) continue;
      return { id: `${LOT_ENTER_TARGET_PREFIX}${r.door.id}`, x: p.pad.x, z: p.pad.z };
    }
    return null;
  }
  const room = lotRoomOf(area);
  if (!room) return null;
  // a building's own stair (the café's): a tap on its steps, rail or the stairwell's balustrade walks to its pad (the houses' stair tap)
  const st = lotRoomStair(room);
  if (st) {
    const f = st.footprint;
    const m = 0.2;
    const top = st.dir === "up" ? room.ceiling + 0.2 : 1.3;
    if (x >= f.minX - m && x <= f.maxX + m && z >= f.minZ - m && z <= f.maxZ + m && y <= top) {
      return { id: st.dir === "up" ? HOUSE_STAIR_UP_TARGET_ID : HOUSE_STAIR_DOWN_TARGET_ID, x: st.pad.x, z: st.pad.z };
    }
  }
  if (room.spec.noExit) return null;
  const d = lotRoomDoor(room);
  // the room's frame: the door on the z = origin wall, +z into the room
  const half = room.spec.doorWidth / 2 + TAP_SIDE_M;
  const dz = z - room.origin.z;
  if (Math.abs(x - d.exitPad.x) > half || dz > TAP_IN_M || dz < -TAP_OUT_M || y > room.door.height + TAP_ABOVE_M) return null;
  return { id: `${LOT_EXIT_TARGET_PREFIX}${room.unit.id}`, x: d.exitPad.x, z: d.exitPad.z };
}
