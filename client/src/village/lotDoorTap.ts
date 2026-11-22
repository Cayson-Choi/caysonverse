import { LOT_ROOMS, lotDoorPoint, lotRoomDoor, lotRoomOf, lotRoomStair } from "@caysonverse/shared/village/villageLots";
import { HOUSE_STAIR_DOWN_TARGET_ID, HOUSE_STAIR_UP_TARGET_ID } from "@caysonverse/shared/village/houseTargets";
import { CAFE_STAIR } from "@caysonverse/shared/village/cafeRoom";
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
/**
 * A pick that faces up (a step, a threshold, a planter's or a bench's top by the door, a stone base) below this height (m) is something one
 * stands on or walks to, never the door's leaf, whatever its height above the ground (the floor rule above only knows y). Above it an
 * up-facing face is a glazing bar's or a rail's top edge: still the door.
 */
export const DOOR_TAP_FLAT_MAX_Y_M = 1.0;
/** A face whose normal's y is at least this faces up (clickPlan.ts WALKABLE_MIN_NY). */
const FLAT_MIN_NY = 0.8;
/**
 * A tap on a door uses it on arrival only when it was made from within this (m) of the door's pad: from farther off it is a walk to the door,
 * where its button is offered (owner 2026-11-21: nobody is taken inside by a tap made from across the square).
 */
export const DOOR_TAP_USE_RANGE_M = 12;

/** The house stairs' tap bands (houseTap.ts HOUSE_TAP_STAIR_*; not imported: houseTap imports this file): margin past the footprint, and how high over the walking surface (the rail and a little more). */
const STAIR_TAP_MARGIN = 0.2;
const STAIR_TAP_ABOVE = 1.1;

/**
 * The height (m above the café's floor) of the café stair's walking surface at ROOM-frame (rx, rz) (cafeRoom.ts CAFE_STAIR): flight A
 * rises along the side wall from the foot to the landing (half the storey), the landing across the back, flight B rises back toward the
 * front to the salon's floor. Between the flights' x ranges the higher flight is taken.
 */
export function cafeStairSurfaceY(rx: number, rz: number): number {
  const S = CAFE_STAIR;
  const half = S.storey / 2;
  if (rz >= S.landing) return half;
  const along = Math.min(1, Math.max(0, (rz - S.foot) / (S.landing - S.foot)));
  const inA = rx <= (S.flightA.x1 + S.flightB.x0) / 2;
  return inA ? along * half : half + (1 - along) * half;
}

/**
 * Whether a pick at ROOM-frame (rx, rz) and height y is on the café stair: up to its rail over the walking surface there. Anything lower
 * within the footprint is the stair's own body — a step's riser, a stringer, the panelled side under flight B, the landing's underside —
 * so, unlike a house's single flight (houseTap.ts), there is no lower band: the walls behind the flights only stand ABOVE the rail
 * (the steps hide them below it), and that is what a tap must not take for the stair.
 */
export function onCafeStairSurface(rx: number, y: number, rz: number): boolean {
  return y <= cafeStairSurfaceY(rx, rz) + STAIR_TAP_ABOVE;
}

/** Whether a picked point at height `y` whose face's normal has the y component `ny` is a flat thing by the door, not its leaf. */
export function doorTapOnFlat(y: number, ny: number | undefined): boolean {
  return ny !== undefined && ny >= FLAT_MIN_NY && y < DOOR_TAP_FLAT_MAX_Y_M;
}

export interface LotDoorTap {
  /** The target id the pad offers (lotTargets.ts). */
  id: string;
  /** The pad's centre (world): where the avatar walks to. */
  x: number;
  z: number;
}

/** With nothing picked, the ray is followed this far (m) to the door's plane (a tap's use is armed from DOOR_TAP_USE_RANGE_M of the pad at most). */
const RAY_ONLY_MAX_M = 40;

/** A click's ray (world metres): where it starts and its unit direction. */
export interface TapRayLike {
  o: { x: number; y: number; z: number };
  d: { x: number; y: number; z: number };
}

/**
 * The door's leaf is not always what a click hits: an auto door's leaf slides out of the way (and the lots' leaves are not pickable), so a tap
 * on the door lands on the wall inside. Then the click's RAY decides: it crossed the door's own plane within the opening, at door height
 * (>= TAP_MIN_Y_M, so never the ground), and what it finally hit lies at or past that plane and is no ground or floor either (a tap on the
 * floor beyond an open door is a walk). `n` is the plane's unit normal towards the side the tap comes from (horizontal: out of the building
 * for its street door, into the room for its way out), `u` along the plane, (cx, cz) the
 * opening's centre on the plane.
 */
