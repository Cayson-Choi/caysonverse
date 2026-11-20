import { LOT_ROOMS, lotDoorPoint, lotRoomDoor, lotRoomOf } from "@caysonverse/shared/village/villageLots";
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
const TAP_OUT_M = 0.35;
const TAP_IN_M = 0.8;
/**
 * How high (m) above the floor a tap must be to be on the door's leaf (owner 2026-11-21: "들어가기 버튼 누르지도 않았는데 들어가버려", and the
 * same going out): a tap on the ground or floor in front of the door is a walk there, never a use of the door.
 */
const TAP_MIN_Y_M = 0.35;
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
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || y < TAP_MIN_Y_M) return null;
  if (area === "village") {
    for (const r of LOT_ROOMS) {
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
  const d = lotRoomDoor(room);
  // the room's frame: the door on the z = origin wall, +z into the room
  const half = room.spec.doorWidth / 2 + TAP_SIDE_M;
  const dz = z - room.origin.z;
  if (Math.abs(x - d.exitPad.x) > half || dz > TAP_IN_M || dz < -TAP_OUT_M || y > room.door.height + TAP_ABOVE_M) return null;
  return { id: `${LOT_EXIT_TARGET_PREFIX}${room.unit.id}`, x: d.exitPad.x, z: d.exitPad.z };
}
