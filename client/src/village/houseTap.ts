import {
  HOUSE_NODE_PATTERNS,
  HOUSE_PLACES,
  HOUSE_STAIR_TYPE,
  STAIR_PLANS,
  localRectToWorld,
  parseHouseFloorArea,
  worldToLocal,
} from "@caysonverse/shared/village/houseAreas";
import { HOUSE_EXIT_TARGET_ID, HOUSE_STAIR_DOWN_TARGET_ID, HOUSE_STAIR_UP_TARGET_ID } from "@caysonverse/shared/village/houseTargets";

/**
 * Tapping the stair or the front door inside a house (집 실내 G; design 3 and 7.6): the avatar walks to the pad and uses it on arrival, as a
 * tap on a seat walks there and sits (seatOnArrival.ts). `houseTapTarget` says whether a picked point on the model is the stair or the
 * front door and where its pad is; the camera rig plans the walk to that pad instead of to the (unwalkable) point and arms the use
 * (`armHouseUse`), and the village scene's frame loop fires it once the button for that pad is offered (`takeArmedHouseUse`).
 * Pure plus one module variable; a new tap, or too long a wait, disarms it.
 */

/** How far (m) past the stair's footprint a pick still counts as on the stair (the rail, the steps' edge). */
export const HOUSE_TAP_STAIR_MARGIN = 0.2;
/** The front door (local): the glass double door on the z = 0 wall, 2.9 m tall (HOUSE_ROOM.frontDoor), a tap within this much of the wall. */
const FRONT_DOOR = { minX: 4.4, maxX: 6.2, maxZ: 0.45, height: 3.0 } as const;

export interface HouseTapTarget {
  /** The target id the pad offers (houseTargets.ts). */
  id: string;
  /** The pad's centre (world): where the avatar walks to. */
  x: number;
  z: number;
}

/** What the picked world point (x, y, z) of house floor `area` is: its stair, its front door, or nothing. */
export function houseTapTarget(area: string, x: number, y: number, z: number): HouseTapTarget | null {
  const hit = parseHouseFloorArea(area);
  if (!hit || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const places = HOUSE_PLACES[hit.n];
  const plan = STAIR_PLANS[HOUSE_STAIR_TYPE[hit.n]];
  const foot = localRectToWorld(hit.n, hit.floor, plan.footprint);
  const m = HOUSE_TAP_STAIR_MARGIN;
  if (x >= foot.minX - m && x <= foot.maxX + m && z >= foot.minZ - m && z <= foot.maxZ + m) {
    return hit.floor === 1
      ? { id: HOUSE_STAIR_UP_TARGET_ID, x: places.upPad.x, z: places.upPad.z }
      : { id: HOUSE_STAIR_DOWN_TARGET_ID, x: places.downPad.x, z: places.downPad.z };
  }
  if (hit.floor === 1) {
    const l = worldToLocal(hit.n, 1, x, z);
    if (l.x >= FRONT_DOOR.minX && l.x <= FRONT_DOOR.maxX && l.z <= FRONT_DOOR.maxZ && y <= FRONT_DOOR.height) {
      return { id: HOUSE_EXIT_TARGET_ID, x: places.exitPad.x, z: places.exitPad.z };
    }
  }
  return null;
}

/** A node name that is a house's stair or door (for the dev hooks). */
export function isHouseTapNode(name: string): boolean {
  return /^(stair|door)__h/.test(name) || HOUSE_NODE_PATTERNS.floor.test(name);
}

/** How long a tap's use stays armed (ms): the walk across a room, with a margin. */
export const HOUSE_USE_ARM_MS = 15_000;

let armed: { id: string; at: number } | null = null;

/** Arm the use of target `id` for the walk now planned (null disarms: any other tap does). */
export function armHouseUse(id: string | null, now: number = performance.now()): void {
  armed = id === null ? null : { id, at: now };
}

export function armedHouseUse(): string | null {
  return armed?.id ?? null;
}

/**
 * The armed target if it is in `offeredIds` (the avatar has reached the pad's reach): disarms and returns it. Past `HOUSE_USE_ARM_MS` it
 * disarms and returns null. Called every frame by the village scene.
 */
export function takeArmedHouseUse(offeredIds: readonly string[], now: number = performance.now()): string | null {
  if (!armed) return null;
  if (now - armed.at > HOUSE_USE_ARM_MS) {
    armed = null;
    return null;
  }
  if (!offeredIds.includes(armed.id)) return null;
  const id = armed.id;
  armed = null;
  return id;
}
