/**
 * Boarding a ride the way a first-time player expects it (owner 2026-11-18 "케이슨랜드에 놀이기구 탈 수가 없어"): the 타기 prompt is offered from afar (RIDE_PROMPT_RANGE_M
 * past the boarding pad), pressing it WALKS to the pad and boards on arrival (the server reserves the seat if the ride is not loading), and tapping the
 * ride itself (its platform, queue hall, station, the wheel's frame) does the same: the tap's destination is the pad and the board is armed
 * (cf. houseTap.ts). Pure plus one module variable.
 */
import { RIDES, rideByKey, type RideKey } from "@caysonverse/shared/land/rides";
import { CAROUSEL_CENTER, CAROUSEL_RADIUS } from "@caysonverse/shared/land/carousel";
import { WHEEL_SITE } from "@caysonverse/shared/land/wheel";
import { PARK_PLATFORM } from "@caysonverse/shared/village/parkArea";

/** A tap's armed board stays armed this long (ms): the walk across the whole park (the coaster from the wheel is 250 m). */
export const RIDE_ARM_MS = 240_000;
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

/** Which ride a tap at the park point (x, z) means: its footprint, platform or queue. */
export function rideTapZone(x: number, z: number): RideKey | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (Math.hypot(x - CAROUSEL_CENTER.x, z - CAROUSEL_CENTER.z) <= CAROUSEL_RADIUS + 3) return "carousel";
  // the wheel: its frame spans x +-24 about the hub, from the north feet to the south steps and the platform
  if (Math.abs(x - WHEEL_SITE.x) <= 24 && z >= WHEEL_SITE.z - 6 && z <= WHEEL_SITE.z + 12) return "wheel";
  // the coaster: the station platform and its apron (the boarding pad is at the foot of the platform's north steps)
  const p = PARK_PLATFORM;
  if (x >= p.minX - 4 && x <= p.maxX + 4 && z >= p.minZ - 16 && z <= p.maxZ + 4) return "coaster";
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
 * Which ride a tap means, from what it landed on: the picked point (`x`, `z`) inside a ride's footprint, or the click's RAY passing through the
 * ride's body on its way to the ground behind it (a tap between the carousel's horses, on the wheel's open spokes, picks the lawn beyond:
 * first-time-player review). The ray is followed up to `distance` m in 0.5 m steps and tested against each ride's volume.
 */
export function rideForTap(x: number, z: number, ray?: TapRay | null, distance = 0): RideKey | null {
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
  }
  return null;
}
