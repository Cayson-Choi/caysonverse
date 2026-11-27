import {
  HOUSE_NODE_PATTERNS,
  HOUSE_PLACES,
  HOUSE_ROOM,
  HOUSE_STAIR,
  HOUSE_STAIR_TYPE,
  STAIR_PLANS,
  type HouseFloor,
  type HouseNumber,
  localRectToWorld,
  parseHouseFloorArea,
  worldToLocal,
} from "@caysonverse/shared/village/houseAreas";
import { doorTapOnFlat, type TapRayLike } from "./lotDoorTap";
import { HOUSE_EXIT_TARGET_ID, HOUSE_STAIR_DOWN_TARGET_ID, HOUSE_STAIR_TARGET_PREFIX, HOUSE_STAIR_UP_TARGET_ID } from "@caysonverse/shared/village/houseTargets";

/**
 * Tapping the stair or the front door inside a house (집 실내 G; design 3 and 7.6): the avatar walks to the pad; the front door is used on
 * arrival, the stair never (its button climbs: `tapUsesOnArrival`, owner 2026-11-27). `houseTapTarget` says whether a picked point on the model is the stair or the
 * front door and where its pad is; the camera rig plans the walk to that pad instead of to the (unwalkable) point and arms the use
 * (`armHouseUse`), and the village scene's frame loop fires it once the button for that pad is offered (`takeArmedHouseUse`).
 * Pure plus one module variable; a new tap, or too long a wait, disarms it.
 */

/** How far (m) past the stair's footprint a pick still counts as on the stair (the rail, the steps' edge). */
export const HOUSE_TAP_STAIR_MARGIN = 0.2;
/**
 * How far (m) below / above the stair's own surface a picked point may be and still be "on the stair" (owner 2026-11-20: "집안에 들어갔을때
 * 2층올라가기 버튼을 누르지도 않았는데 2층으로 올라가버린다"). The footprint is a plan view: the back wall behind a stair, the ceiling over
 * it and the floor beside its high steps all stand over it, and a tap there (the wall one looks at on entering) used to be a tap on the
 * stair. Below: the stringer and the soffit; above: the handrail (0.9 m) and a little more.
 */
export const HOUSE_TAP_STAIR_BELOW = 0.5;
export const HOUSE_TAP_STAIR_ABOVE = 1.1;
/** The front door (local): the glass double door on the z = 0 wall, 2.9 m tall (HOUSE_ROOM.frontDoor), a tap within this much of the wall, above the floor (a tap on the floor by the door walks, never leaves: owner 2026-11-21). */
const FRONT_DOOR = { minX: 4.4, maxX: 6.2, maxZ: 0.45, height: 3.0, minY: 0.35 } as const;

/** With nothing picked, the ray is followed this far (m) to the front door's wall. */
const FRONT_DOOR_RAY_ONLY_MAX_M = 30;

/**
 * Whether a click's ray, coming from inside the room, crossed the front door's opening (the z = 0 wall, between the door's jambs, above the
 * floor and under its head) within `maxT` m: a tap on the glass leaf, which a click passes through (clickPick.ts: glass is not picked).
 */
function frontDoorCrossed(n: HouseNumber, ray: TapRayLike | null | undefined, maxT: number): boolean {
  if (!ray) return false;
  const o = worldToLocal(n, 1, ray.o.x, ray.o.z);
  const o1 = worldToLocal(n, 1, ray.o.x + ray.d.x, ray.o.z + ray.d.z);
  const dz = o1.z - o.z;
  // from inside (local z > 0) towards the wall (local -z)
  if (!(o.z > 0) || !(dz < -1e-6)) return false;
  const t = -o.z / dz;
  if (!(t > 0) || t > maxT) return false;
  const hx = o.x + (o1.x - o.x) * t;
  const hy = ray.o.y + ray.d.y * t;
  return hx >= FRONT_DOOR.minX && hx <= FRONT_DOOR.maxX && hy >= FRONT_DOOR.minY && hy <= FRONT_DOOR.height;
}

export interface HouseTapTarget {
  /** The target id the pad offers (houseTargets.ts). */
  id: string;
  /** The pad's centre (world): where the avatar walks to. */
  x: number;
  z: number;
}

/**
 * Whether the picked point (x, y, z) is at the height of the stair's own steps and rail there: floor 1 the climb rises 4.0 m over the
 * run (the first step at the foot, the floor above at the top); floor 2 the stairwell shows the same flight below the floor (y 0 at its top),
 * and above the floor only the guard rail (0.9 m) stands.
 */
export function onStairSurface(n: HouseNumber, floor: HouseFloor, x: number, y: number, z: number): boolean {
  const plan = STAIR_PLANS[HOUSE_STAIR_TYPE[n]];
  const l = worldToLocal(n, floor, x, z);
  const t = Math.min(1, Math.max(0, ((l.x - plan.foot.x) * plan.climb.x + (l.z - plan.foot.z) * plan.climb.z) / HOUSE_STAIR.run));
  const surface = t * HOUSE_ROOM.storey - (floor === 2 ? HOUSE_ROOM.storey : 0);
  const top = floor === 2 ? HOUSE_TAP_STAIR_ABOVE : surface + HOUSE_TAP_STAIR_ABOVE;
  return y >= surface - HOUSE_TAP_STAIR_BELOW && y <= top;
}

