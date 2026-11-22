/**
 * Boarding a ride (owner 2026-11-21: "모든 놀이기구에 타기 버튼을 눌러야만 타도록"): ONLY its 타기 button (the E key, the round button, the ride panel's
 * button) boards. The 타기 prompt is offered from afar (RIDE_PROMPT_RANGE_M past the boarding pad): pressing it WALKS to the pad and boards on
 * arrival (the board is armed by that press, and only while that walk lasts; the server reserves the seat if the ride is not loading). A tap on
 * the ride itself (its frame, cars, seats, a raised platform) only walks to the pad, where the button is: it never arms a board, and a tap on
 * the ground anywhere (the queue, the apron, the lawn seen between the wheel's spokes) is a plain walk to that spot. Pure plus one module variable.
 */
import { RIDES, rideByKey, type RideKey } from "@caysonverse/shared/land/rides";
import { CAROUSEL_CENTER, CAROUSEL_RADIUS } from "@caysonverse/shared/land/carousel";
import { WHEEL_SITE } from "@caysonverse/shared/land/wheel";
import { MOON_BOAT_SITE } from "@caysonverse/shared/land/moonBoat";
import { DROP_SITE } from "@caysonverse/shared/land/dropTower";
import { PARK_PLATFORM } from "@caysonverse/shared/village/parkArea";

/** A press's armed board stays armed this long (ms): the walk across the whole park (the coaster from the wheel is 250 m). */
export const RIDE_ARM_MS = 240_000; // long walks across the park on a slow device must still board on arrival; a tap, the keys or the stick disarm it (CameraRig, LocalPlayer), and so does the walk ending short or the park being left (VillageScene)
/** The board is sent once the walk has brought me within this of the pad's centre, past its radius (m): inside the server's reach (radius + 6). */
export const RIDE_ARRIVE_M = 3;

let armed: { key: RideKey; at: number } | null = null;

export function armRide(key: RideKey | null, now: number = performance.now()): void {
  armed = key === null ? null : { key, at: now };
}
export function armedRide(): RideKey | null {
  return armed?.key ?? null;
}

/** The armed ride if I have reached its pad: disarms and returns it. Past RIDE_ARM_MS it disarms and returns null. */
export function takeArmedRide(x: number, z: number, now: number = performance.now()): RideKey | null {
  if (!armed) return null;
  if (now - armed.at > RIDE_ARM_MS) {
    armed = null;
    return null;
  }
  const def = rideByKey(armed.key);
  if (!def) return null;
  if (Math.hypot(x - def.pad.x, z - def.pad.z) > def.pad.radius + RIDE_ARRIVE_M) return null;
  const key = armed.key;
  armed = null;
  return key;
}

/**
 * A tap on a face that looks up (normal y at least RIDE_TAP_FLAT_MIN_NY) no higher than this (m) is a tap on the ground: a walk there. A ride's
 * raised deck or platform (the carousel's at 0.55 m) is above it: nobody walks onto it by a tap, so the tap goes to the boarding pad instead.
 */
export const RIDE_TAP_GROUND_MAX_Y_M = 0.2;
export const RIDE_TAP_FLAT_MIN_NY = 0.8;

/** Which ride a tap at the park point (x, z) means: its footprint, platform or queue. */
export function rideTapZone(x: number, z: number): RideKey | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (Math.hypot(x - CAROUSEL_CENTER.x, z - CAROUSEL_CENTER.z) <= CAROUSEL_RADIUS + 3) return "carousel";
  // the wheel: its frame spans x +-24 about the hub, from the north feet to the south steps and the platform
  // (the frame and its base only: the lawn and the pad in front of the platform are ground, a tap there walks and never boards)
  if (Math.abs(x - WHEEL_SITE.x) <= 24 && z >= WHEEL_SITE.z - 6 && z <= WHEEL_SITE.z + 8.5) return "wheel";
  // the moon boat: its A-frames and the swing lane, the platform and its steps east of it
  if (x >= MOON_BOAT_SITE.x - 6 && x <= MOON_BOAT_SITE.x + 12 && Math.abs(z - MOON_BOAT_SITE.z) <= 11) return "moonboat";
  // the drop tower: its platform and the lawn round its foot (the tower itself is a thin column, so the footprint is the platform plus the walk to the pad)
  if (x >= DROP_SITE.x - 9 && x <= DROP_SITE.x + 15 && Math.abs(z - DROP_SITE.z) <= 9) return "droptower";
  // the coaster: the station platform itself only. The paved apron and the gravel approach in front of it are ground: a tap there walks,
  // it never boards (owner 2026-11-19: "땅만 찍어도 별똥별 급행에 탑승하는 문제가 있어").
  const p = PARK_PLATFORM;
  if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) return "coaster";
  return null;
}

/** The walkable spot a tap on ride `key` goes to: its boarding pad. */
export function rideTapSpot(key: RideKey): { x: number; z: number } {
  const def = RIDES.find((r) => r.key === key)!;
  return { x: def.pad.x, z: def.pad.z };
}

/** A ray's origin and direction (a click's ray), world metres. */
export interface TapRay {
  o: { x: number; y: number; z: number };
  d: { x: number; y: number; z: number };
}

/**
 * Which ride a tap is ON (to walk to its boarding pad; never to board): the picked point (`x`, `z`) inside a ride's footprint, or the click's
 * RAY passing through the ride's body before it lands on something that is not ground (the wheel's far rim, a car behind the spokes). A tap
 * that lands on the ground (`y` low and the face looking up, `ny`; unknown `ny`: the height alone) is never a ride, whatever its ray crossed:
 * it is a walk to that spot. The ray is followed up to `distance` m in 0.5 m steps and tested against each ride's volume.
 */
export function rideForTap(x: number, z: number, ray?: TapRay | null, distance = 0, y = Number.POSITIVE_INFINITY, ny?: number): RideKey | null {
  if (y <= RIDE_TAP_GROUND_MAX_Y_M && (ny === undefined || ny >= RIDE_TAP_FLAT_MIN_NY)) return null;
  const hit = rideTapZone(x, z);
  if (hit) return hit;
  if (!ray || !(distance > 0)) return null;
  const n = Math.min(400, Math.ceil(distance / 0.5));
  for (let i = 0; i <= n; i++) {
    const t = (i * distance) / n;
    const px = ray.o.x + ray.d.x * t;
    const py = ray.o.y + ray.d.y * t;
    const pz = ray.o.z + ray.d.z * t;
    if (py < 0 || py > 50) continue;
    if (py <= 14 && Math.hypot(px - CAROUSEL_CENTER.x, pz - CAROUSEL_CENTER.z) <= CAROUSEL_RADIUS + 1.5) return "carousel";
    // the wheel: a slab 4.4 m thick in z (the rims and spokes) with the A-frames, and its platform
    if (Math.abs(px - WHEEL_SITE.x) <= 23 && pz >= WHEEL_SITE.z - 3.5 && pz <= WHEEL_SITE.z + 12) return "wheel";
    // the moon boat: the hull and its frame
    if (px >= MOON_BOAT_SITE.x - 6 && px <= MOON_BOAT_SITE.x + 8 && Math.abs(pz - MOON_BOAT_SITE.z) <= 11) return "moonboat";
    // the drop tower: the 4 m square column and its ring car along the whole height
    if (Math.abs(px - DROP_SITE.x) <= 4.5 && Math.abs(pz - DROP_SITE.z) <= 4.5) return "droptower";
  }
  return null;
}