function rayThroughOpening(ray: TapRayLike | null | undefined, distance: number, n: { x: number; z: number }, u: { x: number; z: number }, cx: number, cz: number, halfW: number, height: number): boolean {
  if (!ray || !(distance > 0)) return false;
  // from the side the door is looked at from (n points to it): a ray that starts behind the door's plane is not a tap on it
  if ((ray.o.x - cx) * n.x + (ray.o.z - cz) * n.z <= 0) return false;
  const dn = ray.d.x * n.x + ray.d.z * n.z;
  if (Math.abs(dn) < 1e-6) return false;
  const t = ((cx - ray.o.x) * n.x + (cz - ray.o.z) * n.z) / dn;
  if (!(t > 0) || t > distance + 0.05) return false;
  const hx = ray.o.x + ray.d.x * t - cx;
  const hz = ray.o.z + ray.d.z * t - cz;
  const hy = ray.o.y + ray.d.y * t;
  return Math.abs(hx * u.x + hz * u.z) <= halfW + TAP_SIDE_M && hy >= TAP_MIN_Y_M && hy <= height + TAP_ABOVE_M;
}

/**
 * What the picked world point (x, y, z) of `area` is: a lot door (the village) or a room's way out, or nothing. `ray` / `distance`: the click's
 * ray and the pick's distance along it, for a door whose leaf the click passed through (see rayThroughOpening). `ny`: the picked face's
 * normal's y (a flat thing by the door is not the door: doorTapOnFlat).
 */
export function lotDoorTapTarget(area: string, x: number, y: number, z: number, ray?: TapRayLike | null, distance = 0, ny?: number): LotDoorTap | null {
  // nothing picked (the click went through a glass leaf and out of the area: a NaN point): the ray alone decides (rayThroughOpening)
  const picked = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
  if (picked ? y < TAP_MIN_Y_M || doorTapOnFlat(y, ny) : !ray) return null;
  if (!picked) distance = RAY_ONLY_MAX_M;
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
      const onLeaf = picked && o >= -TAP_IN_M && o <= TAP_OUT_M && Math.abs(a) <= r.door.width / 2 + TAP_SIDE_M && y <= r.door.height + TAP_ABOVE_M;
      // through the open / unpickable leaf: the pick lies behind the door's plane (inside the building), or nothing was picked at all
      const through = (!picked || o < TAP_OUT_M) && rayThroughOpening(ray, distance, out, along, p.centre.x, p.centre.z, r.door.width / 2, r.door.height);
      if (!onLeaf && !through) continue;
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
    const m = STAIR_TAP_MARGIN;
    // up (the café's own floor): only at the height of the steps, the stringer and the rail where the tap lands (the house stairs' rule,
    // houseTap.ts onStairSurface) — not the side / kitchen wall behind the flights nor the ceiling over them, which stand over the same
    // footprint (2026-11-22: a tap on the wall behind the stair went upstairs). Down (the salon's stairwell): its rail, up to 1.3 m.
    const onStair = st.dir === "up" ? onCafeStairSurface(x - room.origin.x, y, z - room.origin.z) : y <= 1.3;
    if (x >= f.minX - m && x <= f.maxX + m && z >= f.minZ - m && z <= f.maxZ + m && onStair) {
      return { id: st.dir === "up" ? HOUSE_STAIR_UP_TARGET_ID : HOUSE_STAIR_DOWN_TARGET_ID, x: st.pad.x, z: st.pad.z };
    }
  }
  if (room.spec.noExit) return null;
  const d = lotRoomDoor(room);
  // the room's frame: the door on the z = origin wall, +z into the room
  const half = room.spec.doorWidth / 2 + TAP_SIDE_M;
  const dz = z - room.origin.z;
  const onLeaf = picked && Math.abs(x - d.exitPad.x) <= half && dz <= TAP_IN_M && dz >= -TAP_OUT_M && y <= room.door.height + TAP_ABOVE_M;
  // the door's wall is the z = origin wall, the room on its +z side; along is x
  const through = (!picked || dz < TAP_OUT_M) && rayThroughOpening(ray, distance, { x: 0, z: 1 }, { x: 1, z: 0 }, d.exitPad.x, room.origin.z, room.spec.doorWidth / 2, room.door.height);
  if (!onLeaf && !through) return null;
  return { id: `${LOT_EXIT_TARGET_PREFIX}${room.unit.id}`, x: d.exitPad.x, z: d.exitPad.z };
}