/** What the picked world point (x, y, z) of house floor `area` is: its stair, its front door, or nothing. `ny`: the picked face's normal's y (a flat thing by the door, a mat or a shoe shelf's top, is not the door); `ray` / `distance`: the click's ray and how far along it the pick lies (the glass front door is not picked: frontDoorCrossed); a NaN point means nothing was picked. */
export function houseTapTarget(area: string, x: number, y: number, z: number, ny?: number, ray?: TapRayLike | null, distance = 0): HouseTapTarget | null {
  const hit = parseHouseFloorArea(area);
  if (!hit) return null;
  const places = HOUSE_PLACES[hit.n];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    // nothing picked: the click went through the front door's glass and out of the house. The ray alone says whether it crossed the door.
    return hit.floor === 1 && frontDoorCrossed(hit.n, ray, FRONT_DOOR_RAY_ONLY_MAX_M) ? { id: HOUSE_EXIT_TARGET_ID, x: places.exitPad.x, z: places.exitPad.z } : null;
  }
  const plan = STAIR_PLANS[HOUSE_STAIR_TYPE[hit.n]];
  const foot = localRectToWorld(hit.n, hit.floor, plan.footprint);
  const m = HOUSE_TAP_STAIR_MARGIN;
  if (x >= foot.minX - m && x <= foot.maxX + m && z >= foot.minZ - m && z <= foot.maxZ + m && onStairSurface(hit.n, hit.floor, x, y, z)) {
    return hit.floor === 1
      ? { id: HOUSE_STAIR_UP_TARGET_ID, x: places.upPad.x, z: places.upPad.z }
      : { id: HOUSE_STAIR_DOWN_TARGET_ID, x: places.downPad.x, z: places.downPad.z };
  }
  if (hit.floor === 1) {
    const l = worldToLocal(hit.n, 1, x, z);
    if (l.x >= FRONT_DOOR.minX && l.x <= FRONT_DOOR.maxX && l.z <= FRONT_DOOR.maxZ && l.z >= -FRONT_DOOR.maxZ && y >= FRONT_DOOR.minY && y <= FRONT_DOOR.height && !doorTapOnFlat(y, ny)) {
      return { id: HOUSE_EXIT_TARGET_ID, x: places.exitPad.x, z: places.exitPad.z };
    }
    // through the glass onto what stands outside it (the view's backdrop, the frame's far side): the pick lies at or past the wall, off the floor
    if (l.z <= FRONT_DOOR.maxZ && y >= FRONT_DOOR.minY && !doorTapOnFlat(y, ny) && frontDoorCrossed(hit.n, ray, distance + 0.05)) {
      return { id: HOUSE_EXIT_TARGET_ID, x: places.exitPad.x, z: places.exitPad.z };
    }
  }
  return null;
}

/**
 * Whether a tap on target `id` uses it on arrival at its pad. A stair never does (owner 2026-11-27: "계단을 탭하면 올라가게 하지 말고 계단
 * 버튼을 누르면 올라가도록 하는게 맞아"): the tap walks to the stair's pad, where its 올라가기 / 내려가기 button is offered, and only that
 * button (E, the round button) climbs. A house's or a lot building's door still opens on arrival (owner 2026-11-20: "문을 누르면 들어가기").
 * Covers the houses' stairs and the café's (lotDoorTap.ts returns the same stair ids).
 */
export function tapUsesOnArrival(id: string): boolean {
  return !id.startsWith(HOUSE_STAIR_TARGET_PREFIX);
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

/** Drop the armed use (entering or leaving a house, the keys / stick taking over). Same as `armHouseUse(null)`; the pad walk goes too. */
export function disarmHouseUse(): void {
  armed = null;
  padWalk = null;
}

/**
 * A tap on a stair or a door walks to its pad, and that walk must END on the pad (fix/house-walk-sync, owner 2026-11-27: in houses 2, 5
 * and 7 the walk stopped 0.9-1.55 m short and no button showed). A walk can end short of its plan in the game where the plan's
 * simulation reached it: the server's self-correction moved the body back mid-walk, a long frame slid it the other way round a chair's
 * corner. So the pad walk is followed: when the walk is over and the body is not on the pad, it is planned again from where it stands,
 * up to PAD_WALK_TRIES times. Set by the tap's plan (CameraRig), dropped by any other tap, the keys / stick, a door, or arriving.
 */
export interface PadWalk {
  id: string;
  x: number;
  z: number;
  /** The walk to the pad has started (its click target was seen): only then does its end count. */
  started: boolean;
  tries: number;
  at: number;
}

/** How many times a pad walk that ended short is planned again. */
export const PAD_WALK_TRIES = 3;
/** A pad walk ends here (m from the pad's centre): on the pad (radius 0.5) with room to spare. */
export const PAD_WALK_DONE_M = 0.4;

let padWalk: PadWalk | null = null;

/** The pad walk the tap now planned (null: that tap was no stair / door tap). */
export function setPadWalk(target: HouseTapTarget | null, now: number = performance.now()): void {
  padWalk = target ? { id: target.id, x: target.x, z: target.z, started: false, tries: 0, at: now } : null;
}

export function currentPadWalk(): PadWalk | null {
  return padWalk;
}

/**
 * Each frame (the village scene): what to do about the pad walk, given where the body is and whether a walk is under way.
 * "none": nothing (no pad walk, still walking, or done); "replan": the walk ended short — plan it again from here (counted).
 */
export function stepPadWalk(x: number, z: number, walking: boolean, now: number = performance.now()): "none" | "replan" {
  const w = padWalk;
  if (!w) return "none";
  if (now - w.at > HOUSE_USE_ARM_MS * 2) {
    padWalk = null;
    return "none";
  }
  if (walking) {
    w.started = true;
    return "none";
  }
  if (!w.started) return "none";
  if (Math.hypot(x - w.x, z - w.z) <= PAD_WALK_DONE_M || w.tries >= PAD_WALK_TRIES) {
    padWalk = null;
    return "none";
  }
  w.tries++;
  w.started = false;
  return "replan";
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
